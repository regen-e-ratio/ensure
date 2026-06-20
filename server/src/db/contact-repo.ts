import { randomUUID } from "node:crypto";
import type { components } from "@ensure/shared/api";
import { CONTACT_LIMIT } from "@ensure/shared/constants";
import type { Db } from "./index";

export type Contact = components["schemas"]["Contact"];
export type ContactType = Contact["type"];

interface ContactRow {
  id: string;
  type: string;
  value: string;
  created_at: string;
  verified_at: string | null;
  verification_token_hash: string | null;
  verification_expires_at: string | null;
}

/**
 * Map a stored row to the public Contact shape (omitting the internal value_norm). The
 * derived `verified` flag and `verifiedAt` come purely from `verified_at` — so a
 * pre-existing row (null `verified_at`) is unverified by default (FR-002, SC-004). The
 * verification token hash and expiry are internal and are never serialized (FR-002).
 */
function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    type: row.type as ContactType,
    value: row.value,
    createdAt: row.created_at,
    verified: row.verified_at != null,
    verifiedAt: row.verified_at ?? null,
  };
}

/** Columns selected wherever a full Contact (incl. derived verification state) is built. */
const CONTACT_COLUMNS =
  "id, type, value, created_at, verified_at, verification_token_hash, verification_expires_at";

/**
 * Normalize a contact value for case-insensitive duplicate detection (FR-008): trim
 * surrounding whitespace and lowercase. The stored `value` keeps its original case for
 * display (FR-013); only this derived form is compared and constrained as unique.
 */
export function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

/** Delete all contact rows (test-only helper for resetting state between e2e runs). */
export function clearContacts(db: Db): void {
  db.prepare("DELETE FROM contact").run();
}

/**
 * Read the caller's own contacts (scoped by `userId`), ordered by creation time. There
 * is no way to address another user's contacts (FR-003, FR-012).
 */
export function listContacts(db: Db, userId: string): Contact[] {
  const rows = db
    .prepare(
      `SELECT ${CONTACT_COLUMNS} FROM contact WHERE user_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(userId) as ContactRow[];
  return rows.map(toContact);
}

/**
 * Read the caller's own VERIFIED contacts (scoped by `userId`, `verified_at IS NOT NULL`),
 * ordered by creation time. Used by feature 010 to snapshot exactly the contacts eligible to
 * receive a release — unverified contacts never get a grant (FR-001, SC-003).
 */
export function listVerifiedContacts(db: Db, userId: string): Contact[] {
  const rows = db
    .prepare(
      `SELECT ${CONTACT_COLUMNS} FROM contact
       WHERE user_id = ? AND verified_at IS NOT NULL
       ORDER BY created_at ASC, id ASC`,
    )
    .all(userId) as ContactRow[];
  return rows.map(toContact);
}

/** Count the caller's contacts — used to enforce the per-user limit (FR-015). */
export function countContacts(db: Db, userId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM contact WHERE user_id = ?")
    .get(userId) as { n: number };
  return row.n;
}

/**
 * Find the caller's contact whose normalized value matches (case-insensitive, trimmed),
 * or null. Used for a friendly duplicate check before insert (FR-008).
 */
export function findByNormalized(
  db: Db,
  userId: string,
  type: ContactType,
  valueNorm: string,
): Contact | null {
  const row = db
    .prepare(
      `SELECT ${CONTACT_COLUMNS} FROM contact WHERE user_id = ? AND type = ? AND value_norm = ?`,
    )
    .get(userId, type, valueNorm) as ContactRow | undefined;
  return row ? toContact(row) : null;
}

/**
 * Insert a new contact for the caller and return it. Stores `value` as given (the route
 * passes the trimmed value, original case preserved; FR-013) plus a normalized form used
 * only for the case-insensitive UNIQUE(user_id, type, value_norm) constraint (FR-008).
 * Callers are expected to have already validated, de-duplicated, and limit-checked.
 */
export function addContact(
  db: Db,
  userId: string,
  type: ContactType,
  value: string,
  now: string = new Date().toISOString(),
): Contact {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO contact (id, user_id, type, value, value_norm, created_at)
     VALUES (@id, @userId, @type, @value, @valueNorm, @now)`,
  ).run({ id, userId, type, value, valueNorm: normalizeValue(value), now });
  // A freshly added contact is unverified by default (FR-001/FR-002).
  return { id, type, value, createdAt: now, verified: false, verifiedAt: null };
}

