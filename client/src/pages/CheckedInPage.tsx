import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { ApiError, checkInWithToken } from "../api/checkinClient";

type State =
  | { kind: "checking" }
  | { kind: "checked_in" }
  | { kind: "not_available" }
  | { kind: "error"; message: string };

/**
 * Public passwordless check-in page (feature 011, FR-012). Reads `?token`, calls the public
 * check-in endpoint on mount, and announces the outcome — you're checked in, the link is no longer
 * available, or a generic error — with a semantic heading and accessible live regions
 * (role="status"/role="alert", no colour-only signalling). Reachable without a session (registered
 * outside ProtectedRoute in App.tsx).
 *
 * The link is single-use, so the token must be opened exactly once: a `requestedToken` ref guards
 * React 18 StrictMode's double-invoked effect (and any re-render) so the token is never consumed
 * twice — mirroring ContactVerifiedPage/ReleaseViewPage.
 */
export function CheckedInPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>({ kind: "checking" });
  const requestedToken = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setState({ kind: "not_available" });
      return;
    }
    if (requestedToken.current === token) {
      return;
    }
    requestedToken.current = token;
    checkInWithToken(token)
      .then((status) => {
        if (!mounted.current) return;
        if (status === "checked_in") setState({ kind: "checked_in" });
        else setState({ kind: "not_available" });
      })
      .catch((error) => {
        if (!mounted.current) return;
        const message =
          error instanceof ApiError ? error.message : "Could not check you in.";
        setState({ kind: "error", message });
      });
  }, [token]);

  return (
    <main className="verify-result">
      <h1>Check in to your Ensure switch</h1>

      {state.kind === "checking" ? (
        <p role="status" aria-live="polite">
          Checking you in…
        </p>
      ) : state.kind === "checked_in" ? (
        <div role="status" aria-live="polite">
          <h2>You're checked in</h2>
          <p>
            Your dead-man switch has been reset and is active again. You don't need to do anything
            else right now — we'll remind you again before the next deadline.
          </p>
        </div>
      ) : state.kind === "not_available" ? (
        <div role="alert">
          <h2>This link is no longer available</h2>
          <p>
            This check-in link is invalid, has expired, or has already been used. A check-in link
            can be used only once. If your switch still needs a check-in, sign in to check in from
            your dashboard or use a more recent reminder link.
          </p>
        </div>
      ) : (
        <div role="alert">
          <h2>Could not check you in</h2>
          <p>{state.message}</p>
        </div>
      )}

      <p>
        <Link to="/">Go to Ensure</Link>
      </p>
    </main>
  );
}
