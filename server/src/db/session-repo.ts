import type { Db } from "./index";
import { generateSessionId } from "../auth/tokens";

/** Sliding inactivity window for a refresh session (~24h) per FR-014 / SC-008. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  last_used_at: string;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function plus24h(now: Date): string {
  return new Date(now.getTime() + SESSION_TTL_MS).toISOString();
}

/**
 * Create a session backing one refresh token. `expires_at` is set to now + 24h
 * (the sliding inactivity window). Only the token hash is stored.
 */
export function createSession(
  db: Db,
  params: { userId: string; tokenHash: string },
  now: Date = new Date(),
): Session {
  const nowIso = now.toISOString();
  const row: SessionRow = {
    id: generateSessionId(),
    user_id: params.userId,
    token_hash: params.tokenHash,
    expires_at: plus24h(now),
    created_at: nowIso,
    last_used_at: nowIso,
  };
  db.prepare(
    `INSERT INTO session (id, user_id, token_hash, expires_at, created_at, last_used_at)
     VALUES (@id, @user_id, @token_hash, @expires_at, @created_at, @last_used_at)`,
  ).run(row);
  return toSession(row);
}

/** Find a non-deleted session by its token hash, or null when none matches. */
export function findByTokenHash(db: Db, tokenHash: string): Session | null {
  const row = db
    .prepare(
      "SELECT id, user_id, token_hash, expires_at, created_at, last_used_at FROM session WHERE token_hash = ?",
    )
    .get(tokenHash) as SessionRow | undefined;
  return row ? toSession(row) : null;
}

/** True when the session's sliding window has elapsed (≥24h since last use). */
export function isExpired(session: Session, now: Date = new Date()): boolean {
  return new Date(session.expiresAt).getTime() <= now.getTime();
}

/**
 * Rotate a session's refresh token: store the new hash, slide `expires_at` forward
 * 24h, and update `last_used_at`. Returns the rotated session.
 */
export function rotate(db: Db, id: string, newTokenHash: string, now: Date = new Date()): Session {
  const nowIso = now.toISOString();
  const expiresAt = plus24h(now);
  db.prepare(
    `UPDATE session
       SET token_hash = @token_hash, expires_at = @expires_at, last_used_at = @last_used_at
     WHERE id = @id`,
  ).run({ id, token_hash: newTokenHash, expires_at: expiresAt, last_used_at: nowIso });
  return toSession(
    db
      .prepare(
        "SELECT id, user_id, token_hash, expires_at, created_at, last_used_at FROM session WHERE id = ?",
      )
      .get(id) as SessionRow,
  );
}

/** Delete a session by id (logout / revocation). Idempotent. */
export function deleteById(db: Db, id: string): void {
  db.prepare("DELETE FROM session WHERE id = ?").run(id);
}

/** Delete all sessions whose sliding window has elapsed. Returns the count removed. */
export function sweepExpired(db: Db, now: Date = new Date()): number {
  const result = db.prepare("DELETE FROM session WHERE expires_at <= ?").run(now.toISOString());
  return result.changes;
}
