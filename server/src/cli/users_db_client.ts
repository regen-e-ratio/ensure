import { fileURLToPath } from "node:url";
import { openCliDb, fields, usage, isHelp } from "./_db_client_shared";
import { upsertUser, getUser } from "../db/user-repo";
import type { Db } from "../db/index";

/**
 * Developer CLI for the `user` table. Run with `tsx` (TypeScript):
 *
 *   npx tsx server/src/cli/users_db_client.ts -list
 *   npx tsx server/src/cli/users_db_client.ts -get-id dev-alice
 *   npx tsx server/src/cli/users_db_client.ts -create-user dev-alice,alice@example.com,Alice
 *   npx tsx server/src/cli/users_db_client.ts -delete-id dev-alice
 *   npx tsx server/src/cli/users_db_client.ts -seed          # insert the fixtures below
 *
 * Or via npm: `npm run db:user --workspace server -- -get-id dev-alice`.
 */

/** Sample users for `-seed`. Reused as the FK parents by the contact/note clients. */
export const USER_FIXTURES = [
  { id: "dev-alice", email: "alice@example.com", name: "Alice Dev" },
  { id: "dev-bob", email: "bob@example.com", name: "Bob Dev" },
];

function listUsers(db: Db): void {
  console.table(
    db.prepare("SELECT id, email, name, created_at, last_login_at FROM user ORDER BY created_at").all(),
  );
}

function getById(db: Db, id: string): void {
  const user = getUser(db, id);
  if (!user) {
    console.log(`No user with id "${id}".`);
    return;
  }
  console.table([user]);
}

/** Create or update a user from `id,email,name` (name optional). */
function createUser(db: Db, csv: string | undefined): void {
  const [id, email, name] = fields(csv);
  if (!id || !email) {
    throw new Error("-create-user needs at least id,email (e.g. dev-alice,alice@example.com,Alice)");
  }
  const user = upsertUser(db, { sub: id, email, name: name || null });
  console.log("Upserted user:");
  console.table([user]);
}

/** Delete a user and everything that references it (sessions, contacts, note). */
function deleteUser(db: Db, id: string): void {
  const removed = db.transaction((userId: string) => {
    db.prepare("DELETE FROM session WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM contact WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM note WHERE user_id = ?").run(userId);
    return db.prepare("DELETE FROM user WHERE id = ?").run(userId).changes;
  })(id);
  console.log(removed > 0 ? `Deleted user "${id}" (and its rows).` : `No user with id "${id}".`);
}

function seed(db: Db): void {
  for (const u of USER_FIXTURES) {
    upsertUser(db, { sub: u.id, email: u.email, name: u.name });
  }
  console.log(`Seeded ${USER_FIXTURES.length} users.`);
  listUsers(db);
}

function main(): void {
  const [action, value] = process.argv.slice(2);
  // Open the db lazily so `-h`/`--help` works without a database present.
  const db = (): Db => openCliDb();
  switch (action) {
    case "-list":
      return listUsers(db());
    case "-get-id":
      return getById(db(), value ?? "");
    case "-create-user":
      return createUser(db(), value);
    case "-delete-id":
      return deleteUser(db(), value ?? "");
    case "-seed":
      return seed(db());
    default:
      usage(
        "users_db_client.ts",
        [
          "-list                         list all users",
          "-get-id <id>                  show one user",
          "-create-user <id,email,name>  create/update a user",
          "-delete-id <id>               delete a user and its rows",
          "-seed                         insert the fixture users",
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
