import { fileURLToPath } from "node:url";
import { openCliDb, usage, isHelp } from "./_db_client_shared";
import { deleteById as deleteSession, sweepExpired } from "../db/session-repo";
import type { Db } from "../db/index";

/**
 * Developer CLI for the `session` table. Sessions back refresh tokens and are minted by
 * the auth flow (only a token *hash* is stored), so there is no fixture/create action —
 * this client only inspects and prunes them. Run with `tsx` (TypeScript):
 *
 *   npx tsx server/src/cli/sessions_db_client.ts -list              # all sessions
 *   npx tsx server/src/cli/sessions_db_client.ts -list dev-alice    # one user's sessions
 *   npx tsx server/src/cli/sessions_db_client.ts -get-id <sessionId>
 *   npx tsx server/src/cli/sessions_db_client.ts -delete-id <sessionId>
 *   npx tsx server/src/cli/sessions_db_client.ts -sweep             # delete expired sessions
 *
 * Or via npm: `npm run db:session --workspace server -- -list`.
 */

const COLUMNS = "id, user_id, expires_at, created_at, last_used_at";

function listAll(db: Db, userId: string | undefined): void {
  const rows = userId
    ? db.prepare(`SELECT ${COLUMNS} FROM session WHERE user_id = ? ORDER BY last_used_at`).all(userId)
    : db.prepare(`SELECT ${COLUMNS} FROM session ORDER BY last_used_at`).all();
  console.table(rows);
}

function getById(db: Db, id: string): void {
  const row = db.prepare(`SELECT ${COLUMNS} FROM session WHERE id = ?`).get(id);
  if (!row) {
    console.log(`No session with id "${id}".`);
    return;
  }
  console.table([row]);
}

function remove(db: Db, id: string): void {
  const before = (db.prepare("SELECT COUNT(*) AS n FROM session WHERE id = ?").get(id) as { n: number }).n;
  deleteSession(db, id);
  console.log(before > 0 ? `Deleted session "${id}".` : `No session with id "${id}".`);
}

function sweep(db: Db): void {
  const removed = sweepExpired(db);
  console.log(`Swept ${removed} expired session(s).`);
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
    case "-delete-id":
      return remove(db(), value ?? "");
    case "-sweep":
      return sweep(db());
    default:
      usage(
        "sessions_db_client.ts",
        [
          "-list [userId]          list all sessions (or one user's)",
          "-get-id <sessionId>     show one session",
          "-delete-id <sessionId>  delete a session",
          "-sweep                  delete all expired sessions",
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
