import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/index";
import {
  createCheckinToken,
  findByTokenHash,
  markUsed,
  clearCheckinTokens,
} from "../../src/db/checkin-token-repo";
import { mintToken, hashToken } from "../../src/deadman/tokens";

let db: Db;

function seedUser(id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

const NOW = "2026-06-20T00:00:00.000Z";
const EXPIRES = "2026-06-22T00:00:00.000Z";

beforeEach(() => {
  db = openDb(":memory:");
  seedUser("owner");
});

describe("checkin-token-repo (feature 011)", () => {
  it("createCheckinToken stores ONLY the token hash, never the raw token", () => {
    const token = mintToken();
    const hash = hashToken(token);
    createCheckinToken(db, "owner", hash, EXPIRES, NOW);

    const row = db.prepare("SELECT * FROM checkin_token").get() as {
      token_hash: string;
      user_id: string;
      used_at: string | null;
      expires_at: string;
    };
    expect(row.token_hash).toBe(hash);
    expect(row.user_id).toBe("owner");
    expect(row.used_at).toBeNull();
    expect(row.expires_at).toBe(EXPIRES);
    // The raw token is never persisted in any column.
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("findByTokenHash returns the owning user, used_at, and expiry for a known hash", () => {
    const token = mintToken();
    const hash = hashToken(token);
    createCheckinToken(db, "owner", hash, EXPIRES, NOW);

    const lookup = findByTokenHash(db, hash);
    expect(lookup).not.toBeNull();
    expect(lookup!.userId).toBe("owner");
    expect(lookup!.usedAt).toBeNull();
    expect(lookup!.expiresAt).toBe(EXPIRES);
  });

  it("findByTokenHash returns null for an unknown hash (fail-closed, non-disclosing)", () => {
    expect(findByTokenHash(db, hashToken(mintToken()))).toBeNull();
  });

  it("markUsed consumes the token exactly once: first call true, second false", () => {
    const hash = hashToken(mintToken());
    const id = createCheckinToken(db, "owner", hash, EXPIRES, NOW);

    expect(markUsed(db, id, NOW)).toBe(true);
    expect(markUsed(db, id, "2026-06-21T00:00:00.000Z")).toBe(false);

    const row = db.prepare("SELECT used_at FROM checkin_token WHERE id = ?").get(id) as {
      used_at: string | null;
    };
    // used_at is set once (to the first call's timestamp) and never overwritten.
    expect(row.used_at).toBe(NOW);
  });

  it("clearCheckinTokens wipes every row (test-reset path)", () => {
    createCheckinToken(db, "owner", hashToken(mintToken()), EXPIRES, NOW);
    createCheckinToken(db, "owner", hashToken(mintToken()), EXPIRES, NOW);
    clearCheckinTokens(db);
    const count = db.prepare("SELECT COUNT(*) AS n FROM checkin_token").get() as { n: number };
    expect(count.n).toBe(0);
  });
});
