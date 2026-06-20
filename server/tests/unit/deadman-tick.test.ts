import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import { runDeadmanTick, type Deps, type ReminderMessage } from "../../src/deadman/engine";
import { getConfig, upsertConfig } from "../../src/deadman/config-repo";
import { listEvents } from "../../src/deadman/event-repo";

let db: Db;
let sent: ReminderMessage[];

function seedUser(id: string, email = `${id}@example.com`): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, email, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

function makeDeps(now: Date): Deps {
  return {
    now: () => now,
    userEmailFor: (userId) => getConfig(db, userId) && `${userId}@example.com`,
    notify: vi.fn(async (message: ReminderMessage) => {
      sent.push(message);
    }),
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  seedUser("u1");
  sent = [];
});

const NOW = "2026-06-20T00:00:00.000Z";
const ARM = { checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true };

function eventTypes(userId: string): string[] {
  return listEvents(db, userId, 100)
    .map((e) => e.type)
    .reverse(); // oldest-first for readability
}

describe("runDeadmanTick — active → grace (US2)", () => {
  it("moves a due active switch to grace, sends exactly one reminder to the user's own email", async () => {
    upsertConfig(db, "u1", ARM, NOW);
    const tickNow = new Date("2026-06-28T00:00:00.000Z"); // past the deadline
    await runDeadmanTick(db, makeDeps(tickNow), tickNow);

    const config = getConfig(db, "u1");
    expect(config?.state).toBe("grace");
    expect(config?.graceDeadlineAt).toBe("2026-06-30T00:00:00.000Z");
    expect(config?.remindersSent).toBe(1);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipient).toBe("u1@example.com");
    expect(sent[0]!.body).not.toContain("plaintext");

    expect(eventTypes("u1").sort()).toEqual(["entered_grace", "reminder_sent"]);
  });
});

describe("runDeadmanTick — grace → triggered (US2)", () => {
  it("triggers a grace switch past its grace deadline, no contact email in 008", async () => {
    upsertConfig(db, "u1", ARM, NOW);
    // First tick → grace.
    await runDeadmanTick(db, makeDeps(new Date("2026-06-28T00:00:00.000Z")), new Date("2026-06-28T00:00:00.000Z"));
    sent = [];
    // Advance well past the grace deadline (2026-06-30) → trigger.
    const triggerNow = new Date("2026-07-05T00:00:00.000Z");
    await runDeadmanTick(db, makeDeps(triggerNow), triggerNow);

    expect(getConfig(db, "u1")?.state).toBe("triggered");
    expect(eventTypes("u1")).toContain("triggered");
  });
});

describe("runDeadmanTick — idempotency (US2, FR-013)", () => {
  it("re-running on a triggered switch changes nothing", async () => {
    upsertConfig(db, "u1", ARM, NOW);
    await runDeadmanTick(db, makeDeps(new Date("2026-06-28T00:00:00.000Z")), new Date("2026-06-28T00:00:00.000Z"));
    const triggerNow = new Date("2026-07-05T00:00:00.000Z");
    await runDeadmanTick(db, makeDeps(triggerNow), triggerNow);

    const before = getConfig(db, "u1");
    const eventsBefore = listEvents(db, "u1", 100).length;
    sent = [];
    await runDeadmanTick(db, makeDeps(triggerNow), triggerNow);

    expect(getConfig(db, "u1")).toEqual(before);
    expect(listEvents(db, "u1", 100).length).toBe(eventsBefore);
    expect(sent).toHaveLength(0);
  });

  it("does not exceed the reminder cap across many grace ticks", async () => {
    upsertConfig(db, "u1", ARM, NOW);
    // Tick repeatedly while inside the grace window (before 2026-06-30).
    for (let i = 0; i < 10; i++) {
      const t = new Date(`2026-06-28T0${i}:00:00.000Z`);
      await runDeadmanTick(db, makeDeps(t), t);
    }
    // Cap is DEADMAN_MAX_GRACE_REMINDERS (3).
    const reminders = listEvents(db, "u1", 100).filter((e) => e.type === "reminder_sent");
    expect(reminders.length).toBeLessThanOrEqual(3);
    expect(getConfig(db, "u1")?.remindersSent).toBeLessThanOrEqual(3);
  });
});

describe("runDeadmanTick — disarmed (US4)", () => {
  it("never acts on a disarmed switch", async () => {
    upsertConfig(db, "u1", { ...ARM, enabled: false }, NOW);
    const t = new Date("2030-01-01T00:00:00.000Z");
    await runDeadmanTick(db, makeDeps(t), t);
    expect(getConfig(db, "u1")?.state).toBe("disarmed");
    expect(sent).toHaveLength(0);
  });
});

describe("runDeadmanTick — send failure resilience (FR-022)", () => {
  it("does not abort the batch when a reminder send throws; records a non-sensitive marker", async () => {
    seedUser("u2");
    upsertConfig(db, "u1", ARM, NOW);
    upsertConfig(db, "u2", ARM, NOW);
    const tickNow = new Date("2026-06-28T00:00:00.000Z");
    const deps: Deps = {
      now: () => tickNow,
      userEmailFor: (userId) => `${userId}@example.com`,
      notify: vi.fn(async (message: ReminderMessage) => {
        if (message.recipient === "u1@example.com") throw new Error("provider down");
        sent.push(message);
      }),
    };
    await runDeadmanTick(db, deps, tickNow);

    // u2 still processed.
    expect(getConfig(db, "u2")?.state).toBe("grace");
    expect(sent.some((m) => m.recipient === "u2@example.com")).toBe(true);
    // u1's failure recorded without leaking content.
    const u1Reminder = listEvents(db, "u1", 100).find((e) => e.type === "reminder_sent");
    expect(u1Reminder).toBeDefined();
    expect(u1Reminder?.detail ?? "").not.toContain("u1@example.com");
  });
});
