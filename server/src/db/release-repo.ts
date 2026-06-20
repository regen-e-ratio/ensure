import { randomUUID } from "node:crypto";
import type { Db } from "./index";

/**
 * Repository over the feature-010 `release` and `release_grant` tables. A release groups the
 * grants created for one fired (or test) cycle; each grant carries a one-time token stored ONLY
 * as its SHA-256 hash (never the raw token), a future `expires_at`, a view-once `viewed_at`, and
 * per-grant email delivery status. No note plaintext or raw token is ever persisted here — only
 * the hash and metadata (FR-012, FR-017, SC-008).
 */

/** A release row (audit grouping for one fired or test cycle). */
export interface Release {
  id: string;
  userId: string;
  trigger: "schedule" | "manual_test";
  createdAt: string;
}

/** The per-grant email delivery status (`pending` until a send attempt resolves). */
export type GrantEmailStatus = "pending" | "sent" | "failed";

/**
 * The minimal fields the PUBLIC open route needs to enforce expiry / view-once and to decrypt
 * the owner's note. `userId` is the note OWNER (carried so the public route can decrypt without
 * a session). The raw token is never returned — the caller looked the grant up by token hash.
 */
export interface GrantLookup {
  id: string;
  ownerUserId: string;
  viewedAt: string | null;
  expiresAt: string;
}

interface GrantLookupRow {
  id: string;
  user_id: string;
  viewed_at: string | null;
  expires_at: string;
}

/** One snapshotted recipient: a verified contact id plus its (already-hashed) one-time token. */
export interface GrantSeed {
  contactId: string;
  tokenHash: string;
}

/** Insert a release row for `userId` and return it. */
export function createRelease(
  db: Db,
  userId: string,
  trigger: Release["trigger"],
  now: string,
): Release {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO release (id, user_id, trigger, created_at) VALUES (@id, @userId, @trigger, @now)`,
  ).run({ id, userId, trigger, now });
  return { id, userId, trigger, createdAt: now };
}

/**
 * Create one grant per snapshotted recipient under `releaseId`, storing ONLY each token's hash
 * (never the raw token) and a shared `expiresAt`. `userId` is the note owner (denormalized onto
 * each grant so the public route can decrypt without a session). Returns the new grant ids.
 */
export function createGrants(
  db: Db,
  releaseId: string,
  userId: string,
  seeds: GrantSeed[],
  expiresAt: string,
  now: string,
): string[] {
  const insert = db.prepare(
    `INSERT INTO release_grant
       (id, release_id, user_id, contact_id, token_hash, expires_at, viewed_at, email_status,
        provider_message_id, email_error, created_at)
     VALUES (@id, @releaseId, @userId, @contactId, @tokenHash, @expiresAt, NULL, 'pending',
        NULL, NULL, @now)`,
  );
  const ids: string[] = [];
  const run = db.transaction((rows: GrantSeed[]) => {
    for (const seed of rows) {
      const id = randomUUID();
      insert.run({
        id,
        releaseId,
        userId,
        contactId: seed.contactId,
        tokenHash: seed.tokenHash,
        expiresAt,
        now,
      });
      ids.push(id);
    }
  });
  run(seeds);
  return ids;
}

/**
 * PUBLIC look-up of a grant by its token hash (no `userId` — authority is the token alone). The
 * `idx_release_grant_token` index backs this read. Returns the minimal fields the open route
 * needs, or null when no grant carries that hash (fail-closed, non-disclosing — FR-010).
 */
export function getGrantByTokenHash(db: Db, tokenHash: string): GrantLookup | null {
  const row = db
    .prepare(
      `SELECT id, user_id, viewed_at, expires_at FROM release_grant WHERE token_hash = ?`,
    )
    .get(tokenHash) as GrantLookupRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.user_id,
    viewedAt: row.viewed_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Mark a grant viewed (single-use). Sets `viewed_at` only when it is currently null and returns
 * whether THIS call consumed it. A concurrent/replayed open therefore sets it at most once
 * (view-once), even if the SELECT above raced — the `viewed_at IS NULL` guard is the source of
 * truth.
 */
export function markGrantViewed(db: Db, grantId: string, now: string): boolean {
  const info = db
    .prepare(`UPDATE release_grant SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL`)
    .run(now, grantId);
  return info.changes > 0;
}

/** Record the outcome of a grant's email send attempt (status + optional provider id / error). */
export function setGrantEmailStatus(
  db: Db,
  grantId: string,
  status: GrantEmailStatus,
  providerMessageId?: string | null,
  error?: string | null,
): void {
  db.prepare(
    `UPDATE release_grant
       SET email_status = @status, provider_message_id = @providerMessageId, email_error = @error
     WHERE id = @grantId`,
  ).run({
    grantId,
    status,
    providerMessageId: providerMessageId ?? null,
    error: error ?? null,
  });
}

/**
 * Idempotency guard for the engine (FR-005, SC-002): whether `userId` already has a
 * scheduled-trigger release. A fired cycle creates exactly one `release` tagged `schedule`; this
 * being true means the switch already released, so a re-tick (in-process timer + external cron)
 * must NOT create a second one. Manual test releases are excluded so they never block a real fire.
 */
export function hasReleaseForCurrentCycle(db: Db, userId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM release WHERE user_id = ? AND trigger = 'schedule' LIMIT 1`,
    )
    .get(userId) as { 1: number } | undefined;
  return row !== undefined;
}
