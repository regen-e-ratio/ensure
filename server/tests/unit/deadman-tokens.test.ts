import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mintToken, hashToken, compareToken } from "../../src/deadman/tokens";

describe("deadman tokens (feature 010 release grants; shared with 011)", () => {
  it("mintToken returns a high-entropy, URL-safe value", () => {
    const token = mintToken();
    // base64url of 32 bytes → 43 chars, no padding, only URL-safe alphabet.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("mints distinct tokens on each call", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => mintToken()));
    expect(tokens.size).toBe(100);
  });

  it("hashToken is a deterministic SHA-256 hex of the token", () => {
    const token = "fixed-token-value";
    const expected = createHash("sha256").update(token).digest("hex");
    expect(hashToken(token)).toBe(expected);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinct tokens produce distinct hashes", () => {
    const a = mintToken();
    const b = mintToken();
    expect(hashToken(a)).not.toBe(hashToken(b));
  });

  it("never stores the raw token: the hash never equals the token", () => {
    const token = mintToken();
    expect(hashToken(token)).not.toBe(token);
  });

  it("compareToken is true for equal hashes and false otherwise", () => {
    const token = mintToken();
    const hash = hashToken(token);
    expect(compareToken(hash, hashToken(token))).toBe(true);
    expect(compareToken(hash, hashToken(mintToken()))).toBe(false);
  });

  it("compareToken is false for length mismatches without throwing", () => {
    expect(compareToken("abc", "abcd")).toBe(false);
    expect(compareToken("", hashToken("x"))).toBe(false);
  });
});
