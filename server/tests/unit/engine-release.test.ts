import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import {
  runDeadmanTick,
  type Deps,
  type ReminderMessage,
  type ReleaseRecipient,
} from "../../src/deadman/engine";
import { getConfig, upsertConfig } from "../../src/deadman/config-repo";
import { listEvents } from "../../src/deadman/event-repo";
import { addContact, markVerified } from "../../src/db/contact-repo";

let db: Db;
let reminders: ReminderMessage[];
let releaseEmails: { recipient: string; token: string }[];

function seedUser(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

function listVerified(userId: string): ReleaseRecipient[] {
  // mirror the real resolver: only verified contacts.
  const rows = db
    .prepare("SELECT id, value FROM contact WHERE user_id = ? AND verified_at IS NOT NULL")
    .all(userId) as { id: string; value: string }[];
  return rows.map((r) => ({ contactId: r.id, address: r.value }));
}

function makeDeps(now: Date, opts: { sendFails?: (addr: string) => boolean } = {}): Deps {
  return {
    now: () => now,
    userEmailFor: (userId) => `${userId}@example.com`,
    notify: vi.fn(async (message: ReminderMessage) => {
      reminders.push(message);
    }),
    release: {
      listVerifiedContacts: listVerified,
      sendReleaseEmail: vi.fn(async (recipient: string, token: string) => {
        if (opts.sendFails?.(recipient)) throw new Error("provider down");
        releaseEmails.push({ recipient, token });
        return "provider-msg-id";
      }),
    },
  };
}

const NOW = "2026-06-20T00:00:00.000Z";
const ARM = { checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true };

/** Drive a freshly-armed switch all the way to its trigger at `triggerNow`. */
async function armAndTrigger(userId: string, triggerNow: Date): Promise<void> {
  upsertConfig(db, userId, ARM, NOW);
  // First tick → grace.
  await runDeadmanTick(db, makeDeps(new Date("2026-06-28T00:00:00.000Z")), new Date("2026-06-28T00:00:00.000Z"));
  reminders = [];
  releaseEmails = [];
  await runDeadmanTick(db, makeDeps(triggerNow), triggerNow);
}

beforeEach(() => {
  db = openDb(":memory:");
  seedUser("u1");
  reminders = [];
  releaseEmails = [];
});

describe("runDeadmanTick — trigger creates a release (US1, feature 010)", () => {
  it("snapshots verified contacts only, mints one grant each, emails a tokenized link", async () => {
    const verified = addContact(db, "u1", "email", "verified@example.com");
    markVerified(db, verified.id, NOW);
    addContact(db, "u1", "email", "unverified@example.com"); // gets no grant

    await armAndTrigger("u1", new Date("2026-07-05T00:00:00.000Z"));

    expect(getConfig(db, "u1")?.state).toBe("triggered");

    // Exactly one release for the user.
    const releases = db.prepare("SELECT * FROM release WHERE user_id = ?").all("u1") as {
      trigger: string;
    }[];
    expect(releases).toHaveLength(1);
    expect(releases[0]!.trigger).toBe("schedule");

    // Exactly one grant — the verified contact only.
    const grants = db.prepare("SELECT * FROM release_grant").all() as {
      contact_id: string;
      email_status: string;
      token_hash: string;
    }[];
    expect(grants).toHaveLength(1);
    expect(grants[0]!.contact_id).toBe(verified.id);
    expect(grants[0]!.email_status).toBe("sent");

    // The email carried a tokenized link to the verified address.
    expect(releaseEmails).toHaveLength(1);
    expect(releaseEmails[0]!.recipient).toBe("verified@example.com");
    expect(releaseEmails[0]!.token.length).toBeGreaterThan(0);

    // The raw token is never persisted — only its hash.
    expect(grants[0]!.token_hash).not.toBe(releaseEmails[0]!.token);

    // Records triggered + released; released carries a grant count, never a token/plaintext.
    const types = listEvents(db, "u1", 100).map((e) => e.type);
    expect(types).toContain("triggered");
    expect(types).toContain("released");
    const released = listEvents(db, "u1", 100).find((e) => e.type === "released")!;
    expect(released.detail).toBe(JSON.stringify({ grants: 1 }));
    expect(released.detail).not.toContain(releaseEmails[0]!.token);
  });

  it("a verified contact with no token leak: no event/grant row contains the raw token", async () => {
    const verified = addContact(db, "u1", "email", "v@example.com");
    markVerified(db, verified.id, NOW);
    await armAndTrigger("u1", new Date("2026-07-05T00:00:00.000Z"));

    const token = releaseEmails[0]!.token;
    const grantsJson = JSON.stringify(db.prepare("SELECT * FROM release_grant").all());
    const eventsJson = JSON.stringify(listEvents(db, "u1", 100));
    expect(grantsJson).not.toContain(token);
    expect(eventsJson).not.toContain(token);
  });
});

describe("runDeadmanTick — idempotent release (US1, FR-005)", () => {
  it("a second tick on a triggered switch creates no second release or grants", async () => {
    const verified = addContact(db, "u1", "email", "v@example.com");
    markVerified(db, verified.id, NOW);
    await armAndTrigger("u1", new Date("2026-07-05T00:00:00.000Z"));

    const grantsBefore = (db.prepare("SELECT COUNT(*) AS n FROM release_grant").get() as { n: number }).n;
    const releasesBefore = (db.prepare("SELECT COUNT(*) AS n FROM release").get() as { n: number }).n;
    releaseEmails = [];

    // Re-tick (timer + external cron style) — the switch is already triggered.
    const again = new Date("2026-07-06T00:00:00.000Z");
    await runDeadmanTick(db, makeDeps(again), again);

    expect((db.prepare("SELECT COUNT(*) AS n FROM release_grant").get() as { n: number }).n).toBe(grantsBefore);
    expect((db.prepare("SELECT COUNT(*) AS n FROM release").get() as { n: number }).n).toBe(releasesBefore);
    expect(releaseEmails).toHaveLength(0);
  });

  it("a per-grant email failure is recorded 'failed' without aborting the batch", async () => {
    const a = addContact(db, "u1", "email", "a@example.com");
    const b = addContact(db, "u1", "email", "b@example.com");
    markVerified(db, a.id, NOW);
    markVerified(db, b.id, NOW);

    upsertConfig(db, "u1", ARM, NOW);
    await runDeadmanTick(db, makeDeps(new Date("2026-06-28T00:00:00.000Z")), new Date("2026-06-28T00:00:00.000Z"));
    reminders = [];
    releaseEmails = [];
    const triggerNow = new Date("2026-07-05T00:00:00.000Z");
    await runDeadmanTick(
      db,
      makeDeps(triggerNow, { sendFails: (addr) => addr === "a@example.com" }),
      triggerNow,
    );

    const grants = db.prepare("SELECT contact_id, email_status FROM release_grant").all() as {
      contact_id: string;
      email_status: string;
    }[];
    expect(grants).toHaveLength(2);
    const byContact = Object.fromEntries(grants.map((g) => [g.contact_id, g.email_status]));
    expect(byContact[a.id]).toBe("failed");
    expect(byContact[b.id]).toBe("sent");
    // The batch still completed and the switch fired.
    expect(getConfig(db, "u1")?.state).toBe("triggered");
  });
});

describe("runDeadmanTick — trigger without release deps (008-era compatibility)", () => {
  it("still transitions to triggered and records triggered, with no release", async () => {
    upsertConfig(db, "u1", ARM, NOW);
    const depsNoRelease: Deps = {
      now: () => new Date(),
      userEmailFor: () => "u1@example.com",
      notify: vi.fn(async () => {}),
    };
    await runDeadmanTick(db, depsNoRelease, new Date("2026-06-28T00:00:00.000Z"));
    const triggerNow = new Date("2026-07-05T00:00:00.000Z");
    await runDeadmanTick(db, { ...depsNoRelease, now: () => triggerNow }, triggerNow);

    expect(getConfig(db, "u1")?.state).toBe("triggered");
    expect((db.prepare("SELECT COUNT(*) AS n FROM release").get() as { n: number }).n).toBe(0);
    expect(listEvents(db, "u1", 100).map((e) => e.type)).toContain("triggered");
  });
});
