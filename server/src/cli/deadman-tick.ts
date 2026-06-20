import { fileURLToPath } from "node:url";
import { loadDeadmanConfig } from "../config/env";
import { createEmailProvider } from "../notifications/channels/email/providers";
import { openDb } from "../db/index";
import { buildDeadmanDeps } from "../deadman/deps";
import { runDeadmanTick } from "../deadman/engine";

/**
 * One-shot liveness tick for an external scheduler (cron / k8s CronJob), exposed as
 * `npm run deadman:tick`. Opens the same DB and builds the same engine `deps` as the boot
 * path, runs exactly one `runDeadmanTick`, then exits. Idempotent and state-guarded
 * (FR-013), so it is safe to run alongside the in-process timer.
 */
async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file — rely on the ambient environment (same as the server).
  }
  const dbPath = process.env.NOTE_DB_PATH ?? "./data/note.db";
  // Read the email provider the same way server.ts does.
  const emailProvider = createEmailProvider(process.env.EMAIL_PROVIDER ?? "stub", {
    debug: process.env.EMAIL_STUB_DEBUG === "1",
  });
  // loadDeadmanConfig is read for parity/validation; the CLI always runs one tick regardless
  // of the in-process timer flag. The appBaseUrl is used to build release links (feature 010).
  const deadman = loadDeadmanConfig();

  const db = openDb(dbPath);
  const deps = buildDeadmanDeps(db, emailProvider, deadman.appBaseUrl);
  await runDeadmanTick(db, deps, deps.now());
}

// Run only when invoked directly (npm run deadman:tick), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
