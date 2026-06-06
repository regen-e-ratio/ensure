import { fileURLToPath } from "node:url";
import { loadEncryption } from "../config/env";
import { openDb } from "../db/index";
import { reencryptAll } from "../db/note-repo";
import type { Keyring } from "../crypto/keyring";
import type { Db } from "../db/index";

/**
 * Operator bulk re-encryption (contracts/reencrypt-cli.md). Migrates every note still
 * sealed under a non-active key version to the active version so an old key can be
 * retired (FR-013, FR-014). Reads the same env as the server and fails closed on an
 * invalid keyring or an undecryptable row (loud, never a silent skip — FR-015).
 */

/** Format the operator-facing summary line (also used by tests). */
export function formatSummary(result: {
  migrated: number;
  perVersion: Record<number, number>;
}): string {
  return `migrated=${result.migrated} remaining_by_version=${JSON.stringify(result.perVersion)}`;
}

/** Run the migration against an open db + keyring and return the summary line. */
export function runReencrypt(db: Db, keyring: Keyring): string {
  return formatSummary(reencryptAll(db, keyring));
}

function main(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — rely on the ambient environment (same as the server).
  }
  const dbPath = process.env.NOTE_DB_PATH ?? "./data/note.db";
  const keyring = loadEncryption();
  const db = openDb(dbPath);
  console.log(runReencrypt(db, keyring)); // operator-facing CLI output, not server logging.
}

// Run only when invoked directly (npm run reencrypt), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
    process.exit(0);
  } catch (err) {
    // Surface the failure loudly (never the keyring) so the operator sees a non-zero exit.
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
