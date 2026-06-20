import { fileURLToPath } from "node:url";
import { openCliDb, usage, isHelp } from "./_db_client_shared";
import { loadEncryption } from "../config/env";
import { getNote, upsertNote, NoteDecryptError } from "../db/note-repo";
import { upsertUser } from "../db/user-repo";
import { open } from "../crypto/note-cipher";
import { USER_FIXTURES } from "./users_db_client";
import type { Keyring } from "../crypto/keyring";
import type { Db } from "../db/index";

/**
 * Developer CLI for the `note` table. Notes are encrypted at rest, so this client loads
 * the same keyring as the server (NOTE_ENC_KEYS / NOTE_ENC_ACTIVE_VERSION) to read and
 * write plaintext. Run with `tsx` (TypeScript):
 *
 *   npx tsx server/src/cli/notes_db_client.ts -list                 # all notes, decrypted
 *   npx tsx server/src/cli/notes_db_client.ts -get-id dev-alice     # one user's note
 *   npx tsx server/src/cli/notes_db_client.ts -set-note dev-alice,"hello world"
 *   npx tsx server/src/cli/notes_db_client.ts -delete-id dev-alice
 *   npx tsx server/src/cli/notes_db_client.ts -seed                 # ensures fixture users + notes
 *
 * Or via npm: `npm run db:note --workspace server -- -list`.
 */

/** Sample notes for `-seed` (keyed to the user fixtures so the FK is satisfied). */
export const NOTE_FIXTURES = [
  { userId: "dev-alice", text: "Alice's secret note — encrypted at rest." },
  { userId: "dev-bob", text: "Bob's secret note — encrypted at rest." },
];

interface NoteRow {
  user_id: string;
  ciphertext: Buffer;
  key_version: number;
  created_at: string;
  updated_at: string;
}

/** Decrypt one row for display, falling back to a placeholder on failure. */
function decryptForDisplay(row: NoteRow, keyring: Keyring): string {
  if (!keyring.hasVersion(row.key_version)) {
    return `<no key for v${row.key_version}>`;
  }
  try {
    return open(keyring.getKey(row.key_version), row.ciphertext);
  } catch {
    return `<decrypt failed v${row.key_version}>`;
  }
}

function listNotes(db: Db, keyring: Keyring): void {
  const rows = db
    .prepare("SELECT user_id, ciphertext, key_version, created_at, updated_at FROM note ORDER BY updated_at")
    .all() as NoteRow[];
  console.table(
    rows.map((row) => ({
      user_id: row.user_id,
      key_version: row.key_version,
      text: decryptForDisplay(row, keyring),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  );
}

function getById(db: Db, keyring: Keyring, userId: string): void {
  try {
    const note = getNote(db, userId, keyring);
    if (!note) {
      console.log(`No note for user "${userId}".`);
      return;
    }
    console.table([{ user_id: userId, ...note }]);
  } catch (err) {
    if (err instanceof NoteDecryptError) {
      console.log(`Note for "${userId}" exists but could not be decrypted with the current keyring.`);
      return;
    }
    throw err;
  }
}

/** Create or replace a user's note from `userId,text` (text may contain spaces/commas). */
function setNote(db: Db, keyring: Keyring, csv: string | undefined): void {
  const raw = csv ?? "";
  // Split on the FIRST comma only: everything after it is the note text, so commas in
  // the text are preserved and whitespace around the userId can't desync the offset.
  const comma = raw.indexOf(",");
  const userId = (comma === -1 ? raw : raw.slice(0, comma)).trim();
  const text = comma === -1 ? "" : raw.slice(comma + 1).trim();
  if (!userId || !text) {
    throw new Error('-set-note needs userId,text (e.g. dev-alice,"hello world")');
  }
  const note = upsertNote(db, userId, text, keyring);
  console.log("Saved note:");
  console.table([{ user_id: userId, ...note }]);
}

function deleteById(db: Db, userId: string): void {
  const changes = db.prepare("DELETE FROM note WHERE user_id = ?").run(userId).changes;
  console.log(changes > 0 ? `Deleted note for "${userId}".` : `No note for user "${userId}".`);
}

function seed(db: Db, keyring: Keyring): void {
  // Ensure the FK parents exist so seeding notes never hits a foreign-key error.
  for (const u of USER_FIXTURES) {
    upsertUser(db, { sub: u.id, email: u.email, name: u.name });
  }
  for (const n of NOTE_FIXTURES) {
    upsertNote(db, n.userId, n.text, keyring);
  }
  console.log(`Seeded ${NOTE_FIXTURES.length} notes.`);
  listNotes(db, keyring);
}

function main(): void {
  const [action, value] = process.argv.slice(2);
  // Open the db and load the keyring lazily so `-h`/`--help` works without either present.
  const db = (): Db => openCliDb();
  const keyring = (): Keyring => loadEncryption();
  switch (action) {
    case "-list":
      return listNotes(db(), keyring());
    case "-get-id":
      return getById(db(), keyring(), value ?? "");
    case "-set-note":
      return setNote(db(), keyring(), value);
    case "-delete-id":
      return deleteById(db(), value ?? "");
    case "-seed":
      return seed(db(), keyring());
    default:
      usage(
        "notes_db_client.ts",
        [
          "-list                    list all notes (decrypted)",
          "-get-id <userId>         show one user's note",
          "-set-note <userId,text>  create/replace a user's note",
          "-delete-id <userId>      delete a user's note",
          "-seed                    insert the fixture notes",
        ],
        isHelp(action) ? 0 : 1,
      );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
