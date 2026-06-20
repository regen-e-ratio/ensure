import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app";
import { loadEnv, loadEncryption, loadDeadmanConfig } from "./config/env";
import { createEmailProvider } from "./notifications/channels/email/providers";
import { openDb } from "./db/index";
import { sweepExpired } from "./db/session-repo";
import { buildDeadmanDeps } from "./deadman/deps";
import { startDeadmanTimer } from "./deadman/driver";

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
// Select the email provider (EMAIL_PROVIDER, default "stub" — no network send in v1).
// Read here, like PORT/NOTE_DB_PATH, rather than in the auth env schema. An unknown
// value throws, so a misconfiguration cannot silently fall back to not sending.
// EMAIL_STUB_DEBUG=1 turns on the stub's opt-in, local-debug-only content log (spec 007);
// off by default, and it only affects the stub.
const emailProvider = createEmailProvider(process.env.EMAIL_PROVIDER ?? "stub", {
  debug: process.env.EMAIL_STUB_DEBUG === "1",
});

const db = openDb(DB_PATH);
// Tidy any sessions that lapsed while the server was down (no cron needed).
sweepExpired(db);

// Dead-man liveness engine config (feature 008). The in-process timer is disabled under
// DEADMAN_TICK_DISABLED=1 (tests, or when an external cron drives `npm run deadman:tick`).
const deadman = loadDeadmanConfig();

const app = createApp(db, {
  auth,
  encryption,
  emailProvider,
  appBaseUrl: deadman.appBaseUrl,
  enableTestReset: process.env.NOTE_ALLOW_TEST_RESET === "1",
  enableDeadmanTestMode: deadman.testMode,
});

// Build the engine deps (notifier over the generic dispatcher + a Date clock) and start the
// in-process liveness timer. The driver runs a one-shot boot-recovery tick first, so a switch
// whose deadline lapsed while the server was down is evaluated on startup (FR-014). No-op when
// DEADMAN_TICK_DISABLED=1.
const deadmanDeps = buildDeadmanDeps(db, emailProvider, deadman.appBaseUrl);
startDeadmanTimer(db, deadmanDeps, { tickMs: deadman.tickMs, disabled: deadman.tickDisabled });

app.listen(PORT, () => {
  console.log(`Ensure API listening on http://localhost:${PORT}`);
});
