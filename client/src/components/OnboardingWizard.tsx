import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CHECKIN_INTERVAL_MIN_SECONDS,
  CHECKIN_INTERVAL_MAX_SECONDS,
  GRACE_PERIOD_MIN_SECONDS,
  GRACE_PERIOD_MAX_SECONDS,
  DEADMAN_DEFAULT_INTERVAL_SECONDS,
  DEADMAN_DEFAULT_GRACE_SECONDS,
} from "@ensure/shared/constants";
import {
  ApiError,
  getStatus,
  putConfig,
  type DeadmanStatus,
} from "../api/deadmanClient";
import { getContacts, type Contact } from "../api/contactClient";
import { getNote } from "../api/noteClient";
import { NoteEditor } from "./NoteEditor";
import { ContactList } from "./ContactList";
import { TestReleaseCta } from "./TestReleaseCta";
import {
  isFirstRun,
  isWizardDismissed,
  dismissWizard,
  nextIncompleteStep,
  hasContact,
  WIZARD_STEPS,
  type WizardStep,
} from "../onboarding/firstRun";
import { formatDuration } from "../onboarding/formatDuration";

/**
 * Feature 012 (US1/US2) — the dismissible, non-blocking guided wizard.
 *
 * It reads the existing status (`GET /api/deadman`), note (`GET /api/note`), and contacts
 * (`GET /api/contact`) to derive whether to OFFER itself (first-run / never-armed) and which step to
 * RESUME at, then walks the user through: write a note → add a contact → set interval/grace
 * & arm. Each step drives an EXISTING endpoint via the existing `NoteEditor`/`ContactList`/`putConfig`
 * — no new backend. Dismissal (Escape or the labelled control) is session-local (`sessionStorage`) and
 * writes NO backend state. It renders no token, grant, or note plaintext in its own chrome (FR-017).
 *
 * `forceOpen` lets the help affordance (US3) relaunch the wizard on demand even once dismissed/armed;
 * `onClose` notifies the parent so it can clear that override.
 */
export interface OnboardingWizardProps {
  /** When true, show the wizard regardless of first-run/dismissed state (relaunched from help). */
  forceOpen?: boolean;
  /** Called when the wizard hides (dismiss/complete) so a parent can clear `forceOpen`. */
  onClose?: () => void;
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; status: DeadmanStatus; hasNote: boolean; contacts: Contact[] }
  | { kind: "absent" };

