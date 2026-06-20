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
import { createContactVerifyRouter } from "./routes/contact-verify";
import { createNotificationsRouter } from "./routes/notifications";
import { createDeadmanRouter } from "./routes/deadman";
import { createReleaseRouter } from "./routes/release";
import { createCheckinRouter } from "./routes/deadman-checkin";
import { createRateLimit } from "./middleware/rate-limit";
import { clearDeadman } from "./deadman/config-repo";
import { buildDeadmanDeps } from "./deadman/deps";
import { createDeadmanFastForwardHandler } from "./test-support/deadman-fast-forward";
import { createAuthRouter } from "./auth/routes";
import { createRequireAuth } from "./auth/require-auth";
import { createTestLoginHandler } from "./test-support/test-login";
import { CapturingEmailProvider, createCapturedEmailsHandler } from "./test-support/capturing-email";

export interface AppOptions {
  /** Auth configuration (Google + JWT + test-mode flag). Required — the app is gated behind SSO. */
  auth: AuthConfig;
  /** Versioned encryption keyring used to seal/open note content at rest. Required. */
  encryption: Keyring;
  /** Email provider for the notification system. Defaults to the in-process stub (no network send). */
  emailProvider?: EmailProvider;
  /**
   * Absolute base URL used to build links placed in emails (feature 008's APP_BASE_URL).
   * Used by the contact-verification send handler (feature 009). Defaults to the dev SPA origin.
   */
  appBaseUrl?: string;
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

  // In test/e2e runs (behind the existing test-reset gate) wrap the provider so e2e can read
  // back the verification link the server emailed. Never wrapped in production.
  const baseEmailProvider = options.emailProvider ?? new StubEmailProvider();
  const capturingProvider = options.enableTestReset
    ? new CapturingEmailProvider(baseEmailProvider)
    : null;
  const emailProvider: EmailProvider = capturingProvider ?? baseEmailProvider;
  const appBaseUrl = options.appBaseUrl ?? "http://localhost:5173";
  // PUBLIC verify route — token-only authority — mounted BEFORE the requireAuth-gated
  // /api/contact so an unauthenticated recipient can confirm their address (feature 009).
  app.use("/api/contact/verify", createContactVerifyRouter(db));
  // PUBLIC release-view route (feature 010) — token-only authority, view-once — mounted BEFORE
  // the requireAuth-gated mounts and rate-limited so a verified contact can read the note once
  // without a session, while brute-force enumeration of grant tokens is throttled.
  const releaseRateLimit = createRateLimit({ windowMs: 60_000, max: 30 });
  app.use(
    "/api/release",
    releaseRateLimit,
    createReleaseRouter(db, { keyring: options.encryption, now: () => new Date() }),
  );
  // PUBLIC passwordless check-in route (feature 011) — token-only authority, single-use — mounted
  // BEFORE the requireAuth-gated /api/deadman mount so a user can check in from a reminder email
  // link without a session. The owning user is derived from the token row, never from a session.
  app.use("/api/deadman/checkin", createCheckinRouter(db, { now: () => new Date() }));
  app.use("/api/contact", requireAuth, createContactRouter(db, { appBaseUrl, emailProvider }));
  app.use("/api/notifications", requireAuth, createNotificationsRouter(emailProvider));
  app.use(
    "/api/deadman",
    requireAuth,
    createDeadmanRouter(db, {
      now: () => new Date(),
      release: { keyring: options.encryption, appBaseUrl, emailProvider },
    }),
  );

  if (options.enableTestReset) {
    app.post("/api/test/reset", (_req, res) => {
      clearNote(db);
      clearContacts(db);
      clearDeadman(db);
      if (capturingProvider) capturingProvider.captured.length = 0;
      res.status(204).end();
    });
    if (capturingProvider) {
      app.get("/api/test/emails", createCapturedEmailsHandler(capturingProvider));
    }
  }

  // Test-only seam: mints real session cookies for a fake user without contacting Google.
  if (auth.testMode) {
    app.post("/api/test/login", createTestLoginHandler(db, auth, secure));
  }

  // Test-only seam: fast-forward the caller's switch deadlines into the past for e2e (FR-020),
  // then run one tick so the transition is observable without the in-process timer.
  if (options.enableDeadmanTestMode) {
    const deadmanDeps = buildDeadmanDeps(db, emailProvider, appBaseUrl);
    app.post("/api/test/deadman", requireAuth, createDeadmanFastForwardHandler(db, deadmanDeps));
  }

  return app;
}
