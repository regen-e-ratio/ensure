import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp, loginTestUser } from "../helpers/auth";
import { REFRESH_COOKIE } from "../../src/auth/cookies";

function cookieValue(setCookies: string[], name: string): string | undefined {
  for (const c of setCookies) {
    const match = c.match(new RegExp(`^${name}=([^;]*)`));
    if (match && match[1]) return match[1];
  }
  return undefined;
}

describe("POST /api/auth/logout", () => {
  it("deletes the session, clears both cookies, and is idempotent (204)", async () => {
    const { app } = makeTestApp();
    const cookies = await loginTestUser(app);
    const refresh = cookieValue(cookies, REFRESH_COOKIE);

    const res = await request(app).post("/api/auth/logout").set("Cookie", cookies);
    expect(res.status).toBe(204);

    // Both auth cookies are cleared (expired) in the response.
    const cleared = res.headers["set-cookie"] as unknown as string[];
    expect(cleared.some((c) => /^access_token=;/.test(c) || /access_token=;/.test(c))).toBe(true);
    expect(cleared.some((c) => c.startsWith(`${REFRESH_COOKIE}=;`))).toBe(true);

    // The server-side session is gone: the old refresh token no longer works.
    const reuse = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `${REFRESH_COOKIE}=${refresh}`);
    expect(reuse.status).toBe(401);

    // Idempotent: logging out again still returns 204.
    const again = await request(app).post("/api/auth/logout");
    expect(again.status).toBe(204);
  });

  it("after logout, a protected request without the (cleared) token is 401", async () => {
    const { app } = makeTestApp();
    const agent = request.agent(app);
    await agent.post("/api/test/login").send({});
    await agent.post("/api/auth/logout");

    const res = await agent.get("/api/note");
    expect(res.status).toBe(401);
  });
});
