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
}

/** Map a stored row to the public Contact shape (omitting the internal value_norm). */
function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    type: row.type as ContactType,
    value: row.value,
    createdAt: row.created_at,
  };
}

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
      "SELECT id, type, value, created_at FROM contact WHERE user_id = ? ORDER BY created_at ASC, id ASC",
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
      "SELECT id, type, value, created_at FROM contact WHERE user_id = ? AND type = ? AND value_norm = ?",
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
  return { id, type, value, createdAt: now };
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

/** The maximum number of contacts a single user may store (re-exported for callers). */
export { CONTACT_LIMIT };
