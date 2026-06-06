import { describe, it, expect } from "vitest";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateRefreshToken,
  hashToken,
  signAccessToken,
  signHandshake,
  verifyAccessToken,
  verifyHandshake,
  type AuthUser,
} from "../../src/auth/tokens";

const SECRET = "unit-test-secret-0123456789-abcdef";
const USER: AuthUser = { id: "google-sub-123", email: "a@example.com", name: "Ada" };

function decodeExp(jwt: string): number {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
  return payload.exp as number;
}

describe("access token", () => {
  it("signs and verifies, round-tripping the user identity", async () => {
    const token = await signAccessToken(USER, SECRET);
    const user = await verifyAccessToken(token, SECRET);
    expect(user).toEqual(USER);
  });

  it("sets a ~1h expiry", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signAccessToken(USER, SECRET);
    const exp = decodeExp(token);
    expect(exp).toBeGreaterThanOrEqual(before + ACCESS_TOKEN_TTL_SECONDS - 5);
    expect(exp).toBeLessThanOrEqual(before + ACCESS_TOKEN_TTL_SECONDS + 5);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAccessToken(USER, SECRET);
    expect(await verifyAccessToken(token, "another-secret-0123456789")).toBeNull();
  });

  it("rejects an already-expired token", async () => {
    const token = await signAccessToken(USER, SECRET, -10);
    expect(await verifyAccessToken(token, SECRET)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifyAccessToken("not.a.jwt", SECRET)).toBeNull();
  });

  it("normalizes a missing name to null", async () => {
    const token = await signAccessToken({ id: "x", email: "x@y.z" }, SECRET);
    const user = await verifyAccessToken(token, SECRET);
    expect(user).toEqual({ id: "x", email: "x@y.z", name: null });
  });
});

describe("refresh token", () => {
  it("generates distinct opaque tokens", () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });

  it("hashes deterministically and irreversibly (different from the raw value)", () => {
    const raw = generateRefreshToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).not.toBe(raw);
    expect(hashToken(raw)).toHaveLength(64); // sha256 hex
  });
});

describe("handshake token", () => {
  it("round-trips state, verifier, and next", async () => {
    const token = await signHandshake(
      { state: "s1", codeVerifier: "v1", next: "/dashboard" },
      SECRET,
    );
    expect(await verifyHandshake(token, SECRET)).toEqual({
      state: "s1",
      codeVerifier: "v1",
      next: "/dashboard",
    });
  });

  it("rejects a tampered/foreign handshake", async () => {
    const token = await signHandshake({ state: "s", codeVerifier: "v" }, SECRET);
    expect(await verifyHandshake(token, "different-secret-0123456789")).toBeNull();
  });
});
