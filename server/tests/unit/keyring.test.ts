import { describe, it, expect } from "vitest";
import { createKeyring } from "../../src/crypto/keyring";

const k = (fill: number) => Buffer.alloc(32, fill).toString("base64");

describe("createKeyring", () => {
  it("parses multiple versions and selects the active one", () => {
    const ring = createKeyring(`1:${k(1)},2:${k(2)}`, "2");
    expect(ring.getActiveVersion()).toBe(2);
    expect(ring.listVersions()).toEqual([1, 2]);
    expect(ring.hasVersion(1)).toBe(true);
    expect(ring.hasVersion(3)).toBe(false);
    expect(ring.getKey(1).equals(Buffer.alloc(32, 1))).toBe(true);
  });

  it("getKey throws for an unknown version", () => {
    const ring = createKeyring(`1:${k(1)}`, "1");
    expect(() => ring.getKey(2)).toThrow(/version 2/);
  });

  it("tolerates surrounding whitespace in entries", () => {
    const ring = createKeyring(` 1:${k(1)} , 2:${k(2)} `, " 2 ");
    expect(ring.getActiveVersion()).toBe(2);
    expect(ring.listVersions()).toEqual([1, 2]);
  });

  it("rejects an empty keys spec (fail closed)", () => {
    expect(() => createKeyring("", "1")).toThrow();
    expect(() => createKeyring("   ", "1")).toThrow();
  });

  it("rejects a key that does not decode to exactly 32 bytes", () => {
    expect(() => createKeyring(`1:${Buffer.alloc(16, 1).toString("base64")}`, "1")).toThrow(
      /32 bytes/,
    );
  });

  it("rejects a malformed version:key entry", () => {
    expect(() => createKeyring(`notaversion`, "1")).toThrow();
    expect(() => createKeyring(`:${k(1)}`, "1")).toThrow();
  });

  it("rejects duplicate versions", () => {
    expect(() => createKeyring(`1:${k(1)},1:${k(2)}`, "1")).toThrow(/duplicate/);
  });

  it("rejects non-positive or non-integer versions", () => {
    expect(() => createKeyring(`0:${k(1)}`, "0")).toThrow();
    expect(() => createKeyring(`-1:${k(1)}`, "1")).toThrow();
    expect(() => createKeyring(`1.5:${k(1)}`, "1")).toThrow();
  });

  it("rejects an active version absent from the keyring", () => {
    expect(() => createKeyring(`1:${k(1)}`, "2")).toThrow(/not present/);
  });

  it("never includes key material in error messages (FR-016)", () => {
    const secret = k(1);
    try {
      createKeyring(`1:${secret}`, "2");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
