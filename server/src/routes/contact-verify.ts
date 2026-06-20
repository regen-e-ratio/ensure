import { Router } from "express";
import type { Db } from "../db/index";
import { findByVerificationHash, markVerified } from "../db/contact-repo";
import { hashVerificationToken } from "../contacts/verification-token";

/**
 * PUBLIC contact-verification router (feature 009), mounted at /api/contact/verify BEFORE the
 * requireAuth-gated /api/contact mount. Authority is the unguessable token only — no session,
 * no caller-supplied contact id (FR-008).
 *
 *   GET /verify?token=…
 *     - parse the token (missing/malformed → generic invalid result)
 *     - hash it and look the contact up by hash
 *     - succeed only when found AND now < verification_expires_at (inclusive expiry → fail)
 *     - on success markVerified (single-use; clears the hash) → { status: "verified" } or
 *       { status: "already_verified" }
 *     - otherwise → { status: "invalid_or_expired" } (fail-closed, no contact/owner disclosure)
 *
 * The raw token is never logged or echoed.
 */
export function createContactVerifyRouter(db: Db, deps: { now: () => Date } = { now: () => new Date() }): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const result = confirmVerification(db, req.query.token, deps.now());
    res.status(200).json({ status: result });
  });

  return router;
}

/**
 * Pure verification logic shared by the route (and directly testable). Returns the
 * {@link components.schemas.ContactVerifyResult} status. All failure modes — missing/malformed
 * token, unknown hash, expired, already-consumed — collapse to a single generic
 * `invalid_or_expired` so nothing about contact/owner existence leaks (FR-010, SC-002).
 */
function confirmVerification(
  db: Db,
  rawToken: unknown,
  now: Date,
): "verified" | "already_verified" | "invalid_or_expired" {
  if (typeof rawToken !== "string" || rawToken.length === 0) {
    return "invalid_or_expired";
  }

  const tokenHash = hashVerificationToken(rawToken);
  const lookup = findByVerificationHash(db, tokenHash);
  if (!lookup || lookup.expiresAt == null) {
    return "invalid_or_expired";
  }

  // Inclusive expiry boundary: now >= expiresAt fails (FR-009).
  if (now.getTime() >= Date.parse(lookup.expiresAt)) {
    return "invalid_or_expired";
  }

  return markVerified(db, lookup.id, now.toISOString());
}
