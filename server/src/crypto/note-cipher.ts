import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM sealing for note content (research.md D1). A note is stored as the
 * single BLOB `nonce(12) ‖ ciphertext ‖ authTag(16)`. GCM provides confidentiality
 * *and* integrity: a tampered or truncated BLOB fails the auth-tag check on `open`,
 * which is exactly the fail-closed signal the read path relies on (FR-015). Uses
 * only Node's built-in `crypto` — no new dependency (Principle II).
 */

const NONCE_BYTES = 12; // 96-bit nonce — the recommended size for AES-GCM.
const TAG_BYTES = 16; // 128-bit GCM authentication tag.
export const KEY_BYTES = 32; // AES-256 key length.

/**
 * Encrypt `plaintext` under a 32-byte `key`. A fresh random nonce is drawn per call,
 * so re-sealing identical text yields different output. Returns `nonce ‖ ct ‖ tag`.
 */
export function seal(key: Buffer, plaintext: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, tag]);
}

/**
 * Decrypt a `nonce ‖ ct ‖ tag` BLOB under `key`. Throws if the BLOB is too short or
 * the GCM auth tag does not verify (tampered/truncated ciphertext, or wrong key) —
 * callers map any throw to a fail-closed read and never return plaintext (FR-015).
 */
export function open(key: Buffer, blob: Buffer): string {
  if (blob.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error("ciphertext is too short to contain a nonce and auth tag");
  }
  const nonce = blob.subarray(0, NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ciphertext = blob.subarray(NONCE_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
