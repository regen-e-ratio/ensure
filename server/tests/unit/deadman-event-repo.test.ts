import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import { recordEvent, listEvents } from "../../src/deadman/event-repo";

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

describe("event-repo — recordEvent + listEvents (US3)", () => {
  it("appends an event with a generated id and stored detail", () => {
    const ev = recordEvent(db, "u1", "armed", { nextCheckinDueAt: "x" }, "2026-06-20T00:00:00.000Z");
    expect(ev.id).toBeTruthy();
    expect(ev.type).toBe("armed");
    const list = listEvents(db, "u1");
    expect(list).toHaveLength(1);
    expect(JSON.parse(list[0]!.detail as string)).toEqual({ nextCheckinDueAt: "x" });
  });

  it("stores a null detail when none is given", () => {
    recordEvent(db, "u1", "triggered", null, "2026-06-20T00:00:00.000Z");
    expect(listEvents(db, "u1")[0]!.detail).toBeNull();
  });

  it("returns events newest-first", () => {
    recordEvent(db, "u1", "armed", null, "2026-06-20T00:00:01.000Z");
    recordEvent(db, "u1", "checkin", null, "2026-06-20T00:00:03.000Z");
    recordEvent(db, "u1", "entered_grace", null, "2026-06-20T00:00:02.000Z");
    expect(listEvents(db, "u1").map((e) => e.type)).toEqual([
      "checkin",
      "entered_grace",
      "armed",
    ]);
  });

  it("scopes events to the owning user (FR-018)", () => {
    recordEvent(db, "u1", "armed", null);
    recordEvent(db, "u2", "armed", null);
    expect(listEvents(db, "u1")).toHaveLength(1);
    expect(listEvents(db, "u2")).toHaveLength(1);
  });

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) {
      recordEvent(db, "u1", "checkin", null, `2026-06-20T00:00:0${i}.000Z`);
    }
    expect(listEvents(db, "u1", 2)).toHaveLength(2);
  });
});
