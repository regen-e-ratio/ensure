import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, openRelease } from "../api/releaseClient";

type State =
  | { kind: "loading" }
  | { kind: "note"; note: string }
  | { kind: "gone" }
  | { kind: "error"; message: string };

/**
 * Public view-once release page (feature 010, FR-016). Reads the `:token` path param, opens the
 * one-time link on mount, and announces the outcome — the note (with a prominent "this can only
 * be opened once" warning), a clear "no longer available" message, or a generic error — with a
 * semantic heading and accessible live regions (role="status"/role="alert", no colour-only).
 * Reachable without a session (registered outside ProtectedRoute in App.tsx).
 *
 * The link is single-use, so the token must be opened exactly once: a `requestedToken` ref guards
 * React 18 StrictMode's double-invoked effect (and any re-render) so the token is never burned
 * twice — mirroring ContactVerifiedPage.
 */
export function ReleaseViewPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
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
      setState({ kind: "gone" });
      return;
    }
    if (requestedToken.current === token) {
      return;
    }
    requestedToken.current = token;
    openRelease(token)
      .then((result) => {
        if (!mounted.current) return;
        if (result.kind === "note") setState({ kind: "note", note: result.note });
        else setState({ kind: "gone" });
      })
      .catch((error) => {
        if (!mounted.current) return;
        const message =
          error instanceof ApiError ? error.message : "This message could not be opened.";
        setState({ kind: "error", message });
      });
  }, [token]);

  return (
    <main className="release-view">
      <h1>A message shared with you</h1>

      {state.kind === "loading" ? (
        <p role="status" aria-live="polite">
          Opening your message…
        </p>
      ) : state.kind === "note" ? (
        <div role="status" aria-live="polite">
          <p className="release-view__warning">
            <strong>Important:</strong> this message can only be opened once. It will not be
            available if you reload or revisit this link, so please read it now.
          </p>
          <h2>The message</h2>
          <pre className="release-view__note">{state.note}</pre>
        </div>
      ) : state.kind === "gone" ? (
        <div role="alert">
          <h2>This link is no longer available</h2>
          <p>
            This message has already been opened, or the link has expired. A one-time link can be
            opened only once and cannot be reopened.
          </p>
        </div>
      ) : (
        <div role="alert">
          <h2>This message could not be opened</h2>
          <p>{state.message}</p>
        </div>
      )}
    </main>
  );
}
