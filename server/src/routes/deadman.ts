import { Router } from "express";
import type { Db } from "../db/index";
import {
  getConfig,
  upsertConfig,
  recordCheckin,
  toStatus,
  type DeadmanConfig,
} from "../deadman/config-repo";
import { recordEvent, listEvents } from "../deadman/event-repo";
import { parseDeadmanConfigInput } from "../validation/deadman";
import {
  DEADMAN_DEFAULT_INTERVAL_SECONDS,
  DEADMAN_DEFAULT_GRACE_SECONDS,
} from "@ensure/shared/constants";

/** How many recent events the status response carries. */
const EVENT_LIMIT = 20;

/**
 * Dependencies the router needs beyond the db: a clock, injected so contract tests can pin
 * `now` for deterministic countdowns. (The reminder notifier is a property of the engine
 * tick, not the synchronous routes.)
 */
export interface DeadmanRouterDeps {
  now: () => Date;
}

/**
 * The status of a never-configured switch (FR-002): disarmed, generous defaults, null
 * deadlines. Returned so the dashboard can render its empty state with pre-filled defaults.
 */
function defaultStatus(userId: string, db: Db) {
  const config: DeadmanConfig = {
    userId,
    enabled: false,
    state: "disarmed",
    checkinIntervalSeconds: DEADMAN_DEFAULT_INTERVAL_SECONDS,
    gracePeriodSeconds: DEADMAN_DEFAULT_GRACE_SECONDS,
    lastCheckinAt: null,
    nextCheckinDueAt: null,
    graceDeadlineAt: null,
    remindersSent: 0,
    createdAt: "",
    updatedAt: "",
  };
  return toStatus(config, new Date().toISOString(), listEvents(db, userId, EVENT_LIMIT));
}

/**
 * Router for the caller's own dead-man switch, mounted at /api/deadman behind `requireAuth`.
 *   - GET    /        — status incl. secondsUntilDue + recent events (US1/US3)
 *   - PUT    /config  — set interval/grace + arm/disarm (US1/US4)
 *   - POST   /checkin — "I'm alive" reset on active/grace (US1/US2)
 *
 * Every query is scoped to `req.user.id` (FR-018); no endpoint accepts a target user id.
 * No note plaintext or token ever appears in a response or event (FR-017).
 */
export function createDeadmanRouter(db: Db, deps: DeadmanRouterDeps): Router {
  const router = Router();

  // US1/US3: status (defaults for a never-configured switch, FR-002).
  router.get("/", (req, res) => {
    const userId = req.user!.id;
    const config = getConfig(db, userId);
    if (!config) {
      res.status(200).json(defaultStatus(userId, db));
      return;
    }
    const events = listEvents(db, userId, EVENT_LIMIT);
    res.status(200).json(toStatus(config, deps.now().toISOString(), events));
  });

  // US1/US4: configure + arm/disarm.
  router.put("/config", (req, res) => {
    const userId = req.user!.id;
    const parsed = parseDeadmanConfigInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: parsed.message });
      return;
    }

    const before = getConfig(db, userId);
    const nowIso = deps.now().toISOString();
    const config = upsertConfig(db, userId, parsed.value, nowIso);

    // Record the most meaningful event: armed/disarmed on a state change, else config_changed.
    if (parsed.value.enabled && before?.state !== "active") {
      recordEvent(db, userId, "armed", { nextCheckinDueAt: config.nextCheckinDueAt }, nowIso);
    } else if (!parsed.value.enabled && before?.state !== "disarmed") {
      recordEvent(db, userId, "disarmed", null, nowIso);
    } else {
      recordEvent(
        db,
        userId,
        "config_changed",
        {
          checkinIntervalSeconds: config.checkinIntervalSeconds,
          gracePeriodSeconds: config.gracePeriodSeconds,
        },
        nowIso,
      );
    }

    res.status(200).json(toStatus(config, nowIso, listEvents(db, userId, EVENT_LIMIT)));
  });

  // US1/US2: check in ("I'm alive"). Only valid on an active/grace switch.
  router.post("/checkin", (req, res) => {
    const userId = req.user!.id;
    const config = getConfig(db, userId);

    if (!config || config.state === "disarmed") {
      res.status(409).json({ error: "NOT_ARMED", message: "The switch is not armed." });
      return;
    }
    if (config.state === "triggered") {
      res
        .status(409)
        .json({ error: "ALREADY_TRIGGERED", message: "The switch has already fired." });
      return;
    }

    const nowIso = deps.now().toISOString();
    const updated = recordCheckin(db, userId, nowIso) as DeadmanConfig;
    recordEvent(db, userId, "checkin", { nextCheckinDueAt: updated.nextCheckinDueAt }, nowIso);
    res.status(200).json(toStatus(updated, nowIso, listEvents(db, userId, EVENT_LIMIT)));
  });

  return router;
}
