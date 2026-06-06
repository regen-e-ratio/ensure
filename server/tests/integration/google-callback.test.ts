import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "../helpers/auth";
import { getUser } from "../../src/db/user-repo";

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

const PROFILE = { sub: "google-123", email: "real@example.com", name: "Real User" };

beforeEach(() => {
  vi.clearAllMocks();
  googleMock.generateCodeVerifierAsync.mockResolvedValue({
    codeVerifier: "verifier-xyz",
    codeChallenge: "challenge-xyz",
  });
  googleMock.generateAuthUrl.mockImplementation(
    (opts: { state: string }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${opts.state}`,
  );
  googleMock.getToken.mockResolvedValue({ tokens: { id_token: "id-token-abc" } });
  googleMock.verifyIdToken.mockResolvedValue({ getPayload: () => PROFILE });
});

/** Drive /start (to obtain the handshake cookie + state) then /callback, sharing cookies. */
async function startThenCallback(next?: string) {
  const { app, db } = makeTestApp();
  const agent = request.agent(app);
  const startUrl = next
    ? `/api/auth/google/start?next=${encodeURIComponent(next)}`
    : "/api/auth/google/start";
  const start = await agent.get(startUrl);
  const state = new URL(start.headers.location as string).searchParams.get("state")!;
  return { app, db, agent, state };
}

describe("GET /api/auth/google/callback", () => {
  it("exchanges the code, provisions the user, sets session cookies, redirects to next", async () => {
    const { db, agent, state } = await startThenCallback("/dashboard");

    const res = await agent.get(`/api/auth/google/callback?code=auth-code&state=${state}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/dashboard");

    // User provisioned from the verified ID token.
    expect(getUser(db, "google-123")).toEqual({
      id: "google-123",
      email: "real@example.com",
      name: "Real User",
    });

    // Both session cookies were issued.
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith("access_token="))).toBe(true);
    expect(setCookie.some((c) => c.startsWith("refresh_token="))).toBe(true);

    // The session is real: /auth/me returns the user.
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe("google-123");

    expect(googleMock.getToken).toHaveBeenCalledWith(
      expect.objectContaining({ code: "auth-code", codeVerifier: "verifier-xyz" }),
    );
  });

  it("defaults the redirect to / when no next was provided", async () => {
    const { agent, state } = await startThenCallback();
    const res = await agent.get(`/api/auth/google/callback?code=c&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
  });

  it("redirects to /login?error when the user cancels/denies", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/auth/google/callback?error=access_denied");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=access_denied");
  });

  it("rejects a mismatched state (CSRF) with /login?error=invalid_state", async () => {
    const { agent } = await startThenCallback();
    const res = await agent.get("/api/auth/google/callback?code=c&state=not-the-real-state");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=invalid_state");
  });

  it("redirects to /login?error=exchange_failed when the code exchange throws", async () => {
    googleMock.getToken.mockRejectedValueOnce(new Error("boom"));
    const { agent, state } = await startThenCallback();
    const res = await agent.get(`/api/auth/google/callback?code=bad&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=exchange_failed");
  });
});
