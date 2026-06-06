import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import type { Db } from "./db/index";
import type { AuthConfig } from "./config/env";
import { clearNote } from "./db/note-repo";
import { createNoteRouter } from "./routes/note";
import { createAuthRouter } from "./auth/routes";
import { createRequireAuth } from "./auth/require-auth";
import { createTestLoginHandler } from "./test-support/test-login";

export interface AppOptions {
  /** Auth configuration (Google + JWT + test-mode flag). Required — the app is gated behind SSO. */
  auth: AuthConfig;
  /** Enables a non-contract POST /api/test/reset route for clearing state in e2e runs. Never on in production. */
  enableTestReset?: boolean;
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
  app.use("/api/note", requireAuth, createNoteRouter(db));

  if (options.enableTestReset) {
    app.post("/api/test/reset", (_req, res) => {
      clearNote(db);
      res.status(204).end();
    });
  }

  // Test-only seam: mints real session cookies for a fake user without contacting Google.
  if (auth.testMode) {
    app.post("/api/test/login", createTestLoginHandler(db, auth, secure));
  }

  return app;
}
