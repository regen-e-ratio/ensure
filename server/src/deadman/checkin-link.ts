/**
 * Single source of the passwordless check-in URL shape (feature 011), shared by the engine's
 * `mintCheckinLink` (deps.ts) and any test assertions. The raw token appears here exactly once,
 * inside the link — it is never stored or logged. Mirrors `buildReleaseEmail`'s link construction:
 * a trailing-slash-trimmed base plus `/checkin?token=<token>` (the token is URL-encoded).
 */
export function buildCheckinLink(appBaseUrl: string, token: string): string {
  const base = appBaseUrl.replace(/\/+$/, "");
  return `${base}/checkin?token=${encodeURIComponent(token)}`;
}
