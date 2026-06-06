/**
 * Refresh-aware fetch wrapper implementing silent refresh (research.md D2).
 *
 * On a `401` from a protected call, it attempts `POST /api/auth/refresh` exactly
 * once (coalescing concurrent attempts), and on success retries the original
 * request so an active user is never interrupted. If refresh also fails, the
 * original `401` is returned and the caller surfaces "unauthenticated".
 */

let refreshInFlight: Promise<boolean> | null = null;

/** Attempt a single token refresh, coalescing concurrent callers onto one request. */
function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST" })
      .then((res) => res.status === 204)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** Like `fetch`, but transparently refreshes the access token once on a 401 and retries. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  const refreshed = await refreshOnce();
  if (!refreshed) return res;

  return fetch(input, init);
}
