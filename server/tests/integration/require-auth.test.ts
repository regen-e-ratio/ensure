import { describe, it, expect } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { createRequireAuth } from "../../src/auth/require-auth";
import { ACCESS_COOKIE } from "../../src/auth/cookies";
import { signAccessToken } from "../../src/auth/tokens";

const SECRET = "require-auth-secret-0123456789-abc";

function appWithGuard() {
  const app = express();
  app.use(cookieParser());
  app.use(createRequireAuth(SECRET));
  app.get("/ping", (req, res) => res.status(200).json({ user: req.user }));
  return app;
}

async function validCookie(): Promise<string> {
  const token = await signAccessToken({ id: "u1", email: "u1@example.com", name: "U" }, SECRET);
  return `${ACCESS_COOKIE}=${token}`;
}

describe("requireAuth middleware", () => {
  it("rejects a request with no token (401 UNAUTHORIZED)", async () => {
    const res = await request(appWithGuard()).get("/ping");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("rejects an invalid token", async () => {
    const res = await request(appWithGuard())
      .get("/ping")
      .set("Cookie", `${ACCESS_COOKIE}=not-a-real-token`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("rejects an expired token", async () => {
    const expired = await signAccessToken({ id: "u1", email: "u1@example.com" }, SECRET, -5);
    const res = await request(appWithGuard())
      .get("/ping")
      .set("Cookie", `${ACCESS_COOKIE}=${expired}`);
    expect(res.status).toBe(401);
  });

  it("passes a valid token and attaches req.user", async () => {
    const res = await request(appWithGuard())
      .get("/ping")
      .set("Cookie", await validCookie());
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: "u1", email: "u1@example.com", name: "U" });
  });
});
