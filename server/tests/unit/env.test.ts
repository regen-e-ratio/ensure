import { describe, it, expect } from "vitest";
import { loadEnv, loadEncryption } from "../../src/config/env";

const KEY = Buffer.alloc(32, 1).toString("base64");
const ENC_COMPLETE: NodeJS.ProcessEnv = {
  NOTE_ENC_KEYS: `1:${KEY}`,
  NOTE_ENC_ACTIVE_VERSION: "1",
};

const COMPLETE: NodeJS.ProcessEnv = {
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/api/auth/google/callback",
  AUTH_JWT_SECRET: "a-sufficiently-long-secret-0123456789",
};

describe("loadEnv", () => {
  it("parses a complete environment into a typed AuthConfig", () => {
    const config = loadEnv(COMPLETE);
    expect(config.google.clientId).toBe(COMPLETE.GOOGLE_CLIENT_ID);
    expect(config.google.clientSecret).toBe(COMPLETE.GOOGLE_CLIENT_SECRET);
    expect(config.google.redirectUri).toBe(COMPLETE.GOOGLE_REDIRECT_URI);
    expect(config.jwtSecret).toBe(COMPLETE.AUTH_JWT_SECRET);
    expect(config.testMode).toBe(false);
  });

  it("sets testMode when AUTH_TEST_MODE=1", () => {
    expect(loadEnv({ ...COMPLETE, AUTH_TEST_MODE: "1" }).testMode).toBe(true);
  });

  it.each(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "AUTH_JWT_SECRET"])(
    "refuses to boot when %s is missing",
    (key) => {
      const broken = { ...COMPLETE };
      delete broken[key];
      expect(() => loadEnv(broken)).toThrow(/Invalid server configuration/);
    },
  );

  it("rejects a too-short JWT secret", () => {
    expect(() => loadEnv({ ...COMPLETE, AUTH_JWT_SECRET: "short" })).toThrow();
  });

  it("rejects a malformed redirect URI", () => {
    expect(() => loadEnv({ ...COMPLETE, GOOGLE_REDIRECT_URI: "not-a-url" })).toThrow();
  });
});

describe("loadEncryption", () => {
  it("builds a keyring from a valid env", () => {
    const ring = loadEncryption(ENC_COMPLETE);
    expect(ring.getActiveVersion()).toBe(1);
    expect(ring.listVersions()).toEqual([1]);
  });

  it.each(["NOTE_ENC_KEYS", "NOTE_ENC_ACTIVE_VERSION"])(
    "refuses to boot when %s is missing (fail closed)",
    (key) => {
      const broken = { ...ENC_COMPLETE };
      delete broken[key];
      expect(() => loadEncryption(broken)).toThrow(/Invalid server configuration/);
    },
  );

  it("refuses to boot when the active version is absent from the keyring", () => {
    expect(() => loadEncryption({ ...ENC_COMPLETE, NOTE_ENC_ACTIVE_VERSION: "2" })).toThrow(
      /Invalid server configuration/,
    );
  });

  it("refuses to boot when a key is not 32 bytes", () => {
    const short = Buffer.alloc(16, 1).toString("base64");
    expect(() =>
      loadEncryption({ NOTE_ENC_KEYS: `1:${short}`, NOTE_ENC_ACTIVE_VERSION: "1" }),
    ).toThrow(/Invalid server configuration/);
  });

  it("does not leak key material in the error (FR-016)", () => {
    expect(() => loadEncryption({ ...ENC_COMPLETE, NOTE_ENC_ACTIVE_VERSION: "2" })).toThrow();
    try {
      loadEncryption({ ...ENC_COMPLETE, NOTE_ENC_ACTIVE_VERSION: "2" });
    } catch (err) {
      expect((err as Error).message).not.toContain(KEY);
    }
  });
});
