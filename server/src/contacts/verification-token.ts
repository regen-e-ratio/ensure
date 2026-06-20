import { createHash, randomBytes } from "node:crypto";

/**
 * Contact-verification token helpers (feature 009). They mirror the session/refresh-token
 * pattern in `server/src/auth/tokens.ts`: a high-entropy random value is surfaced exactly
 * once inside the emailed link, and the database stores only its SHA-256 hash. Verification
 * hashes the incoming token and compares against the stored hash — the raw token is never
 * stored, logged, or serialized (FR-004, FR-012, SC-006).
 */

/** Mint a high-entropy verification token (raw value handed to the email link, never stored). */
export function mintVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hash (hex) of a verification token — only the hash is persisted. */
export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
