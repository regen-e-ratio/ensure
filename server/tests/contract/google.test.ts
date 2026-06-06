import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "../helpers/auth";

// Asserts /auth/google/start and /auth/google/callback conform to the contract:
// both are documented as 302 redirects (no JSON body).

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
    codeVerifier: "v",
    codeChallenge: "c",
  });
  googleMock.generateAuthUrl.mockImplementation(
    (opts: { state: string }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${opts.state}`,
  );
});

describe("google auth contract", () => {
  it("GET /auth/google/start responds 302 with a Location header", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/auth/google/start");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBeTruthy();
  });

  it("GET /auth/google/callback responds 302 on the error path (no JSON body)", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/auth/google/callback?error=access_denied");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login\?error=/);
    expect(res.body).toEqual({});
  });
});
