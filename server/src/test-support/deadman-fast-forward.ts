import type { RequestHandler } from "express";
import type { Db } from "../db/index";
import { runDeadmanTick, type Deps } from "../deadman/engine";

/**
 * Handler for POST /api/test/deadman — mounted ONLY when DEADMAN_TEST_MODE=1 (never in
 * production), mirroring the AUTH_TEST_MODE / POST /api/test/login gate (FR-020). It
 * shifts the authenticated user's `next_checkin_due_at` and `grace_deadline_at` far into
 * the past, then runs one engine tick, so an end-to-end run can force the miss-deadline →
 * grace → triggered path deterministically without waiting real time and without relying
 * on the in-process timer (which tests keep disabled via DEADMAN_TICK_DISABLED=1). Scoped
 * to `req.user.id`, so a user can only fast-forward their own switch. The engine tick is
 * still what decides the transition.
 */
export function createDeadmanFastForwardHandler(db: Db, deps: Deps): RequestHandler {
  return async (req, res) => {
    const userId = req.user!.id;
    const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `UPDATE deadman_config SET
         next_checkin_due_at = CASE WHEN next_checkin_due_at IS NOT NULL THEN @past ELSE next_checkin_due_at END,
         grace_deadline_at = CASE WHEN grace_deadline_at IS NOT NULL THEN @past ELSE grace_deadline_at END,
         updated_at = @now
       WHERE user_id = @userId`,
    ).run({ userId, past, now: new Date().toISOString() });
    await runDeadmanTick(db, deps, deps.now());
    res.status(204).end();
  };
}
