import { useState } from "react";
import { ApiError, testRelease } from "../api/deadmanClient";

/**
 * Feature 012 (US2) — the guarded "send myself a test release" preview CTA.
 *
 * Reuses feature 010's existing authed `POST /api/deadman/test-release` (via the `testRelease`
 * client), which mints a one-time grant to the caller's OWN address so they receive exactly
 * the email a contact would and can open the view-once link themselves — building trust before
 * arming. The CTA is DISABLED/guarded with an explanation when the caller has no contact and
 * never calls the endpoint in that case (FR-006). The confirmation lives in an accessible live region
 * and discloses NO token, grant, or note plaintext — the only secret is the emailed one-time link
 * (FR-007, FR-017). A failure surfaces via role="alert" without falsely claiming success.
 */
export interface TestReleaseCtaProps {
  hasContact: boolean;
}

type Phase =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function TestReleaseCta({ hasContact }: TestReleaseCtaProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function handleClick() {
    if (!hasContact) return; // guarded — never call the endpoint without a contact.
    setPhase({ kind: "working" });
    try {
      await testRelease();
      setPhase({ kind: "sent" });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not send a test release. Please try again.";
      setPhase({ kind: "error", message });
    }
  }

  return (
    <div className="test-release">
      <button
        type="button"
        className="button button--ghost"
        onClick={() => void handleClick()}
        disabled={!hasContact || phase.kind === "working"}
      >
        {phase.kind === "working" ? "Sending…" : "Send myself a test release"}
      </button>

      {hasContact ? (
        <p className="test-release__hint">
          We&apos;ll email your own address exactly what your contacts would receive. The
          link can be opened only once.
        </p>
      ) : (
        <p className="test-release__hint">
          Add a contact first — then you can send yourself a preview to see exactly what
          your contacts will receive.
        </p>
      )}

      {phase.kind === "error" ? (
        <p className="status status--error" role="alert">
          {phase.message}
        </p>
      ) : (
        <p className="status" role="status" aria-live="polite">
          {phase.kind === "sent"
            ? "Preview sent. Check your own inbox — you'll receive exactly what a contact would, with a link you can open once."
            : ""}
        </p>
      )}
    </div>
  );
}
