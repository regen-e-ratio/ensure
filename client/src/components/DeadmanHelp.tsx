import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Feature 012 (US3) — the always-available, accessible "How this works" explainer of the dead-man
 * model. Reachable from the dashboard regardless of first-run state. A trigger button opens a
 * dismissible panel (Escape + a labelled close control, with focus moved to the heading and returned
 * to the trigger on close) describing the `disarmed → active → grace → triggered` state machine, the
 * two check-in paths, the one-time secure release to contacts, instant disarm/pause, and
 * the anti-premature-trigger safeguards. It offers a control to (re-)launch the guided wizard. It
 * carries NO secret, token, or note plaintext — purely explanatory content (FR-008, FR-017).
 */
export interface DeadmanHelpProps {
  /** Open/relaunch the guided wizard (at its first incomplete step) from the explainer. */
  onRelaunchWizard: () => void;
}

export function DeadmanHelp({ onRelaunchWizard }: DeadmanHelpProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Move focus to the panel heading when it opens (focus management).
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div className="deadman-help">
      <button
        type="button"
        className="button button--ghost"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        aria-expanded={open}
      >
        How this works
      </button>

      {open ? (
        <section className="help-panel" aria-labelledby="help-heading" role="region">
          <h2 id="help-heading" ref={headingRef} tabIndex={-1}>
            How this works
          </h2>

          <p>
            A dead-man switch quietly confirms you are still around. If you stop checking in, it
            releases your note to the contacts you chose — and nothing is revealed until then.
          </p>

          <h3>The states your switch moves through</h3>
          <ul className="help-panel__states">
            <li>
              <strong>Disarmed</strong> — set up but not running. Nothing happens.
            </li>
            <li>
              <strong>Active</strong> — running. You must check in before each deadline.
            </li>
            <li>
              <strong>Grace</strong> — you missed a deadline. We send reminders; you still have time
              to check in.
            </li>
            <li>
              <strong>Triggered</strong> — the grace period also lapsed. Your note is released to your
              contacts.
            </li>
          </ul>

          <h3>Two ways to check in</h3>
          <p>
            Press the big <strong>&ldquo;I&apos;m alive — check in&rdquo;</strong> button on this
            dashboard, or click the one-time link in any reminder <strong>email</strong> we send — no
            sign-in needed. Either one resets the clock back to active.
          </p>

          <h3>What your contacts receive</h3>
          <p>
            When the switch fires, each contact gets an email with a secure link that reveals your
            note exactly <strong>once</strong>; after it is opened the link stops working. You can
            preview this safely with &ldquo;send myself a test release&rdquo; before you ever arm.
          </p>

          <h3>You are always in control</h3>
          <p>
            You can <strong>disarm or pause</strong> the switch instantly at any time. To guard
            against firing too early, the schedule uses generous defaults, you get a grace period with
            several reminders, there are two easy ways to check in, and arming always asks you to
            confirm. The deadline is an absolute time, so a restart never loses time or fires early.
          </p>

          <div className="wizard__actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                setOpen(false);
                onRelaunchWizard();
              }}
            >
              Show me — restart the guide
            </button>
            <button type="button" className="button button--ghost" onClick={close}>
              Close
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
