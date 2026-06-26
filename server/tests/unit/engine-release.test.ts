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
import { addContact } from "../../src/db/contact-repo";
import { createRelease } from "../../src/db/release-repo";

let db: Db;
let reminders: ReminderMessage[];
let releaseEmails: { recipient: string; token: string }[];

function seedUser(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

function listAllContacts(userId: string): ReleaseRecipient[] {
  // mirror the real resolver: every contact is a recipient.
  const rows = db
    .prepare("SELECT id, value FROM contact WHERE user_id = ?")
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
      listContacts: listAllContacts,
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
  it("snapshots every contact, mints one grant each, emails a tokenized link", async () => {
    const contact = addContact(db, "u1", "email", "friend@example.com");

    await armAndTrigger("u1", new Date("2026-07-05T00:00:00.000Z"));

    expect(getConfig(db, "u1")?.state).toBe("triggered");

    // Exactly one release for the user.
    const releases = db.prepare("SELECT * FROM release WHERE user_id = ?").all("u1") as {
      trigger: string;
    }[];
    expect(releases).toHaveLength(1);
    expect(releases[0]!.trigger).toBe("schedule");

    // One grant — the contact.
    const grants = db.prepare("SELECT * FROM release_grant").all() as {
      contact_id: string;
      email_status: string;
      token_hash: string;
    }[];
    expect(grants).toHaveLength(1);
    expect(grants[0]!.contact_id).toBe(contact.id);
    expect(grants[0]!.email_status).toBe("sent");

    // The email carried a tokenized link to the contact's address.
    expect(releaseEmails).toHaveLength(1);
    expect(releaseEmails[0]!.recipient).toBe("friend@example.com");
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

  it("no token leak: no event/grant row contains the raw token", async () => {
    addContact(db, "u1", "email", "v@example.com");
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
    addContact(db, "u1", "email", "v@example.com");
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

describe("release uniqueness — durable cross-process idempotency (FR-005, SC-002)", () => {
  it("the DB allows at most one 'schedule' release per user; manual_test is unconstrained", () => {
    createRelease(db, "u1", "schedule", NOW);
    // A second scheduled release for the same user is rejected at the DB level (the partial
    // UNIQUE index), so a racing process can never create a duplicate cycle.
    expect(() => createRelease(db, "u1", "schedule", NOW)).toThrow();
    // Manual previews are intentionally repeatable.
    expect(() => {
      createRelease(db, "u1", "manual_test", NOW);
      createRelease(db, "u1", "manual_test", NOW);
    }).not.toThrow();
  });

  it("a tick that loses the claim race transitions to triggered without double-delivering", async () => {
    addContact(db, "u1", "email", "v@example.com");

    upsertConfig(db, "u1", ARM, NOW);
    await runDeadmanTick(db, makeDeps(new Date("2026-06-28T00:00:00.000Z")), new Date("2026-06-28T00:00:00.000Z"));
    reminders = [];
    releaseEmails = [];

    // Simulate a concurrent process winning the claim between this tick's fast-path check and its
    // own INSERT: the first listContacts call inserts the competing 'schedule' release, so
    // this tick's createRelease then loses the partial-UNIQUE race.
    const triggerNow = new Date("2026-07-05T00:00:00.000Z");
    const racingDeps = makeDeps(triggerNow);
    const realList = racingDeps.release!.listContacts;
    let raced = false;
    racingDeps.release!.listContacts = (userId: string) => {
      if (!raced) {
        raced = true;
        createRelease(db, userId, "schedule", triggerNow.toISOString());
      }
      return realList(userId);
    };

    // Must not throw out of the tick, and must not double-deliver.
    await expect(runDeadmanTick(db, racingDeps, triggerNow)).resolves.toBeUndefined();

    expect(getConfig(db, "u1")?.state).toBe("triggered");
    const schedReleases = db
      .prepare("SELECT * FROM release WHERE user_id = ? AND trigger = 'schedule'")
      .all("u1");
    expect(schedReleases).toHaveLength(1); // only the winner's
    expect((db.prepare("SELECT COUNT(*) AS n FROM release_grant").get() as { n: number }).n).toBe(0);
    expect(releaseEmails).toHaveLength(0); // the loser sent nothing
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
