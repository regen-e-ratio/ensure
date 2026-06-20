import { randomUUID } from "node:crypto";
import type { Db } from "./index";

/**
 * Repository over the feature-011 `checkin_token` table (roadmap §3). Each grace reminder mints a
 * fresh one-time check-in token and persists ONLY its SHA-256 hash here (never the raw token), with
 * the owning `user_id` (so the PUBLIC check-in route derives the user without a session), a future
 * `expires_at`, and a nullable `used_at` (set on the first successful check-in; single-use). No raw
 * token is ever persisted or logged — only the hash and metadata (FR-002, FR-014, SC-005).
 */

/**
 * The minimal fields the PUBLIC check-in route needs to enforce expiry / single-use and to derive
 * the owning user. `userId` is the switch owner (carried so the public route checks in without a
 * session). The raw token is never returned — the caller looked the row up by token hash.
 */
export interface CheckinTokenLookup {
  id: string;
  userId: string;
  usedAt: string | null;
  expiresAt: string;
}

interface CheckinTokenRow {
  id: string;
  user_id: string;
  used_at: string | null;
  expires_at: string;
}

/** Insert a check-in token row for `userId`, storing ONLY the token hash. Returns the new id. */
export function createCheckinToken(
  db: Db,
  userId: string,
  tokenHash: string,
  expiresAt: string,
  now: string,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO checkin_token (id, user_id, token_hash, expires_at, used_at, created_at)
     VALUES (@id, @userId, @tokenHash, @expiresAt, NULL, @now)`,
  ).run({ id, userId, tokenHash, expiresAt, now });
  return id;
}

/**
 * PUBLIC look-up of a check-in token by its token hash (no `userId` — authority is the token
 * alone). The `idx_checkin_token_hash` index backs this read. Returns the minimal fields the
 * check-in route needs, or null when no row carries that hash (fail-closed, non-disclosing).
 */
export function findByTokenHash(db: Db, tokenHash: string): CheckinTokenLookup | null {
  const row = db
    .prepare(
      `SELECT id, user_id, used_at, expires_at FROM checkin_token WHERE token_hash = ?`,
    )
    .get(tokenHash) as CheckinTokenRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    usedAt: row.used_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Mark a check-in token used (single-use). Sets `used_at` only when it is currently null and
 * returns whether THIS call consumed it. A concurrent/replayed open therefore sets it at most once,
 * even if a SELECT raced — the `used_at IS NULL` guard is the source of truth (mirrors
 * markGrantViewed in release-repo.ts).
 */
export function markUsed(db: Db, id: string, now: string): boolean {
  const info = db
    .prepare(`UPDATE checkin_token SET used_at = ? WHERE id = ? AND used_at IS NULL`)
    .run(now, id);
  return info.changes > 0;
}

/** Delete all check-in tokens (test-reset path; mirrors clearDeadman). */
export function clearCheckinTokens(db: Db): void {
  db.prepare("DELETE FROM checkin_token").run();
}
