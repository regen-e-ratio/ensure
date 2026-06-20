import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { ApiError, confirmVerification } from "../api/contactClient";

type State =
  | { kind: "checking" }
  | { kind: "verified" }
  | { kind: "already_verified" }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

/**
 * Public verification-result page (feature 009, FR-015). Reads `?token`, calls the public
 * confirm endpoint on mount, and announces the outcome — address confirmed, already
 * confirmed, or invalid/expired/used — with a semantic heading and an accessible live
 * region. Reachable without a session (registered outside ProtectedRoute in App.tsx).
 */
export function ContactVerifiedPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>({ kind: "checking" });
  // The verify link is single-use: a token must be confirmed exactly once. Guard against
  // React 18 StrictMode's double-invoked effect (and any re-render) so we never burn the
  // token on a duplicate request that would then report "invalid". A mounted ref keeps us
  // from setting state after unmount instead of cancelling the (single) in-flight request.
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
      setState({ kind: "invalid" });
      return;
    }
    if (requestedToken.current === token) {
      return;
    }
    requestedToken.current = token;
    confirmVerification(token)
      .then((status) => {
        if (!mounted.current) return;
        if (status === "verified") setState({ kind: "verified" });
        else if (status === "already_verified") setState({ kind: "already_verified" });
        else setState({ kind: "invalid" });
      })
      .catch((error) => {
        if (!mounted.current) return;
        const message =
          error instanceof ApiError ? error.message : "Could not confirm this link.";
        setState({ kind: "error", message });
      });
  }, [token]);

  const isError = state.kind === "invalid" || state.kind === "error";

  return (
    <main className="verify-result">
      <h1>Email verification</h1>

      {state.kind === "checking" ? (
        <p role="status" aria-live="polite">
          Confirming your link…
        </p>
      ) : isError ? (
        <div role="alert">
          <h2>This link is no longer valid</h2>
          <p>
            {state.kind === "error"
              ? state.message
              : "This verification link is invalid, has expired, or has already been used. Ask the person who added you to send a new one."}
          </p>
        </div>
      ) : (
        <div role="status" aria-live="polite">
          <h2>Your email is confirmed</h2>
          <p>
            {state.kind === "already_verified"
              ? "This address was already confirmed. No further action is needed."
              : "Thanks — you have confirmed control of this email address."}
          </p>
        </div>
      )}

      <p>
        <Link to="/">Go to Ensure</Link>
      </p>
    </main>
  );
}
