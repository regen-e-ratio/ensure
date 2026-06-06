import type { components } from "@ensure/shared/api";
import type { Db } from "./index";

export type Note = components["schemas"]["Note"];

interface NoteRow {
  text: string;
  created_at: string;
  updated_at: string;
}

function toNote(row: NoteRow): Note {
  return { text: row.text, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** Delete the stored note (test-only helper for resetting state between e2e runs). */
export function clearNote(db: Db): void {
  db.prepare("DELETE FROM note").run();
}

/** Return the single stored note, or null when none has been saved yet. */
export function getNote(db: Db): Note | null {
  const row = db.prepare("SELECT text, created_at, updated_at FROM note WHERE id = 1").get() as
    | NoteRow
    | undefined;
  return row ? toNote(row) : null;
}

/**
 * Create or replace the single note. Preserves created_at across updates and
 * advances updated_at on every save (last-write-wins). Returns the stored note.
 */
export function upsertNote(db: Db, text: string, now: string = new Date().toISOString()): Note {
  db.prepare(
    `INSERT INTO note (id, text, created_at, updated_at)
     VALUES (1, @text, @now, @now)
     ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
  ).run({ text, now });
  // getNote never returns null immediately after an insert/update of id = 1.
  return getNote(db) as Note;
}
