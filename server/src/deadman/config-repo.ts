import type { components } from "@ensure/shared/api";
import type { Db } from "../db/index";

export type DeadmanState = components["schemas"]["DeadmanState"];
export type DeadmanStatus = components["schemas"]["DeadmanStatus"];

/**
 * The internal, fully-typed view of a `deadman_config` row. Timestamps are absolute
 * ISO-8601 strings (FR-014) so restarts never lose time. `null` deadlines mean "no live
 * deadline" (disarmed/triggered). This is the engine's and the route's working shape;
 * {@link toStatus} derives the public `DeadmanStatus` (with `secondsUntilDue`).
 */
export interface DeadmanConfig {
  userId: string;
  enabled: boolean;
  state: DeadmanState;
  checkinIntervalSeconds: number;
  gracePeriodSeconds: number;
  lastCheckinAt: string | null;
  nextCheckinDueAt: string | null;
  graceDeadlineAt: string | null;
  remindersSent: number;
  createdAt: string;
  updatedAt: string;
}

interface ConfigRow {
  user_id: string;
  enabled: number;
  state: string;
  checkin_interval_seconds: number;
  grace_period_seconds: number;
  last_checkin_at: string | null;
  next_checkin_due_at: string | null;
  grace_deadline_at: string | null;
  reminders_sent: number;
  created_at: string;
  updated_at: string;
}

