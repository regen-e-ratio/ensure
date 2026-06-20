import {
  DEADMAN_MAX_GRACE_REMINDERS,
  RELEASE_GRANT_TTL_SECONDS,
} from "@ensure/shared/constants";
import type { Db } from "../db/index";
import {
  getConfig,
  listDue,
  setState,
  type DeadmanConfig,
} from "./config-repo";
import { recordEvent } from "./event-repo";
import {
  createRelease,
  createGrants,
  setGrantEmailStatus,
  hasReleaseForCurrentCycle,
  isUniqueConstraintError,
  type GrantSeed,
} from "../db/release-repo";
import { mintToken, hashToken } from "./tokens";

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

/** A snapshotted release recipient: a verified contact's id + its address. */
export interface ReleaseRecipient {
  contactId: string;
  address: string;
}

/**
 * The release-delivery capability the engine needs on trigger (feature 010), injected so the
 * engine stays unit-testable with spies. `listVerifiedContacts` snapshots only verified contacts
 * (`verified_at != null`); `sendReleaseEmail` emails one tokenized `/r/<token>` link via the
 * generic `notify()` dispatcher and resolves with the provider message id (or throws on failure).
 * The raw token is passed here only to build the link — it is never stored or logged.
 */
export interface ReleaseDeps {
  listVerifiedContacts: (userId: string) => ReleaseRecipient[];
  sendReleaseEmail: (recipient: string, token: string) => Promise<string | null>;
}

/**
 * The side-effecting capabilities the engine needs, injected so `runDeadmanTick` stays
 * unit-testable with a spy notifier and a deterministic clock (FR-009). `notify` sends one
 * reminder via the generic dispatcher (never a provider directly); `now` is the clock.
 * `userEmailFor` resolves the recipient address (the user's own account email in 008).
 * `release` (feature 010) is the delivery capability used when a switch fires; when omitted
 * (e.g. 008-era tests) the trigger still transitions to `triggered` but creates no release.
 */
