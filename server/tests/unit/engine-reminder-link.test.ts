import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import { runDeadmanTick, type Deps, type ReminderMessage } from "../../src/deadman/engine";
import { upsertConfig, getConfig } from "../../src/deadman/config-repo";
import { listEvents } from "../../src/deadman/event-repo";

let db: Db;
let reminders: ReminderMessage[];

function seedUser(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

const NOW = "2026-06-20T00:00:00.000Z";
const ARM = { checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true };

/** A spy mintCheckinLink that returns a fresh, distinct link each call. */
function makeMint(): { spy: (userId: string) => string; links: string[] } {
  const links: string[] = [];
  let n = 0;
  const spy = (userId: string): string => {
    n += 1;
    const link = `https://app.example.test/checkin?token=tok-${userId}-${n}`;
    links.push(link);
    return link;
  };
  return { spy, links };
}

function makeDeps(now: Date, mint: (userId: string) => string): Deps {
  return {
    now: () => now,
    userEmailFor: (userId) => `${userId}@example.com`,
    notify: vi.fn(async (message: ReminderMessage) => {
      reminders.push(message);
    }),
    mintCheckinLink: mint,
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  seedUser("u1");
  reminders = [];
});

describe("runDeadmanTick — reminders embed a one-time check-in link (feature 011)", () => {
  it("entering grace mints a token and the first reminder body has exactly one /checkin link", async () => {
    upsertConfig(db, "u1", ARM, NOW);
    const mint = makeMint();
    const past = new Date("2026-06-28T00:00:00.000Z");
    await runDeadmanTick(db, makeDeps(past, mint.spy), past);

    expect(reminders).toHaveLength(1);
    const body = reminders[0]!.body;
    expect(mint.links).toHaveLength(1);
    expect(body).toContain(mint.links[0]!);
    // Exactly one /checkin link in the body.
    expect(body.match(/\/checkin\?token=/g)).toHaveLength(1);

    // A checkin_token row storing only a hash, with a future expiry, was NOT created here because
    // the spy mint is a stub — but the engine called mint once.
    const config = getConfig(db, "u1");
    expect(config!.state).toBe("grace");
  });

  it("each subsequent reminder mints its OWN fresh link", async () => {
    upsertConfig(db, "u1", ARM, NOW);
    const mint = makeMint();

    // Tick 1 → enter grace (reminder 1).
    const t1 = new Date("2026-06-28T00:00:00.000Z");
    await runDeadmanTick(db, makeDeps(t1, mint.spy), t1);
    // Tick 2 → another reminder (reminder 2), still inside the grace window.
    const t2 = new Date("2026-06-28T01:00:00.000Z");
    await runDeadmanTick(db, makeDeps(t2, mint.spy), t2);

    expect(reminders).toHaveLength(2);
    expect(mint.links).toHaveLength(2);
    // The two reminders carry distinct links.
    expect(reminders[0]!.body).toContain(mint.links[0]!);
    expect(reminders[1]!.body).toContain(mint.links[1]!);
    expect(mint.links[0]).not.toBe(mint.links[1]);
  });

  it("the reminder body carries no secret beyond the one-time link (FR-008)", async () => {
    upsertConfig(db, "u1", ARM, NOW);
    const mint = makeMint();
    const past = new Date("2026-06-28T00:00:00.000Z");
    await runDeadmanTick(db, makeDeps(past, mint.spy), past);

    const body = reminders[0]!.body;
    // The only token-bearing substring is the single emailed link.
    const withoutLink = body.replace(mint.links[0]!, "");
    expect(withoutLink).not.toContain("token=");
    expect(withoutLink).not.toContain("tok-");
  });

  it("a mint failure for one user does not abort the batch (FR-009 per-user isolation)", async () => {
    seedUser("u2");
    upsertConfig(db, "u1", ARM, NOW);
    upsertConfig(db, "u2", ARM, NOW);

    const okLinks: string[] = [];
    const deps: Deps = {
      now: () => new Date("2026-06-28T00:00:00.000Z"),
      userEmailFor: (userId) => `${userId}@example.com`,
      notify: vi.fn(async (message: ReminderMessage) => {
        reminders.push(message);
      }),
      mintCheckinLink: (userId: string): string => {
        if (userId === "u1") throw new Error("mint failed");
        const link = `https://app.example.test/checkin?token=ok-${userId}`;
        okLinks.push(link);
        return link;
      },
    };
    const past = new Date("2026-06-28T00:00:00.000Z");
    await runDeadmanTick(db, deps, past);

    // u2 still got a reminder with its link despite u1's mint throwing.
    expect(reminders.some((r) => r.recipient === "u2@example.com")).toBe(true);
    expect(okLinks).toHaveLength(1);
    // u1's failure was recorded as a non-delivered reminder marker, not a crash.
    const u1Events = listEvents(db, "u1");
    expect(u1Events.some((e) => e.type === "reminder_sent")).toBe(true);
  });
});
