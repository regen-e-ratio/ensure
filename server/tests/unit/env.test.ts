import { describe, it, expect } from "vitest";
import { loadEnv } from "../../src/config/env";

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
