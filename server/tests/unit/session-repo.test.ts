import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import { upsertUser } from "../../src/db/user-repo";
import {
  SESSION_TTL_MS,
  createSession,
  deleteById,
  findByTokenHash,
  isExpired,
  rotate,
  sweepExpired,
} from "../../src/db/session-repo";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
  upsertUser(db, { sub: "u1", email: "u1@example.com", name: null });
});

describe("session-repo", () => {
  it("creates a session with a 24h sliding expiry and finds it by hash", () => {
    const now = new Date("2026-06-05T10:00:00.000Z");
    const session = createSession(db, { userId: "u1", tokenHash: "hash-a" }, now);
    expect(session.userId).toBe("u1");
    expect(session.expiresAt).toBe(new Date(now.getTime() + SESSION_TTL_MS).toISOString());

    const found = findByTokenHash(db, "hash-a");
    expect(found?.id).toBe(session.id);
  });

  it("returns null for an unknown hash", () => {
    expect(findByTokenHash(db, "nope")).toBeNull();
  });

  it("rotates the token, slides expiry forward 24h, and updates last_used_at", () => {
    const created = new Date("2026-06-05T10:00:00.000Z");
    const session = createSession(db, { userId: "u1", tokenHash: "old" }, created);

    const later = new Date("2026-06-05T20:00:00.000Z");
    const rotated = rotate(db, session.id, "new", later);

    expect(rotated.tokenHash).toBe("new");
    expect(rotated.lastUsedAt).toBe(later.toISOString());
    expect(rotated.expiresAt).toBe(new Date(later.getTime() + SESSION_TTL_MS).toISOString());
    // Old hash no longer resolves; the new one does.
    expect(findByTokenHash(db, "old")).toBeNull();
    expect(findByTokenHash(db, "new")?.id).toBe(session.id);
  });

  it("treats a session past its expiry as expired", () => {
    const created = new Date("2026-06-05T10:00:00.000Z");
    const session = createSession(db, { userId: "u1", tokenHash: "h" }, created);
    const within24h = new Date(created.getTime() + SESSION_TTL_MS - 1000);
    const after24h = new Date(created.getTime() + SESSION_TTL_MS + 1000);
    expect(isExpired(session, within24h)).toBe(false);
    expect(isExpired(session, after24h)).toBe(true);
  });

  it("deletes a session by id (idempotent)", () => {
    const session = createSession(db, { userId: "u1", tokenHash: "h" });
    deleteById(db, session.id);
    expect(findByTokenHash(db, "h")).toBeNull();
    expect(() => deleteById(db, session.id)).not.toThrow();
  });

  it("sweeps only expired sessions", () => {
    const old = new Date("2026-06-01T10:00:00.000Z");
    createSession(db, { userId: "u1", tokenHash: "stale" }, old);
    const fresh = createSession(db, { userId: "u1", tokenHash: "fresh" }, new Date());

    const removed = sweepExpired(db, new Date());
    expect(removed).toBe(1);
    expect(findByTokenHash(db, "stale")).toBeNull();
    expect(findByTokenHash(db, "fresh")?.id).toBe(fresh.id);
  });
});
