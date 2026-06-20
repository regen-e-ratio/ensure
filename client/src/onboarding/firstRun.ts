import type { DeadmanStatus, DeadmanEvent } from "../api/deadmanClient";
import type { Contact } from "../api/contactClient";

/**
 * Feature 012 — pure, client-only onboarding derivation helpers.
 *
 * First-run detection and wizard progress are derived ENTIRELY from existing reads
 * (`GET /api/deadman` status + events, `GET /api/note`, `GET /api/contact`); there is no new
 * backend flag, column, table, or endpoint (FR-001). Wizard dismissal is held in client-local
 * `sessionStorage` (FR-005). Nothing here stores a token, grant, or note plaintext (FR-017).
 */

/** The ordered wizard steps. `done` means every prerequisite is satisfied / the switch is armed. */
export type WizardStep = "write-note" | "verify-contact" | "set-interval-grace" | "done";

/** The fixed step order the wizard walks (and the help relaunches into). */
export const WIZARD_STEPS: readonly WizardStep[] = [
  "write-note",
  "verify-contact",
  "set-interval-grace",
] as const;

/**
 * True only for a "first-run" (never-armed) user: the switch is currently `disarmed` AND it has
 * never been armed — no prior arm. We treat "prior arm" as either a recorded `armed` event or a
 * non-null `last_checkin_at` (arming stamps the first check-in). Either signal means the user has
 * engaged the switch before and is no longer first-run, so the wizard is not auto-offered.
 *
 * `hasNote`/`contacts` are accepted for symmetry with the other helpers and future use, but the
 * first-run decision is purely a switch-state question (a user may legitimately have a note or a
 * contact and still never have armed) — so they do not gate the offer.
 */
export function isFirstRun(
  status: DeadmanStatus,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the documented signature
  hasNote: boolean,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- part of the documented signature
  contacts: Contact[],
): boolean {
  if (status.state !== "disarmed") return false;
  if (status.lastCheckinAt !== null) return false;
  if (hasArmedEvent(status.events)) return false;
  return true;
}

/** Whether the event log contains a prior `armed` event (a definitive prior-arm signal). */
export function hasArmedEvent(events: DeadmanEvent[]): boolean {
  return events.some((e) => e.type === "armed");
}

/** Whether at least one of the caller's contacts is verified (a release prerequisite). */
export function hasVerifiedContact(contacts: Contact[]): boolean {
  return contacts.some((c) => c.verified);
}

/**
 * The first incomplete step for a resuming never-armed user (FR-003): write a note → add & verify
 * a contact → set interval/grace & arm. Returns `done` when all prerequisites are met / armed.
 */
export function nextIncompleteStep(
  hasNote: boolean,
  hasVerified: boolean,
  isArmed: boolean,
): WizardStep {
  if (!hasNote) return "write-note";
  if (!hasVerified) return "verify-contact";
  if (!isArmed) return "set-interval-grace";
  return "done";
}

const DISMISS_KEY = "ensure.onboarding.dismissed";

/** Whether the wizard was dismissed this session (client-local; never a backend call, FR-005). */
export function isWizardDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // sessionStorage unavailable (privacy mode / SSR) — treat as not dismissed.
    return false;
  }
}

/** Persist the dismissal for the session so the wizard does not re-appear on navigation. */
export function dismissWizard(): void {
  try {
    window.sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // best-effort; if storage is unavailable the wizard simply re-offers next load.
  }
}

/** Clear the session dismissal so the help affordance can re-launch the wizard on demand. */
export function clearWizardDismissed(): void {
  try {
    window.sessionStorage.removeItem(DISMISS_KEY);
  } catch {
    // best-effort.
  }
}
