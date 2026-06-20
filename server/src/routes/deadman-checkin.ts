import { Router } from "express";
import type { Db } from "../db/index";
import { findByTokenHash, markUsed } from "../db/checkin-token-repo";
import { getConfig, recordCheckin, type DeadmanConfig } from "../deadman/config-repo";
import { recordEvent } from "../deadman/event-repo";
import { hashToken } from "../deadman/tokens";
import { parseCheckinToken } from "../validation/checkin";

/** Collaborators the public check-in router needs: a clock (injected for deterministic tests). */
export interface CheckinRouterDeps {
  now?: () => Date;
}

/**
 * PUBLIC passwordless check-in router (feature 011), mounted at /api/deadman/checkin BEFORE the
 * requireAuth-gated /api/deadman mount. Authority is the unguessable check-in token only — no
 * session, no caller-supplied id (FR-003); the owning user is derived from the token row.
 *
 *   GET /?token=…
 *     - parse the token (missing/malformed → generic { status: "not_available" })
 *     - hash it and look the check-in token up by hash (unknown → not_available)
 *     - already used (`used_at != null`) OR expired (inclusive `now >= expires_at`) → not_available
 *     - switch not `active`/`grace` (triggered/disarmed) → not_available, but STILL consume the
 *       token (markUsed) so it cannot be replayed once the switch is checkable again (FR-007)
 *     - otherwise: recordCheckin (reset clock, state → active, clear grace bookkeeping) + record a
 *       `checkin` event + markUsed → { status: "checked_in" } (FR-004, FR-005)
 *
 * Every failure path collapses to the SAME generic not-available result, disclosing nothing about
 * whether any token/switch/user exists (fail-closed, FR-006), never resetting the clock or
 * recording a `checkin` event. The raw token and its hash are never logged or echoed (FR-014).
 */
export function createCheckinRouter(db: Db, deps: CheckinRouterDeps = {}): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.get("/", (req, res) => {
    res.status(200).json({ status: checkIn(db, req.query.token, now()) });
  });

  return router;
}

/**
 * Pure check-in logic shared by the route (and directly testable). Returns the
 * {@link components.schemas.CheckinLinkResult} status. All failure modes — missing/malformed token,
 * unknown hash, used, expired, or a non-checkable switch — collapse to a single generic
 * `not_available` (FR-006). A non-checkable switch still consumes the token (FR-007).
 */
function checkIn(db: Db, rawToken: unknown, now: Date): "checked_in" | "not_available" {
  const parsed = parseCheckinToken(rawToken);
  if (!parsed.ok) {
    return "not_available";
  }

  const lookup = findByTokenHash(db, hashToken(parsed.token));
  if (!lookup) {
    return "not_available";
  }

  // Single-use + time-limited: a used or expired token is dead (inclusive expiry boundary).
  const expired = now.getTime() >= Date.parse(lookup.expiresAt);
  if (lookup.usedAt != null || expired) {
    return "not_available";
  }

  const config = getConfig(db, lookup.userId);
  const nowIso = now.toISOString();

  // The check-in succeeds only when the switch is `active` or `grace` (the states the dashboard
  // check-in allows). A `triggered`/`disarmed` switch does NOT reset the clock — but the token is
  // still consumed so it cannot be replayed once the switch is checkable again (FR-007).
  if (!config || (config.state !== "active" && config.state !== "grace")) {
    markUsed(db, lookup.id, nowIso);
    return "not_available";
  }

  // Consume the token FIRST (single-use, atomic): if a concurrent/replayed open already consumed
  // it, this returns false and we resolve as not-available without a second clock reset (FR-005).
  if (!markUsed(db, lookup.id, nowIso)) {
    return "not_available";
  }

  const updated = recordCheckin(db, lookup.userId, nowIso) as DeadmanConfig;
  recordEvent(db, lookup.userId, "checkin", { nextCheckinDueAt: updated.nextCheckinDueAt }, nowIso);
  return "checked_in";
}
