import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app";
import { loadEnv, loadEncryption } from "./config/env";
import { openDb } from "./db/index";
import { sweepExpired } from "./db/session-repo";

// Load server/.env (cwd is the server workspace) for local dev. In production the
// variables come from the real environment, so a missing .env file is not an error.
try {
  process.loadEnvFile();
} catch {
  // No .env file present — rely on the ambient environment.
}

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.NOTE_DB_PATH ?? "./data/note.db";

if (DB_PATH !== ":memory:") {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

// Validate configuration up front — the process refuses to boot if a required
// Google/JWT variable is missing or malformed, or if the encryption keyring is
// missing/invalid (fail closed, FR-015). Secrets are never logged.
const auth = loadEnv();
const encryption = loadEncryption();

const db = openDb(DB_PATH);
// Tidy any sessions that lapsed while the server was down (no cron needed).
sweepExpired(db);

const app = createApp(db, {
  auth,
  encryption,
  enableTestReset: process.env.NOTE_ALLOW_TEST_RESET === "1",
});

app.listen(PORT, () => {
  console.log(`Ensure API listening on http://localhost:${PORT}`);
});
