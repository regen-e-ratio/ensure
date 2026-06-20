import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { openDb } from "../db/index";
import type { Db } from "../db/index";

/**
 * Shared plumbing for the per-table developer CLIs (`*_db_client.ts`). This is NOT a
 * generic table client — it only loads `server/.env` and opens the SQLite database the
 * way the server does. Each table has its own script with its own fixtures and helpers.
 */

// The server workspace root (this file lives in `server/src/cli/`). Everything is
// resolved against this, not the process cwd, so the CLIs hit the same `.env` and the
// same database whether run via `npm run db:* --workspace server` or `npx tsx <file>`
// from anywhere in the repo.
const SERVER_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Load `server/.env` (if present) and open the same SQLite db the server uses. */
export function openCliDb(): Db {
  try {
    process.loadEnvFile(resolve(SERVER_ROOT, ".env"));
  } catch {
    // No server/.env — rely on the ambient environment (same as the server).
  }
  // Mirror the server's default (server/data/note.db); a relative NOTE_DB_PATH is
  // resolved against the server root so it matches the server's cwd=server/ behavior.
  const dbPath = process.env.NOTE_DB_PATH ?? "data/note.db";
  return openDb(resolve(SERVER_ROOT, dbPath));
}

/**
 * Split a comma-separated CLI argument (e.g. `1,alice,Alice`) into trimmed fields.
 * Empty fields are KEPT (not dropped) so positions stay stable — `1,,Alice` yields
 * `["1", "", "Alice"]`, letting callers detect a missing value rather than silently
 * shifting later fields into earlier slots.
 */
export function fields(value: string | undefined): string[] {
  return (value ?? "").split(",").map((f) => f.trim());
}

/**
 * Print a usage block and exit. `code` defaults to 1 (an unknown action is an error);
 * pass 0 when the help was requested deliberately (`-h`/`--help`/no action).
 */
export function usage(script: string, lines: string[], code = 1): never {
  const write = code === 0 ? console.log : console.error;
  write(`Usage: npx tsx server/src/cli/${script} <action> [args]\n`);
  for (const line of lines) {
    write(`  ${line}`);
  }
  process.exit(code);
}

/** True for the conventional "show me the help" inputs (incl. no action at all). */
export function isHelp(action: string | undefined): boolean {
  return action === undefined || action === "-h" || action === "--help";
}
