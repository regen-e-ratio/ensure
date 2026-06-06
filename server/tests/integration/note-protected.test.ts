import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser, TEST_AUTH_CONFIG } from "../helpers/auth";
import { ACCESS_COOKIE } from "../../src/auth/cookies";
import { signAccessToken } from "../../src/auth/tokens";

let app: Express;

beforeEach(() => {
  ({ app } = makeTestApp());
});

describe("/api/note is guarded by requireAuth (US3)", () => {
  it("GET with no token → 401", async () => {
    const res = await request(app).get("/api/note");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("GET with an invalid token → 401", async () => {
    const res = await request(app).get("/api/note").set("Cookie", `${ACCESS_COOKIE}=garbage`);
    expect(res.status).toBe(401);
  });

  it("GET with an expired token → 401", async () => {
    const expired = await signAccessToken(
      { id: "u1", email: "u1@example.com" },
      TEST_AUTH_CONFIG.jwtSecret,
      -10,
    );
    const res = await request(app).get("/api/note").set("Cookie", `${ACCESS_COOKIE}=${expired}`);
    expect(res.status).toBe(401);
  });

  it("PUT with no token → 401 and does not mutate state", async () => {
    const res = await request(app).put("/api/note").send({ text: "should not save" });
    expect(res.status).toBe(401);
  });

  it("with a valid session, GET/PUT behave as before", async () => {
    const cookies = await loginTestUser(app);
    const put = await request(app).put("/api/note").set("Cookie", cookies).send({ text: "kept" });
    expect(put.status).toBe(200);
    expect(put.body.note.text).toBe("kept");

    const get = await request(app).get("/api/note").set("Cookie", cookies);
    expect(get.status).toBe(200);
    expect(get.body.note.text).toBe("kept");
  });
});
