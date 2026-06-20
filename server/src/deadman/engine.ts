import { DEADMAN_MAX_GRACE_REMINDERS } from "@ensure/shared/constants";
import type { Db } from "../db/index";
import {
  getConfig,
  listDue,
  setState,
  type DeadmanConfig,
} from "./config-repo";
import { recordEvent } from "./event-repo";

/**
 * The pure decision `evaluate` returns for a switch at a given moment (FR-008). No I/O is
 * performed; `runDeadmanTick` is what applies these through injected `deps`.
 *   - `stay`        — armed but nothing to do yet (deadline still in the future, or grace
 *                     reminder cap already reached).
 *   - `enter_grace` — an `active` deadline was missed → move to grace + send first reminder.
 *   - `remind`      — in grace, before the grace deadline, under the reminder cap → send
 *                     another reminder.
 *   - `trigger`     — the grace deadline lapsed → fire the switch.
 *   - `noop`        — not a state the engine acts on (disarmed/triggered).
 */
export type DeadmanDecision =
  | { kind: "stay" }
  | { kind: "enter_grace" }
  | { kind: "remind" }
  | { kind: "trigger" }
  | { kind: "noop" };

/** A reminder the tick asks the injected notifier to deliver to the user's own email. */
export interface ReminderMessage {
  recipient: string;
  subject: string;
  body: string;
}

/**
 * The side-effecting capabilities the engine needs, injected so `runDeadmanTick` stays
 * unit-testable with a spy notifier and a deterministic clock (FR-009). `notify` sends one
 * reminder via the generic dispatcher (never a provider directly); `now` is the clock.
 * `userEmailFor` resolves the recipient address (the user's own account email in 008).
 */
export interface Deps {
  notify: (message: ReminderMessage) => Promise<void>;
  now: () => Date;
  userEmailFor: (userId: string) => string | null;
}

/** Whether `now` is at or after the absolute ISO deadline (inclusive boundary). */
function atOrAfter(now: Date, deadlineIso: string | null): boolean {
  if (!deadlineIso) return false;
  return now.getTime() >= new Date(deadlineIso).getTime();
}

/**
 * Pure state-machine decision for one switch at `now` (FR-008). Performs no I/O and never
 * mutates `config`. The boundary is inclusive (`now >= deadline`) for both the check-in
 * and the grace deadline (spec Edge Cases).
 */
export function evaluate(config: DeadmanConfig, now: Date): DeadmanDecision {
  switch (config.state) {
    case "disarmed":
    case "triggered":
      return { kind: "noop" };
    case "active":
      return atOrAfter(now, config.nextCheckinDueAt)
        ? { kind: "enter_grace" }
        : { kind: "stay" };
    case "grace":
      if (atOrAfter(now, config.graceDeadlineAt)) {
        return { kind: "trigger" };
      }
      // Still inside the grace window: send another reminder until the cap is hit.
      return config.remindersSent < DEADMAN_MAX_GRACE_REMINDERS
        ? { kind: "remind" }
        : { kind: "stay" };
    default:
      return { kind: "noop" };
  }
}

/** Build the reminder message for a user's grace window (no secrets, FR-017). */
function buildReminder(recipient: string): ReminderMessage {
  return {
    recipient,
    subject: "Action needed: check in to your Ensure switch",
    body:
      "Your Ensure dead-man switch missed its check-in deadline and is now in its grace " +
      "period. Sign in and check in (\"I'm alive\") to reset it. If you do not check in " +
      "before the grace period ends, your switch will fire.",
  };
}

/** Add `seconds` to an absolute ISO timestamp, returning an ISO string. */
function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

/**
 * One engine tick (FR-009): load due switches, evaluate each, and apply the decision
 * through the injected `deps`. Idempotent and state-guarded (FR-013) — re-running never
 * double-sends a reminder beyond the cap nor re-triggers. A per-user send failure is
 * caught and recorded without aborting the batch (FR-022). All deadlines are absolute
 * ISO-8601 (FR-014), so a tick after a restart behaves identically.
 */
export async function runDeadmanTick(db: Db, deps: Deps, now: Date): Promise<void> {
  const nowIso = now.toISOString();
  const due = listDue(db, nowIso);

  for (const config of due) {
    const decision = evaluate(config, now);
    try {
      switch (decision.kind) {
        case "enter_grace":
          await enterGrace(db, deps, config, nowIso);
          break;
        case "remind":
          await sendReminder(db, deps, config, nowIso);
          break;
        case "trigger":
          trigger(db, config, nowIso);
          break;
        case "stay":
        case "noop":
          break;
      }
    } catch (err) {
      // FR-022: a send/processing failure for one user must not abort the batch. Record a
      // non-sensitive marker (no recipient, no message content) and continue.
      recordEvent(db, config.userId, "reminder_sent", { delivered: false }, nowIso);
      void err;
    }
  }
}

/** Move an active switch to grace, set the grace deadline, and send the first reminder. */
async function enterGrace(
  db: Db,
  deps: Deps,
  config: DeadmanConfig,
  nowIso: string,
): Promise<void> {
  const graceDeadlineAt = addSeconds(nowIso, config.gracePeriodSeconds);
  setState(db, config.userId, "grace", { graceDeadlineAt, remindersSent: 1 }, nowIso);
  recordEvent(db, config.userId, "entered_grace", { graceDeadlineAt }, nowIso);

  const email = deps.userEmailFor(config.userId);
  if (email) {
    await deps.notify(buildReminder(email));
  }
  recordEvent(db, config.userId, "reminder_sent", { reminder: 1 }, nowIso);
}

/** Send another grace reminder and increment the counter (cap enforced by `evaluate`). */
async function sendReminder(
  db: Db,
  deps: Deps,
  config: DeadmanConfig,
  nowIso: string,
): Promise<void> {
  const remindersSent = config.remindersSent + 1;
  setState(db, config.userId, "grace", { remindersSent }, nowIso);

  const email = deps.userEmailFor(config.userId);
  if (email) {
    await deps.notify(buildReminder(email));
  }
  recordEvent(db, config.userId, "reminder_sent", { reminder: remindersSent }, nowIso);
}

/** Fire the switch: transition to triggered and record it (no contact email in 008). */
function trigger(db: Db, config: DeadmanConfig, nowIso: string): void {
  setState(db, config.userId, "triggered", { graceDeadlineAt: config.graceDeadlineAt }, nowIso);
  recordEvent(db, config.userId, "triggered", null, nowIso);
}

/** Re-export for callers that need the working config shape alongside the engine. */
export type { DeadmanConfig };
export { getConfig };
