import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { seal, open, KEY_BYTES } from "../../src/crypto/note-cipher";

const KEY = Buffer.alloc(KEY_BYTES, 9);

describe("note-cipher (AES-256-GCM)", () => {
  it("round-trips text losslessly (FR-009)", () => {
    for (const text of ["", "hello", "unicode: café ☕ 你好", "a".repeat(10_000)]) {
      expect(open(KEY, seal(KEY, text))).toBe(text);
    }
  });

  it("produces a nonce-prefixed BLOB, never the plaintext bytes (FR-008)", () => {
    const blob = seal(KEY, "Buy milk");
    expect(blob.includes(Buffer.from("Buy milk", "utf8"))).toBe(false);
    // nonce(12) + tag(16) = 28 bytes of overhead minimum.
    expect(blob.length).toBeGreaterThanOrEqual(28);
  });

  it("uses a fresh nonce per call, so identical text yields different BLOBs", () => {
    expect(seal(KEY, "same").equals(seal(KEY, "same"))).toBe(false);
  });

  it("rejects a tampered ciphertext byte (GCM auth-tag failure → fail closed, FR-015)", () => {
    const blob = seal(KEY, "secret");
    blob.writeUInt8(blob.readUInt8(13) ^ 0xff, 13); // flip a byte inside the ciphertext region
    expect(() => open(KEY, blob)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const blob = seal(KEY, "secret");
    const last = blob.length - 1;
    blob.writeUInt8(blob.readUInt8(last) ^ 0xff, last); // flip a tag byte
    expect(() => open(KEY, blob)).toThrow();
  });

  it("rejects decryption under the wrong key", () => {
    const blob = seal(KEY, "secret");
    expect(() => open(randomBytes(KEY_BYTES), blob)).toThrow();
  });

  it("rejects a truncated BLOB shorter than nonce+tag", () => {
    expect(() => open(KEY, Buffer.alloc(10))).toThrow();
  });
});