export interface Deps {
  notify: (message: ReminderMessage) => Promise<void>;
  now: () => Date;
  userEmailFor: (userId: string) => string | null;
  release?: ReleaseDeps;
  /**
   * Mint a fresh one-time check-in link for `userId` (feature 011): mint a high-entropy token,
   * persist ONLY its SHA-256 hash in `checkin_token` with a future expiry, and return the absolute
   * `${appBaseUrl}/checkin?token=<token>` link to embed in a reminder. Injected as a closure so the
   * engine stays unit-testable with a spy. When omitted (008-era tests), reminders carry no link.
   * The raw token is surfaced only inside the returned link — never stored or logged.
   */
  mintCheckinLink?: (userId: string) => string;
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

/**
 * Build the reminder message for a user's grace window (no secret beyond the one-time link,
 * FR-008/FR-017). When a `checkinLink` is supplied (feature 011) the body embeds a single
 * `${appBaseUrl}/checkin?token=<token>` link so the user can check in straight from their inbox
 * without signing in; the raw token appears only inside that link. When omitted (008-era tests),
 * the body falls back to the sign-in-and-check-in instruction.
 */
function buildReminder(recipient: string, checkinLink: string | null): ReminderMessage {
  const body = checkinLink
    ? "Your Ensure dead-man switch missed its check-in deadline and is now in its grace " +
      "period. Check in now to reset it — no sign-in needed — using your one-time link:\n" +
      checkinLink +
      "\n\nIf you do not check in before the grace period ends, your switch will fire."
    : "Your Ensure dead-man switch missed its check-in deadline and is now in its grace " +
      "period. Sign in and check in (\"I'm alive\") to reset it. If you do not check in " +
      "before the grace period ends, your switch will fire.";
  return {
    recipient,
    subject: "Action needed: check in to your Ensure switch",
    body,
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
          await trigger(db, deps, config, nowIso);
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
    // Mint a fresh one-time check-in link for THIS reminder (feature 011); each reminder carries
    // its own link. A null link (008-era deps without mintCheckinLink) falls back to no link.
    const checkinLink = deps.mintCheckinLink ? deps.mintCheckinLink(config.userId) : null;
    await deps.notify(buildReminder(email, checkinLink));
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
    const checkinLink = deps.mintCheckinLink ? deps.mintCheckinLink(config.userId) : null;
    await deps.notify(buildReminder(email, checkinLink));
  }
  recordEvent(db, config.userId, "reminder_sent", { reminder: remindersSent }, nowIso);
}

/**
 * Fire the switch (feature 010): create a release, snapshot the user's VERIFIED contacts, mint
 * one one-time grant token per contact (storing only its hash), email each a tokenized link via
 * the injected notifier (recording per-grant `email_status`, a single failure never aborting the
 * batch), transition to `triggered`, and record `triggered` + `released` (grant count only, never
 * a token or plaintext).
 *
 * Idempotent (FR-005, SC-002): guarded by an existing-release check, so the in-process timer and
 * an external cron can never double-release. When no `release` deps are injected (008-era tests),
 * it still transitions to `triggered` and records `triggered` without creating a release.
 */
async function trigger(
  db: Db,
  deps: Deps,
  config: DeadmanConfig,
  nowIso: string,
): Promise<void> {
  const userId = config.userId;

  // Fast-path idempotency: never create a second scheduled release for an already-released cycle.
  if (deps.release && hasReleaseForCurrentCycle(db, userId)) {
    // Ensure the state is at least `triggered` (defensive); create no new release/grants/events.
    setState(db, userId, "triggered", { graceDeadlineAt: config.graceDeadlineAt }, nowIso);
    return;
  }

  let grantCount = 0;
  let released = false;
  if (deps.release) {
    try {
      grantCount = await deliverRelease(db, deps.release, userId, "schedule", nowIso);
      released = true;
    } catch (err) {
      // Durable idempotency across processes: the `schedule` release is guarded by a partial UNIQUE
      // index, so if a concurrent tick (in-process timer + external `deadman:tick` cron) already
      // claimed this cycle, our INSERT loses with a unique violation. Treat that as already-released
      // — transition only, never double-deliver. Any other error propagates to the batch handler.
      if (!isUniqueConstraintError(err)) throw err;
      setState(db, userId, "triggered", { graceDeadlineAt: config.graceDeadlineAt }, nowIso);
      return;
    }
  }

  setState(db, userId, "triggered", { graceDeadlineAt: config.graceDeadlineAt }, nowIso);
  recordEvent(db, userId, "triggered", null, nowIso);
  if (released) {
    // Non-sensitive metadata only: the number of grants created (FR-017, SC-008).
    recordEvent(db, userId, "released", { grants: grantCount }, nowIso);
  }
}

/**
 * Shared release delivery (used by the engine trigger and the manual test-release): create a
 * `release` of the given `trigger` kind, snapshot the owner's verified contacts, mint + hash one
 * grant token per contact, persist the grants (hash + 30-day expiry), and email each a tokenized
 * link via the injected notifier, recording per-grant `email_status`. A single send failure is
 * caught into `email_status='failed'` and never aborts the batch (others continue). Returns the
 * number of grants created. Never persists or logs a raw token or note plaintext.
 */
export async function deliverRelease(
  db: Db,
  release: ReleaseDeps,
  userId: string,
  trigger: "schedule" | "manual_test",
  nowIso: string,
): Promise<number> {
  const recipients = release.listVerifiedContacts(userId);
  if (recipients.length === 0) {
    // Still record an (empty) release so the cycle is marked released (idempotency) for a
    // scheduled fire; the caller decides whether to surface this.
    createRelease(db, userId, trigger, nowIso);
    return 0;
  }

  const releaseRow = createRelease(db, userId, trigger, nowIso);
  const expiresAt = addSeconds(nowIso, RELEASE_GRANT_TTL_SECONDS);

  // Mint one token per recipient up front; persist ONLY the hashes.
  const tokens = recipients.map(() => mintToken());
  const seeds: GrantSeed[] = recipients.map((r, i) => ({
    contactId: r.contactId,
    tokenHash: hashToken(tokens[i]!),
  }));
  const grantIds = createGrants(db, releaseRow.id, userId, seeds, expiresAt, nowIso);

  // Email each recipient its tokenized link; a per-grant failure is recorded and does not abort.
  for (let i = 0; i < recipients.length; i++) {
    const grantId = grantIds[i]!;
    try {
      const providerMessageId = await release.sendReleaseEmail(recipients[i]!.address, tokens[i]!);
      setGrantEmailStatus(db, grantId, "sent", providerMessageId);
    } catch {
      // FR-002/FR-022: record a non-sensitive failure marker (no token/address) and continue.
      setGrantEmailStatus(db, grantId, "failed", null, "send failed");
    }
  }

  return grantIds.length;
}

/** Re-export for callers that need the working config shape alongside the engine. */
export type { DeadmanConfig };
export { getConfig };