export function OnboardingWizard({ forceOpen = false, onClose }: OnboardingWizardProps) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  // Local refresh tick so re-reading after a step completes re-derives progress.
  const [refreshKey, setRefreshKey] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [armPhase, setArmPhase] = useState<
    { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [armed, setArmed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Interval/grace form (seconds), seeded from the loaded status / generous defaults.
  const [interval, setIntervalSeconds] = useState<number>(DEADMAN_DEFAULT_INTERVAL_SECONDS);
  const [grace, setGraceSeconds] = useState<number>(DEADMAN_DEFAULT_GRACE_SECONDS);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load the three existing reads on mount and whenever a step completes.
  useEffect(() => {
    let active = true;
    Promise.all([getStatus(), getNote(), getContacts()])
      .then(([status, note, contacts]) => {
        if (!active) return;
        setLoad({ kind: "ready", status, hasNote: note !== null, contacts });
        setIntervalSeconds(status.checkinIntervalSeconds || DEADMAN_DEFAULT_INTERVAL_SECONDS);
        setGraceSeconds(status.gracePeriodSeconds || DEADMAN_DEFAULT_GRACE_SECONDS);
      })
      .catch(() => {
        // The wizard is best-effort, non-blocking: if the reads fail, simply do not offer it (the
        // dashboard itself surfaces the real error).
        if (active) setLoad({ kind: "absent" });
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const close = useCallback(() => {
    dismissWizard();
    setHidden(true);
    onClose?.();
  }, [onClose]);

  // Escape dismisses the wizard (FR-005) — global key listener while visible.
  const visibleRef = useRef(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && visibleRef.current) {
        e.stopPropagation();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  if (load.kind !== "ready") return null;

  const { status, hasNote, contacts } = load;
  const hasAnyContact = hasContact(contacts);
  const isArmed = armed || status.enabled === true || status.state === "active";

  // Offer the wizard on first-run, unless dismissed this session — or whenever force-opened (US3).
  const offered = forceOpen || (isFirstRun(status, hasNote, contacts) && !isWizardDismissed());
  const visible = offered && !hidden;
  visibleRef.current = visible;
  if (!visible) return null;

  const step: WizardStep = nextIncompleteStep(hasNote, hasAnyContact, isArmed);
  const isComplete = step === "done" || armed;

  async function handleArm(event: FormEvent) {
    event.preventDefault();
    const ok = window.confirm(
      "Arm your dead-man switch? If you do not check in before each deadline, your switch will " +
        "eventually release your note to your contacts. You can disarm it at any time.",
    );
    if (!ok) return;
    setArmPhase({ kind: "working" });
    try {
      await putConfig({
        checkinIntervalSeconds: interval,
        gracePeriodSeconds: grace,
        enabled: true,
      });
      setArmed(true);
      setArmPhase({ kind: "idle" });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Could not arm your switch. Please try again.";
      setArmPhase({ kind: "error", message });
    }
  }

  const stepLabels: Record<WizardStep, string> = {
    "write-note": "Write your note",
    "add-contact": "Add a contact",
    "set-interval-grace": "Set your schedule & arm",
    done: "Done",
  };

  return (
    <section className="wizard" aria-labelledby="wizard-heading" role="region">
      <div className="wizard__header">
        <h2 id="wizard-heading" ref={headingRef} tabIndex={-1}>
          Set up your dead-man switch
        </h2>
        <button type="button" className="button button--ghost" onClick={close}>
          {isComplete ? "Close" : "Skip for now"}
        </button>
      </div>

      <p>
        A dead-man switch quietly checks that you are still around. If you stop checking in, it
        releases your note to the people you chose. Let&apos;s set yours up in three steps.
      </p>

      {/* Step indicator — current/complete carried by text, not colour alone. */}
      <ol className="wizard__steps">
        {WIZARD_STEPS.map((s, i) => {
          const stepIndex = WIZARD_STEPS.indexOf(step as (typeof WIZARD_STEPS)[number]);
          const done = isComplete || (stepIndex >= 0 && i < stepIndex);
          const current = !isComplete && s === step;
          return (
            <li
              key={s}
              className={`wizard__step${current ? " wizard__step--current" : ""}${
                done ? " wizard__step--complete" : ""
              }`}
              aria-current={current ? "step" : undefined}
            >
              {done ? "✓ " : current ? "▶ " : `${i + 1}. `}
              {stepLabels[s]}
              {done ? " (done)" : current ? " (current step)" : ""}
            </li>
          );
        })}
      </ol>

      <div className="wizard__panel">
        {step === "write-note" ? (
          <>
            <h3>Step 1 — Write your note</h3>
            <p className="meta">
              Write the message your contacts should receive. It is encrypted at rest and only
              revealed if your switch ever fires.
            </p>
            <NoteEditor />
            <div className="wizard__actions">
              <button type="button" className="button" onClick={refresh}>
                I&apos;ve saved my note — continue
              </button>
            </div>
          </>
        ) : null}

        {step === "add-contact" ? (
          <>
            <h3>Step 2 — Add a contact</h3>
            <p className="meta">
              Add at least one email contact. Your contacts receive your note if your switch ever
              fires.
            </p>
            <ContactList />
            {/* US2: the guarded preview CTA is reachable here too (disabled until a contact is
                added, explaining the prerequisite) and on the schedule step. */}
            <TestReleaseCta hasContact={hasAnyContact} />
            <div className="wizard__actions">
              <button type="button" className="button" onClick={refresh}>
                I&apos;ve added a contact — continue
              </button>
            </div>
          </>
        ) : null}

        {step === "set-interval-grace" && !isComplete ? (
          <form onSubmit={handleArm}>
            <h3>Step 3 — Set your schedule &amp; arm</h3>
            <p className="meta">
              Choose how often you must check in, and how long a grace period you get after a missed
              deadline before your note is released.
            </p>

            <label htmlFor="wizard-interval">Check-in interval (seconds)</label>
            <input
              id="wizard-interval"
              type="number"
              value={interval}
              min={CHECKIN_INTERVAL_MIN_SECONDS}
              max={CHECKIN_INTERVAL_MAX_SECONDS}
              step={1}
              aria-describedby="wizard-interval-help"
              onChange={(e) => setIntervalSeconds(Number(e.target.value))}
              disabled={armPhase.kind === "working"}
            />
            <p id="wizard-interval-help" className="meta">
              Currently {formatDuration(interval)}. Between 1 hour and 365 days.
            </p>

            <label htmlFor="wizard-grace">Grace period (seconds)</label>
            <input
              id="wizard-grace"
              type="number"
              value={grace}
              min={GRACE_PERIOD_MIN_SECONDS}
              max={GRACE_PERIOD_MAX_SECONDS}
              step={1}
              aria-describedby="wizard-grace-help"
              onChange={(e) => setGraceSeconds(Number(e.target.value))}
              disabled={armPhase.kind === "working"}
            />
            <p id="wizard-grace-help" className="meta">
              Currently {formatDuration(grace)}. Between 1 hour and 30 days.
            </p>

            {/* US2: preview the recipient experience before arming. */}
            <TestReleaseCta hasContact={hasAnyContact} />

            <div className="wizard__actions">
              <button type="submit" className="button" disabled={armPhase.kind === "working"}>
                {armPhase.kind === "working" ? "Arming…" : "Arm my switch"}
              </button>
            </div>

            {armPhase.kind === "error" ? (
              <p className="status status--error" role="alert">
                {armPhase.message}
              </p>
            ) : (
              <p className="status" role="status" aria-live="polite" />
            )}
          </form>
        ) : null}

        {isComplete ? (
          <div role="status" aria-live="polite">
            <h3>Your switch is set up</h3>
            <p>
              Your switch is active. Check in before each deadline from this dashboard or from the
              reminder emails we send. You can disarm or change your schedule at any time.
            </p>
            <div className="wizard__actions">
              <button type="button" className="button" onClick={close}>
                Done
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
