import type { components } from "@ensure/shared/api";
import type { Db } from "./index";
import type { Keyring, KeyVersion } from "../crypto/keyring";
import { open, seal } from "../crypto/note-cipher";

export type Note = components["schemas"]["Note"];

/**
 * Thrown when a stored note cannot be decrypted — its `key_version` is absent from the
 * keyring, or the GCM auth tag fails. The read path maps this to a fail-closed error
 * and never returns plaintext (FR-015). Carries no key material or plaintext.
 */
export class NoteDecryptError extends Error {
  constructor(message = "note could not be decrypted") {
    super(message);
    this.name = "NoteDecryptError";
  }
}

interface NoteRow {
  ciphertext: Buffer;
  key_version: number;
  created_at: string;
  updated_at: string;
}

/** Delete all note rows (test-only helper for resetting state between e2e runs). */
export function clearNote(db: Db): void {
  db.prepare("DELETE FROM note").run();
}

/**
 * Decrypt a row, failing closed (FR-015): if the key version is unavailable or the
 * auth tag does not verify, throw {@link NoteDecryptError} rather than returning
 * anything. No secrets or plaintext are included in the error.
 */
function decryptRow(row: Pick<NoteRow, "ciphertext" | "key_version">, keyring: Keyring): string {
  if (!keyring.hasVersion(row.key_version)) {
    throw new NoteDecryptError();
  }
  try {
    return open(keyring.getKey(row.key_version), row.ciphertext);
  } catch {
    throw new NoteDecryptError();
  }
}

/**
 * Read and decrypt the caller's own note (scoped by `userId`), or null when none has
 * been saved. There is no way to address another user's note (FR-002, FR-003). Throws
 * {@link NoteDecryptError} if the stored row cannot be decrypted (FR-015).
 */
export function getNote(db: Db, userId: string, keyring: Keyring): Note | null {
  const row = db
    .prepare("SELECT ciphertext, key_version, created_at, updated_at FROM note WHERE user_id = ?")
    .get(userId) as NoteRow | undefined;
  if (!row) {
    return null;
  }
  return {
    text: decryptRow(row, keyring),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Read and decrypt a specific owner's note by their user id, for the PUBLIC release-view route
 * (feature 010): a verified contact opens a one-time link with no session, so the note owner is
 * carried by the release grant rather than by `req.user`. This is the only path that decrypts a
 * note not scoped to the caller, and it is reachable only after a valid grant lookup. Returns
 * null when the owner has no note; throws {@link NoteDecryptError} (fail-closed) if the stored
 * row cannot be decrypted — the caller maps that to a 500 and never returns plaintext (FR-010).
 */
export function getNoteForOwner(db: Db, ownerUserId: string, keyring: Keyring): Note | null {
  return getNote(db, ownerUserId, keyring);
}

/**
 * Encrypt `text` with the keyring's **active** version and create or replace the
 * caller's note in place. Preserves `created_at` across updates and advances
 * `updated_at` (last-write-wins; FR-018, FR-019). Because every save uses the active
 * version, saving a note sealed under an older version transparently migrates it
 * forward (lazy migration; FR-012, FR-012a). Returns the stored note.
 */
export function upsertNote(
  db: Db,
  userId: string,
  text: string,
  keyring: Keyring,
  now: string = new Date().toISOString(),
): Note {
  const version = keyring.getActiveVersion();
  const ciphertext = seal(keyring.getKey(version), text);
  db.prepare(
    `INSERT INTO note (user_id, ciphertext, key_version, created_at, updated_at)
     VALUES (@userId, @ciphertext, @version, @now, @now)
     ON CONFLICT(user_id) DO UPDATE SET
       ciphertext  = excluded.ciphertext,
       key_version = excluded.key_version,
       updated_at  = excluded.updated_at`,
  ).run({ userId, ciphertext, version, now });
  // getNote never returns null immediately after upserting this user's row.
  return getNote(db, userId, keyring) as Note;
}

/** Count note rows still protected by `version` (retirement guard; FR-014). */
export function notesUsingVersion(db: Db, version: KeyVersion): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM note WHERE key_version = ?").get(version) as {
    n: number;
  };
  return row.n;
}

/**
 * Bulk re-encrypt every note still under a non-active version to the active version
 * (operator-run migration; FR-013), so an old key can be retired. Each row is
 * decrypted with its recorded version and re-sealed with the active key; `created_at`
 * and `updated_at` are left untouched (this is a re-seal, not a content edit). A row
 * whose version is unavailable / fails its auth tag throws {@link NoteDecryptError}
 * loudly rather than being skipped (FR-015). Runs in a single transaction. Returns the
 * number migrated plus a per-version count of all rows afterward.
 */
export function reencryptAll(
  db: Db,
  keyring: Keyring,
): { migrated: number; perVersion: Record<number, number> } {
  const active = keyring.getActiveVersion();
  const activeKey = keyring.getKey(active);
  const stale = db
    .prepare("SELECT user_id, ciphertext, key_version FROM note WHERE key_version <> ?")
    .all(active) as { user_id: string; ciphertext: Buffer; key_version: number }[];
  const update = db.prepare(
    "UPDATE note SET ciphertext = @ciphertext, key_version = @active WHERE user_id = @userId",
  );

  const run = db.transaction((rows: typeof stale) => {
    for (const row of rows) {
      const plaintext = decryptRow(row, keyring);
      update.run({ ciphertext: seal(activeKey, plaintext), active, userId: row.user_id });
    }
    return rows.length;
  });
  const migrated = run(stale);

  const counts = db
    .prepare("SELECT key_version, COUNT(*) AS n FROM note GROUP BY key_version")
    .all() as { key_version: number; n: number }[];
  const perVersion: Record<number, number> = {};
  for (const { key_version, n } of counts) {
    perVersion[key_version] = n;
  }
  return { migrated, perVersion };
}
