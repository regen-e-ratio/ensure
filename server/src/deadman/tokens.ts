import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Dead-man token helpers (feature 010 release grants; shared with feature 011 check-in links).
 * They mirror the session/refresh-token pattern in `server/src/auth/tokens.ts` and the contact
 * verification token: a high-entropy random value is surfaced exactly once inside an emailed
 * link, and the database stores ONLY its SHA-256 hash. Lookups hash the incoming token and
 * compare against the stored hash — the raw token is never stored, logged, or serialized
 * (roadmap §3; FR-012, SC-008).
 */

/** Mint a high-entropy token (raw value handed to the email link, never stored). */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hash (hex) of a token — only the hash is persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time comparison of two token hashes (hex strings of equal length). Returns false
 * for any length mismatch without leaking timing about the prefix. Used where a candidate hash
 * must be compared to a stored hash without an early-exit string compare.
 */
export function compareToken(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
