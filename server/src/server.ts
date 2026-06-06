import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { openDb } from "./db/index";
import { sweepExpired } from "./db/session-repo";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.NOTE_DB_PATH ?? "./data/note.db";

if (DB_PATH !== ":memory:") {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

// Validate configuration up front — the process refuses to boot if a required
// Google/JWT variable is missing or malformed (secrets are never logged).
const auth = loadEnv();

const db = openDb(DB_PATH);
// Tidy any sessions that lapsed while the server was down (no cron needed).
sweepExpired(db);

const app = createApp(db, {
  auth,
  enableTestReset: process.env.NOTE_ALLOW_TEST_RESET === "1",
});

app.listen(PORT, () => {
  console.log(`Ensure API listening on http://localhost:${PORT}`);
});
