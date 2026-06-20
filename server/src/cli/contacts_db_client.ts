import { fileURLToPath } from "node:url";
import { openCliDb, fields, usage, isHelp } from "./_db_client_shared";
import { listContacts, addContact, findByNormalized, normalizeValue } from "../db/contact-repo";
import { upsertUser } from "../db/user-repo";
import { USER_FIXTURES } from "./users_db_client";
import type { ContactType } from "../db/contact-repo";
import type { Db } from "../db/index";

/**
 * Developer CLI for the `contact` table. Run with `tsx` (TypeScript):
 *
 *   npx tsx server/src/cli/contacts_db_client.ts -list                # every contact
 *   npx tsx server/src/cli/contacts_db_client.ts -list dev-alice      # one user's contacts
 *   npx tsx server/src/cli/contacts_db_client.ts -get-id <contactId>
 *   npx tsx server/src/cli/contacts_db_client.ts -create-contact dev-alice,email,friend@example.com
 *   npx tsx server/src/cli/contacts_db_client.ts -delete-id <contactId>
 *   npx tsx server/src/cli/contacts_db_client.ts -seed                # ensures fixture users + contacts
 *
 * Or via npm: `npm run db:contact --workspace server -- -list dev-alice`.
 */

/**
 * Contact types the app actually supports (matches the `Contact.type` enum in
 * contracts/openapi.yaml). The CLI validates against this so it never writes a row the
 * server would later serialize as an out-of-enum value.
 */
const CONTACT_TYPES: readonly ContactType[] = ["email"];

function isContactType(value: string | undefined): value is ContactType {
  return value !== undefined && (CONTACT_TYPES as readonly string[]).includes(value);
}

/** Sample contacts for `-seed` (keyed to the user fixtures so the FK is satisfied). */
export const CONTACT_FIXTURES = [
  { userId: "dev-alice", type: "email" as ContactType, value: "alice.friend@example.com" },
  { userId: "dev-alice", type: "email" as ContactType, value: "alice.family@example.com" },
  { userId: "dev-bob", type: "email" as ContactType, value: "bob.friend@example.com" },
];

interface ContactRow {
  id: string;
  user_id: string;
  type: string;
  value: string;
  created_at: string;
}

function listAll(db: Db, userId: string | undefined): void {
  if (userId) {
    console.table(listContacts(db, userId));
    return;
  }
  console.table(
    db
      .prepare("SELECT id, user_id, type, value, created_at FROM contact ORDER BY user_id, created_at")
      .all(),
  );
}

function getById(db: Db, id: string): void {
  const row = db
    .prepare("SELECT id, user_id, type, value, created_at FROM contact WHERE id = ?")
    .get(id) as ContactRow | undefined;
  if (!row) {
    console.log(`No contact with id "${id}".`);
    return;
  }
  console.table([row]);
}

/** Create a contact from `userId,type,value` (type defaults to email if omitted). */
function createContact(db: Db, csv: string | undefined): void {
  const parts = fields(csv);
  const userId = parts[0];
  const [type, value] = parts.length >= 3 ? [parts[1], parts[2]] : ["email", parts[1]];
  if (!userId || !value) {
    throw new Error(
      "-create-contact needs userId,[type,]value (e.g. dev-alice,email,friend@example.com)",
    );
  }
  if (!isContactType(type)) {
    throw new Error(`Unknown contact type "${type}". Supported: ${CONTACT_TYPES.join(", ")}`);
  }
  const existing = findByNormalized(db, userId, type, normalizeValue(value));
  if (existing) {
    console.log("Contact already exists (case-insensitive duplicate):");
    console.table([existing]);
    return;
  }
  const contact = addContact(db, userId, type, value);
  console.log("Created contact:");
  console.table([contact]);
}

function deleteById(db: Db, id: string): void {
  const changes = db.prepare("DELETE FROM contact WHERE id = ?").run(id).changes;
  console.log(changes > 0 ? `Deleted contact "${id}".` : `No contact with id "${id}".`);
}

function seed(db: Db): void {
  // Ensure the FK parents exist so seeding contacts never hits a foreign-key error.
  for (const u of USER_FIXTURES) {
    upsertUser(db, { sub: u.id, email: u.email, name: u.name });
  }
  let added = 0;
  for (const c of CONTACT_FIXTURES) {
    if (!findByNormalized(db, c.userId, c.type, normalizeValue(c.value))) {
      addContact(db, c.userId, c.type, c.value);
      added += 1;
    }
  }
  console.log(`Seeded ${added} new contacts (skipped ${CONTACT_FIXTURES.length - added} duplicates).`);
  listAll(db, undefined);
}

function main(): void {
  const [action, value] = process.argv.slice(2);
  // Open the db lazily so `-h`/`--help` works without a database present.
  const db = (): Db => openCliDb();
  switch (action) {
    case "-list":
      return listAll(db(), value);
    case "-get-id":
      return getById(db(), value ?? "");
    case "-create-contact":
      return createContact(db(), value);
    case "-delete-id":
      return deleteById(db(), value ?? "");
    case "-seed":
      return seed(db());
    default:
      usage(
        "contacts_db_client.ts",
        [
          "-list [userId]                         list all contacts (or one user's)",
          "-get-id <contactId>                    show one contact",
          "-create-contact <userId,[type,]value>  create a contact (type defaults to email)",
          "-delete-id <contactId>                 delete a contact",
          "-seed                                  insert the fixture contacts",
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
