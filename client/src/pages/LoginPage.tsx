import { useSearchParams } from "react-router-dom";

/** Map an OAuth error code (from ?error) to a user-facing, displayable message. */
function errorMessage(code: string | null): string | null {
  if (!code) return null;
  if (code === "access_denied") return "Sign-in was cancelled. Please try again.";
  return "We couldn't sign you in. Please try again.";
}

/**
 * Public login page (US2). Renders an accessible, keyboard-operable "Sign in with
 * Google" link that carries the post-login `next` path, and announces any sign-in
 * error (from `?error`) via an aria-live region (WCAG AA).
 */
export function LoginPage() {
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const message = errorMessage(params.get("error"));
  const startUrl = `/api/auth/google/start?next=${encodeURIComponent(next)}`;

  return (
    <main className="login">
      <h1>Sign in</h1>
      <p>Sign in with your Google account to access your note.</p>

      {/* Live region: announces sign-in errors when present. */}
      <div role="alert" aria-live="assertive">
        {message ? <p className="status status--error">{message}</p> : null}
      </div>

      <a className="button button--google" href={startUrl}>
        Sign in with Google
      </a>
    </main>
  );
}
