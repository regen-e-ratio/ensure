import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp, loginTestUser } from "../helpers/auth";
import { REFRESH_COOKIE } from "../../src/auth/cookies";
import { upsertUser } from "../../src/db/user-repo";
import { createSession, SESSION_TTL_MS } from "../../src/db/session-repo";
import { generateRefreshToken, hashToken } from "../../src/auth/tokens";

function cookieValue(setCookies: string[], name: string): string | undefined {
  for (const c of setCookies) {
    const match = c.match(new RegExp(`^${name}=([^;]*)`));
    if (match && match[1]) return match[1];
  }
  return undefined;
}

describe("GET /api/auth/me", () => {
  it("returns the signed-in user", async () => {
    const { app } = makeTestApp();
    const cookies = await loginTestUser(app, { sub: "u9", email: "u9@example.com", name: "Nine" });
    const res = await request(app).get("/api/auth/me").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: "u9", email: "u9@example.com", name: "Nine" });
  });

  it("returns 401 without a session", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/auth/refresh", () => {
  it("rotates the refresh token and re-issues an access cookie", async () => {
    const { app } = makeTestApp();
    const cookies = await loginTestUser(app);
    const oldRefresh = cookieValue(cookies, REFRESH_COOKIE);

    const res = await request(app).post("/api/auth/refresh").set("Cookie", cookies);
    expect(res.status).toBe(204);

    const setCookies = res.headers["set-cookie"] as unknown as string[];
    const newAccess = cookieValue(setCookies, "access_token");
    const newRefresh = cookieValue(setCookies, REFRESH_COOKIE);
    expect(newAccess).toBeTruthy();
    expect(newRefresh).toBeTruthy();
    // The refresh token is rotated, not reused.
    expect(newRefresh).not.toBe(oldRefresh);

    // The old (now-rotated) refresh token must no longer work.
    const reuse = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `${REFRESH_COOKIE}=${oldRefresh}`);
    expect(reuse.status).toBe(401);
  });

  it("returns 401 with no refresh cookie", async () => {
    const { app } = makeTestApp();
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("returns 401 once the session has expired (≥24h inactivity)", async () => {
    const { app, db } = makeTestApp();
    upsertUser(db, { sub: "stale", email: "stale@example.com", name: null });
    const raw = generateRefreshToken();
    const longAgo = new Date(Date.now() - SESSION_TTL_MS - 60_000);
    createSession(db, { userId: "stale", tokenHash: hashToken(raw) }, longAgo);

    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `${REFRESH_COOKIE}=${raw}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });
});
