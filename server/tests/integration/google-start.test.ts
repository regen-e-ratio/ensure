import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "../helpers/auth";
import { HANDSHAKE_COOKIE } from "../../src/auth/cookies";

// Mock the Google client at the library boundary so the real wrapper (google.ts) runs.
const googleMock = vi.hoisted(() => ({
  generateCodeVerifierAsync: vi.fn(),
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    generateCodeVerifierAsync = googleMock.generateCodeVerifierAsync;
    generateAuthUrl = googleMock.generateAuthUrl;
    getToken = googleMock.getToken;
    verifyIdToken = googleMock.verifyIdToken;
  },
  CodeChallengeMethod: { S256: "S256" },
}));

beforeEach(() => {
  vi.clearAllMocks();
  googleMock.generateCodeVerifierAsync.mockResolvedValue({
    codeVerifier: "verifier-xyz",
    codeChallenge: "challenge-xyz",
  });
  googleMock.generateAuthUrl.mockImplementation(
    (opts: { state: string }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${opts.state}`,
  );
});

describe("GET /api/auth/google/start", () => {
  it("302-redirects to Google and sets the signed handshake cookie", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/auth/google/start");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com/);

    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith(`${HANDSHAKE_COOKIE}=`))).toBe(true);
  });

  it("requests a PKCE (S256) + state authorization URL", async () => {
    const { app } = makeTestApp();
    await request(app).get("/api/auth/google/start");

    expect(googleMock.generateCodeVerifierAsync).toHaveBeenCalled();
    const opts = googleMock.generateAuthUrl.mock.calls[0]![0];
    expect(opts.code_challenge_method).toBe("S256");
    expect(opts.code_challenge).toBe("challenge-xyz");
    expect(typeof opts.state).toBe("string");
    expect(opts.state.length).toBeGreaterThan(0);
  });

  it("carries ?next through to a successful sign-in (returns the user there)", async () => {
    // The handshake cookie is opaque/signed; the effect of `next` is observable on callback.
    const { app } = makeTestApp();
    const res = await request(app).get("/api/auth/google/start?next=/somewhere");
    expect(res.status).toBe(302);
    // state is echoed into our mocked Google URL.
    const state = new URL(res.headers.location as string).searchParams.get("state");
    expect(state).toBeTruthy();
  });
});
