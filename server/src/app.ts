import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import type { Db } from "./db/index";
import type { AuthConfig } from "./config/env";
import type { Keyring } from "./crypto/keyring";
import type { EmailProvider } from "./notifications/channels/email/provider";
import { StubEmailProvider } from "./notifications/channels/email/stub-provider";
import { clearNote } from "./db/note-repo";
import { clearContacts } from "./db/contact-repo";
import { createNoteRouter } from "./routes/note";
import { createContactRouter } from "./routes/contact";
import { createNotificationsRouter } from "./routes/notifications";
import { createDeadmanRouter } from "./routes/deadman";
import { clearDeadman } from "./deadman/config-repo";
import { buildDeadmanDeps } from "./deadman/deps";
import { createDeadmanFastForwardHandler } from "./test-support/deadman-fast-forward";
import { createAuthRouter } from "./auth/routes";
import { createRequireAuth } from "./auth/require-auth";
import { createTestLoginHandler } from "./test-support/test-login";

export interface AppOptions {
  /** Auth configuration (Google + JWT + test-mode flag). Required — the app is gated behind SSO. */
  auth: AuthConfig;
  /** Versioned encryption keyring used to seal/open note content at rest. Required. */
  encryption: Keyring;
  /** Email provider for the notification system. Defaults to the in-process stub (no network send). */
  emailProvider?: EmailProvider;
  /** Enables a non-contract POST /api/test/reset route for clearing state in e2e runs. Never on in production. */
  enableTestReset?: boolean;
  /** When true (DEADMAN_TEST_MODE=1), mounts the POST /api/test/deadman fast-forward seam. Never in production. */
  enableDeadmanTestMode?: boolean;
}

/**
 * Build the Express app around an injected database and auth config. No network
 * listening happens here, so tests can exercise the app in-process (Supertest).
 *
 * Cookies are parsed for every request; /api/auth hosts sign-in/session endpoints;
 * /api/note is gated behind `requireAuth`. The test-login seam (and the existing
 * test-reset route) are mounted only when their env gate is set — never in production.
 */
export function createApp(db: Db, options: AppOptions): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const { auth } = options;
  // Plain-HTTP test/e2e flows can't carry Secure cookies; production always does.
  const secure = !auth.testMode;

  app.use("/api/auth", createAuthRouter(db, auth, secure));

  const requireAuth = createRequireAuth(auth.jwtSecret);
  app.use("/api/note", requireAuth, createNoteRouter(db, options.encryption));
  app.use("/api/contact", requireAuth, createContactRouter(db));
  app.use(
    "/api/notifications",
    requireAuth,
    createNotificationsRouter(options.emailProvider ?? new StubEmailProvider()),
  );
  app.use("/api/deadman", requireAuth, createDeadmanRouter(db, { now: () => new Date() }));

  if (options.enableTestReset) {
    app.post("/api/test/reset", (_req, res) => {
      clearNote(db);
      clearContacts(db);
      clearDeadman(db);
      res.status(204).end();
    });
  }

  // Test-only seam: mints real session cookies for a fake user without contacting Google.
  if (auth.testMode) {
    app.post("/api/test/login", createTestLoginHandler(db, auth, secure));
  }

  // Test-only seam: fast-forward the caller's switch deadlines into the past for e2e (FR-020),
  // then run one tick so the transition is observable without the in-process timer.
  if (options.enableDeadmanTestMode) {
    const deadmanDeps = buildDeadmanDeps(db, options.emailProvider ?? new StubEmailProvider());
    app.post("/api/test/deadman", requireAuth, createDeadmanFastForwardHandler(db, deadmanDeps));
  }

  return app;
}
