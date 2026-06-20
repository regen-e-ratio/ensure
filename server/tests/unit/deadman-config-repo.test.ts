import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import {
  getConfig,
  upsertConfig,
  recordCheckin,
  setState,
  listDue,
  clearDeadman,
  toStatus,
} from "../../src/deadman/config-repo";

let db: Db;

function seedUser(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

beforeEach(() => {
  db = openDb(":memory:");
  seedUser("u1");
  seedUser("u2");
});

const NOW = "2026-06-20T00:00:00.000Z";
const ARM = { checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true };

describe("config-repo — getConfig (US1)", () => {
  it("returns null for a never-configured user", () => {
    expect(getConfig(db, "u1")).toBeNull();
  });
});

describe("config-repo — upsertConfig arm/disarm (US1, US4)", () => {
  it("arms: disarmed → active with next_checkin_due_at = now + interval", () => {
    const config = upsertConfig(db, "u1", ARM, NOW);
    expect(config.state).toBe("active");
    expect(config.enabled).toBe(true);
    expect(config.nextCheckinDueAt).toBe("2026-06-27T00:00:00.000Z");
    expect(config.lastCheckinAt).toBe(NOW);
  });

  it("disarms: clears the live deadlines and reminders", () => {
    upsertConfig(db, "u1", ARM, NOW);
    const disarmed = upsertConfig(db, "u1", { ...ARM, enabled: false }, NOW);
    expect(disarmed.state).toBe("disarmed");
    expect(disarmed.enabled).toBe(false);
    expect(disarmed.nextCheckinDueAt).toBeNull();
    expect(disarmed.graceDeadlineAt).toBeNull();
    expect(disarmed.remindersSent).toBe(0);
  });

  it("preserves created_at across updates", () => {
    const first = upsertConfig(db, "u1", ARM, NOW);
    const later = upsertConfig(db, "u1", ARM, "2026-06-21T00:00:00.000Z");
    expect(later.createdAt).toBe(first.createdAt);
  });

  it("is scoped per user", () => {
    upsertConfig(db, "u1", ARM, NOW);
    expect(getConfig(db, "u2")).toBeNull();
  });
});

describe("config-repo — recordCheckin (US1)", () => {
  it("resets the deadline to now + interval and returns to active", () => {
    upsertConfig(db, "u1", ARM, NOW);
    const later = "2026-06-22T00:00:00.000Z";
    const updated = recordCheckin(db, "u1", later);
    expect(updated?.state).toBe("active");
    expect(updated?.lastCheckinAt).toBe(later);
    expect(updated?.nextCheckinDueAt).toBe("2026-06-29T00:00:00.000Z");
    expect(updated?.graceDeadlineAt).toBeNull();
    expect(updated?.remindersSent).toBe(0);
  });

  it("returns null for a non-existent config", () => {
    expect(recordCheckin(db, "u1", NOW)).toBeNull();
  });
});

describe("config-repo — setState (US2)", () => {
  it("moves to grace, sets the grace deadline + reminders", () => {
    upsertConfig(db, "u1", ARM, NOW);
    setState(db, "u1", "grace", { graceDeadlineAt: "2026-06-29T00:00:00.000Z", remindersSent: 1 }, NOW);
    const config = getConfig(db, "u1");
    expect(config?.state).toBe("grace");
    expect(config?.graceDeadlineAt).toBe("2026-06-29T00:00:00.000Z");
    expect(config?.remindersSent).toBe(1);
  });

  it("can clear the grace deadline (null)", () => {
    upsertConfig(db, "u1", ARM, NOW);
    setState(db, "u1", "active", { graceDeadlineAt: null, remindersSent: 0 }, NOW);
    expect(getConfig(db, "u1")?.graceDeadlineAt).toBeNull();
  });
});

describe("config-repo — listDue (US2, US4)", () => {
  it("selects active rows whose deadline is at/before now", () => {
    upsertConfig(db, "u1", ARM, NOW); // due at 2026-06-27
    const due = listDue(db, "2026-06-28T00:00:00.000Z");
    expect(due.map((c) => c.userId)).toEqual(["u1"]);
  });

  it("excludes active rows whose deadline is still in the future", () => {
    upsertConfig(db, "u1", ARM, NOW);
    expect(listDue(db, "2026-06-25T00:00:00.000Z")).toEqual([]);
  });

  it("always includes grace rows", () => {
    upsertConfig(db, "u1", ARM, NOW);
    setState(db, "u1", "grace", { graceDeadlineAt: "2026-06-29T00:00:00.000Z", remindersSent: 1 }, NOW);
    const due = listDue(db, "2026-06-27T12:00:00.000Z");
    expect(due.map((c) => c.userId)).toEqual(["u1"]);
  });

  it("excludes disarmed and triggered rows", () => {
    upsertConfig(db, "u1", { ...ARM, enabled: false }, NOW); // disarmed
    upsertConfig(db, "u2", ARM, NOW);
    setState(db, "u2", "triggered", {}, NOW);
    expect(listDue(db, "2030-01-01T00:00:00.000Z")).toEqual([]);
  });
});

describe("config-repo — clearDeadman + toStatus", () => {
  it("clearDeadman removes all rows", () => {
    upsertConfig(db, "u1", ARM, NOW);
    clearDeadman(db);
    expect(getConfig(db, "u1")).toBeNull();
  });

  it("toStatus computes secondsUntilDue from the active deadline", () => {
    const config = upsertConfig(db, "u1", ARM, NOW);
    const status = toStatus(config, NOW, []);
    expect(status.secondsUntilDue).toBe(604800);
    expect(status.state).toBe("active");
  });

  it("toStatus uses the grace deadline while in grace", () => {
    upsertConfig(db, "u1", ARM, NOW);
    setState(db, "u1", "grace", { graceDeadlineAt: "2026-06-29T00:00:00.000Z", remindersSent: 1 }, NOW);
    const config = getConfig(db, "u1")!;
    const status = toStatus(config, "2026-06-28T00:00:00.000Z", []);
    expect(status.secondsUntilDue).toBe(86400);
  });
});
