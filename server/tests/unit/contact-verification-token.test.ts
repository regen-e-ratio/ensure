import { describe, it, expect } from "vitest";
import {
  mintVerificationToken,
  hashVerificationToken,
} from "../../src/contacts/verification-token";

/**
 * Feature 009 — the contact-verification token reuses the auth hashed-token pattern: a
 * high-entropy raw value (shown once in the email link) and a deterministic SHA-256 hash
 * (the only thing stored). The raw token never equals its stored hash (FR-012, SC-006).
 */

describe("contact verification token helpers", () => {
  it("mints a high-entropy, url-safe token", () => {
    const token = mintVerificationToken();
    // 32 random bytes → base64url with no padding/unsafe chars.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("mints distinct tokens (no collisions across many mints)", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => mintVerificationToken()));
    expect(tokens.size).toBe(1000);
  });

  it("hashes deterministically (SHA-256 hex)", () => {
    const token = mintVerificationToken();
    expect(hashVerificationToken(token)).toBe(hashVerificationToken(token));
    expect(hashVerificationToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("maps distinct tokens to distinct hashes", () => {
    const a = mintVerificationToken();
    const b = mintVerificationToken();
    expect(hashVerificationToken(a)).not.toBe(hashVerificationToken(b));
  });

  it("never returns the raw token as its own hash", () => {
    const token = mintVerificationToken();
    expect(hashVerificationToken(token)).not.toBe(token);
  });
});