/**
 * Remove the caller's contact by id. Scoped to `userId`, so a contact owned by another
 * user is treated like a non-existent one. Returns whether a row was actually deleted
 * (the route is idempotent and returns 204 either way; FR-003, US3 #3).
 */
export function removeContact(db: Db, userId: string, id: string): boolean {
  const info = db.prepare("DELETE FROM contact WHERE id = ? AND user_id = ?").run(id, userId);
  return info.changes > 0;
}

/**
 * Read one of the caller's own contacts by id (scoped by `userId`), or null. The authed
 * send endpoint uses this so a contact id that is not the caller's own is indistinguishable
 * from a non-existent one — one user can neither verify nor probe another's contacts (FR-006).
 */
export function getContactById(db: Db, userId: string, id: string): Contact | null {
  const row = db
    .prepare(`SELECT ${CONTACT_COLUMNS} FROM contact WHERE id = ? AND user_id = ?`)
    .get(id, userId) as ContactRow | undefined;
  return row ? toContact(row) : null;
}

/**
 * Store (or overwrite) the verification token hash + expiry on the caller's own contact.
 * Resend-safe: each call replaces any prior hash/expiry, so only the most recently issued
 * link is valid (FR-005). The raw token is never passed here — only its SHA-256 hash. Returns
 * whether a matching owned row was updated.
 */
export function setVerificationToken(
  db: Db,
  userId: string,
  id: string,
  tokenHash: string,
  expiresAt: string,
): boolean {
  const info = db
    .prepare(
      `UPDATE contact
         SET verification_token_hash = ?, verification_expires_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(tokenHash, expiresAt, id, userId);
  return info.changes > 0;
}

/** The fields the public verify route needs to enforce expiry/single-use, without exposing them. */
export interface VerificationLookup {
  id: string;
  verifiedAt: string | null;
  expiresAt: string | null;
}

/**
 * PUBLIC look-up of a contact by its verification token hash (no `userId` — authority is the
 * token alone, FR-008). Returns the minimal fields the verify route needs (id, current
 * `verified_at`, current expiry), or null when no contact carries that hash (fail-closed,
 * non-disclosing — FR-010). The partial index on `verification_token_hash` backs this read.
 */
export function findByVerificationHash(db: Db, tokenHash: string): VerificationLookup | null {
  const row = db
    .prepare(
      `SELECT id, verified_at, verification_expires_at
         FROM contact WHERE verification_token_hash = ?`,
    )
    .get(tokenHash) as
    | { id: string; verified_at: string | null; verification_expires_at: string | null }
    | undefined;
  if (!row) return null;
  return { id: row.id, verifiedAt: row.verified_at, expiresAt: row.verification_expires_at };
}

/** The outcome of {@link markVerified}: whether this call set `verified_at`, or it was already set. */
export type MarkVerifiedResult = "verified" | "already_verified";

/**
 * Mark a contact verified and consume its token (single-use). Idempotent: `verified_at` is
 * set only when currently null (returns "verified"); if it was already set, the timestamp is
 * left unchanged (returns "already_verified", FR-011). Either way the verification token hash
 * is cleared so the link cannot be replayed (FR-009, single-use). No `userId` — the caller
 * has already proven authority by token.
 */
export function markVerified(db: Db, id: string, now: string = new Date().toISOString()): MarkVerifiedResult {
  const row = db
    .prepare("SELECT verified_at FROM contact WHERE id = ?")
    .get(id) as { verified_at: string | null } | undefined;
  const alreadyVerified = row?.verified_at != null;

  if (alreadyVerified) {
    // Idempotent: keep the original verified_at, but still burn the token so the link is single-use.
    db.prepare(
      "UPDATE contact SET verification_token_hash = NULL, verification_expires_at = NULL WHERE id = ?",
    ).run(id);
    return "already_verified";
  }

  db.prepare(
    `UPDATE contact
       SET verified_at = ?, verification_token_hash = NULL, verification_expires_at = NULL
     WHERE id = ?`,
  ).run(now, id);
  return "verified";
}

/** The maximum number of contacts a single user may store (re-exported for callers). */
export { CONTACT_LIMIT };
