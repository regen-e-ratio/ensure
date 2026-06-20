/**
 * Parse the `token` query param for the PUBLIC check-in route (feature 011). The token is the sole
 * authority, so the only validation here is presence/shape: a non-empty string of the URL-safe
 * characters a base64url token uses. A missing/malformed token collapses to the generic
 * not-available path (the route never discloses why). The raw token is never logged. Mirrors
 * `parseReleaseToken` in validation/release.ts.
 */
export type ParseCheckinTokenResult =
  | { ok: true; token: string }
  | { ok: false };

/** Validate the raw `token` query param. */
export function parseCheckinToken(raw: unknown): ParseCheckinTokenResult {
  if (typeof raw !== "string") {
    return { ok: false };
  }
  const token = raw.trim();
  // base64url alphabet only; bound the length so an absurd input is rejected before hashing.
  if (token.length === 0 || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false };
  }
  return { ok: true, token };
}
