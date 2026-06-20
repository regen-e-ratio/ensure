import { randomUUID } from "node:crypto";
import type { components } from "@ensure/shared/api";
import type { Db } from "../db/index";

export type DeadmanEvent = components["schemas"]["DeadmanEvent"];
export type DeadmanEventType = DeadmanEvent["type"];

interface EventRow {
  id: string;
  type: string;
  detail: string | null;
  created_at: string;
}

/** Map a stored row to the public {@link DeadmanEvent}. */
function toEvent(row: EventRow): DeadmanEvent {
  return {
    id: row.id,
    type: row.type as DeadmanEventType,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

/**
 * Append an audit event for the caller (FR-016). The optional `detail` is stored as JSON;
 * callers MUST NOT pass note plaintext or any token value (FR-017) — only small,
 * non-sensitive metadata (e.g. `{ from, to }` states, a reminder index). Append-only:
 * events are never updated or deleted.
 */
export function recordEvent(
  db: Db,
  userId: string,
  type: DeadmanEventType,
  detail?: Record<string, unknown> | null,
  now: string = new Date().toISOString(),
): DeadmanEvent {
  const id = randomUUID();
  const detailJson = detail == null ? null : JSON.stringify(detail);
  db.prepare(
    `INSERT INTO deadman_event (id, user_id, type, detail, created_at)
     VALUES (@id, @userId, @type, @detail, @now)`,
  ).run({ id, userId, type, detail: detailJson, now });
  return { id, type, detail: detailJson, createdAt: now };
}

/**
 * List the caller's recent events newest-first (FR-016), scoped to `userId` (FR-018), at
 * most `limit`. Uses the `(user_id, created_at)` index. The secondary `id DESC` makes the
 * order deterministic for events sharing a timestamp.
 */
export function listEvents(db: Db, userId: string, limit = 50): DeadmanEvent[] {
  const rows = db
    .prepare(
      `SELECT id, type, detail, created_at FROM deadman_event
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(userId, limit) as EventRow[];
  return rows.map(toEvent);
}