/** Map a stored row to the typed {@link DeadmanConfig}. */
function toConfig(row: ConfigRow): DeadmanConfig {
  return {
    userId: row.user_id,
    enabled: row.enabled === 1,
    state: row.state as DeadmanState,
    checkinIntervalSeconds: row.checkin_interval_seconds,
    gracePeriodSeconds: row.grace_period_seconds,
    lastCheckinAt: row.last_checkin_at,
    nextCheckinDueAt: row.next_checkin_due_at,
    graceDeadlineAt: row.grace_deadline_at,
    remindersSent: row.reminders_sent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Add `seconds` to an absolute ISO timestamp, returning an ISO string. */
function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

/** Read the caller's switch config, or null when they have never configured it. */
export function getConfig(db: Db, userId: string): DeadmanConfig | null {
  const row = db
    .prepare("SELECT * FROM deadman_config WHERE user_id = ?")
    .get(userId) as ConfigRow | undefined;
  return row ? toConfig(row) : null;
}

/**
 * Apply a configuration to the caller's switch and arm/disarm it. Arming (`enabled:true`)
 * transitions to `active` and sets `next_checkin_due_at` = now + interval, clearing any
 * grace bookkeeping; disarming (`enabled:false`) transitions to `disarmed` and clears the
 * live deadlines. Inserts the row on first configuration. Returns the resulting config.
 */
export function upsertConfig(
  db: Db,
  userId: string,
  input: { checkinIntervalSeconds: number; gracePeriodSeconds: number; enabled: boolean },
  now: string,
): DeadmanConfig {
  const existing = getConfig(db, userId);
  const createdAt = existing?.createdAt ?? now;

  let state: DeadmanState;
  let nextCheckinDueAt: string | null;
  let graceDeadlineAt: string | null;
  let lastCheckinAt: string | null;
  let remindersSent: number;

  if (input.enabled) {
    // Arm (or re-arm / re-configure while armed): a fresh active deadline from now.
    state = "active";
    lastCheckinAt = now;
    nextCheckinDueAt = addSeconds(now, input.checkinIntervalSeconds);
    graceDeadlineAt = null;
    remindersSent = 0;
  } else {
    // Disarm: clear the live deadlines and grace bookkeeping.
    state = "disarmed";
    lastCheckinAt = existing?.lastCheckinAt ?? null;
    nextCheckinDueAt = null;
    graceDeadlineAt = null;
    remindersSent = 0;
  }

  db.prepare(
    `INSERT INTO deadman_config (
       user_id, enabled, state, checkin_interval_seconds, grace_period_seconds,
       last_checkin_at, next_checkin_due_at, grace_deadline_at, reminders_sent,
       created_at, updated_at
     ) VALUES (
       @userId, @enabled, @state, @interval, @grace,
       @lastCheckinAt, @nextCheckinDueAt, @graceDeadlineAt, @remindersSent,
       @createdAt, @updatedAt
     )
     ON CONFLICT(user_id) DO UPDATE SET
       enabled = excluded.enabled,
       state = excluded.state,
       checkin_interval_seconds = excluded.checkin_interval_seconds,
       grace_period_seconds = excluded.grace_period_seconds,
       last_checkin_at = excluded.last_checkin_at,
       next_checkin_due_at = excluded.next_checkin_due_at,
       grace_deadline_at = excluded.grace_deadline_at,
       reminders_sent = excluded.reminders_sent,
       updated_at = excluded.updated_at`,
  ).run({
    userId,
    enabled: input.enabled ? 1 : 0,
    state,
    interval: input.checkinIntervalSeconds,
    grace: input.gracePeriodSeconds,
    lastCheckinAt,
    nextCheckinDueAt,
    graceDeadlineAt,
    remindersSent,
    createdAt,
    updatedAt: now,
  });

  return getConfig(db, userId) as DeadmanConfig;
}

/**
 * Record a check-in ("I'm alive") for the caller: set `last_checkin_at` = now, reset
 * `next_checkin_due_at` = now + interval, return the switch to `active`, and clear grace
 * bookkeeping. The caller (route) is expected to have verified the switch is `active` or
 * `grace`. Returns the updated config, or null when there is no row.
 */
export function recordCheckin(db: Db, userId: string, now: string): DeadmanConfig | null {
  const existing = getConfig(db, userId);
  if (!existing) return null;
  db.prepare(
    `UPDATE deadman_config SET
       state = 'active',
       enabled = 1,
       last_checkin_at = @now,
       next_checkin_due_at = @nextDue,
       grace_deadline_at = NULL,
       reminders_sent = 0,
       updated_at = @now
     WHERE user_id = @userId`,
  ).run({ userId, now, nextDue: addSeconds(now, existing.checkinIntervalSeconds) });
  return getConfig(db, userId);
}

/**
 * Persist an engine-driven state transition and the fields that go with it (the grace
 * deadline, the reminder counter). `null` fields are written as `NULL` (e.g. clearing
 * `grace_deadline_at`). Used only by the engine tick — never sets a check-in.
 */
export function setState(
  db: Db,
  userId: string,
  state: DeadmanState,
  fields: { graceDeadlineAt?: string | null; remindersSent?: number },
  now: string,
): void {
  const existing = getConfig(db, userId);
  if (!existing) return;
  const graceDeadlineAt =
    fields.graceDeadlineAt === undefined ? existing.graceDeadlineAt : fields.graceDeadlineAt;
  const remindersSent =
    fields.remindersSent === undefined ? existing.remindersSent : fields.remindersSent;
  db.prepare(
    `UPDATE deadman_config SET
       state = @state,
       grace_deadline_at = @graceDeadlineAt,
       reminders_sent = @remindersSent,
       updated_at = @now
     WHERE user_id = @userId`,
  ).run({ userId, state, graceDeadlineAt, remindersSent, now });
}

/**
 * Select the switches the engine must evaluate at `now` (FR-009): every `active` switch
 * whose `next_checkin_due_at` is at or before now (a missed deadline), plus every `grace`
 * switch (which may need another reminder or to trigger). `disarmed`/`triggered` rows are
 * never selected. Uses the `(state, next_checkin_due_at)` index.
 */
export function listDue(db: Db, now: string): DeadmanConfig[] {
  const rows = db
    .prepare(
      `SELECT * FROM deadman_config
       WHERE (state = 'active' AND next_checkin_due_at IS NOT NULL AND next_checkin_due_at <= @now)
          OR state = 'grace'
       ORDER BY next_checkin_due_at ASC`,
    )
    .all({ now }) as ConfigRow[];
  return rows.map(toConfig);
}

/**
 * Delete all dead-man state — config rows, the audit log, and feature 010's releases + grants
 * (test-only helper for resetting state between e2e runs). Grants are deleted before their
 * parent releases to respect the foreign key.
 */
export function clearDeadman(db: Db): void {
  db.prepare("DELETE FROM release_grant").run();
  db.prepare("DELETE FROM release").run();
  // Feature 011 — wipe minted check-in tokens so e2e runs start clean (FR-013).
  db.prepare("DELETE FROM checkin_token").run();
  db.prepare("DELETE FROM deadman_event").run();
  db.prepare("DELETE FROM deadman_config").run();
}

/**
 * Derive the public {@link DeadmanStatus} from a config (and `now`), computing
 * `secondsUntilDue` from whichever deadline is live (the next-check-in while `active`, the
 * grace deadline while in `grace`). `events` is supplied by the caller (the route).
 */
export function toStatus(
  config: DeadmanConfig,
  now: string,
  events: DeadmanStatus["events"],
): DeadmanStatus {
  let secondsUntilDue: number | null = null;
  const deadline =
    config.state === "grace" ? config.graceDeadlineAt : config.nextCheckinDueAt;
  if (deadline) {
    secondsUntilDue = Math.round((new Date(deadline).getTime() - new Date(now).getTime()) / 1000);
  }
  return {
    state: config.state,
    enabled: config.enabled,
    checkinIntervalSeconds: config.checkinIntervalSeconds,
    gracePeriodSeconds: config.gracePeriodSeconds,
    lastCheckinAt: config.lastCheckinAt,
    nextCheckinDueAt: config.nextCheckinDueAt,
    graceDeadlineAt: config.graceDeadlineAt,
    secondsUntilDue,
    events,
  };
}
