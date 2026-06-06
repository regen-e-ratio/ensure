import type { RequestHandler } from "express";
import type { Db } from "../db/index";
import type { AuthConfig } from "../config/env";
import { upsertUser } from "../db/user-repo";
import { establishSession } from "../auth/routes";

/**
 * Handler for POST /api/test/login — mounted ONLY when AUTH_TEST_MODE=1 (never in
 * production), mirroring the existing NOTE_ALLOW_TEST_RESET / POST /api/test/reset
 * gate. It provisions a deterministic fake user and mints the SAME access + refresh
 * cookies as the real Google flow, without ever contacting Google, so e2e and
 * contract tests exercise the real authorization middleware and cookie handling.
 * See research.md D6.
 */
export function createTestLoginHandler(db: Db, auth: AuthConfig, secure: boolean): RequestHandler {
  return async (req, res) => {
    const body = (req.body ?? {}) as { sub?: string; email?: string; name?: string | null };
    const user = upsertUser(db, {
      sub: body.sub ?? "e2e-user",
      email: body.email ?? "e2e@example.com",
      name: body.name ?? "E2E User",
    });
    await establishSession(db, res, user, auth, secure);
    res.status(204).end();
  };
}
