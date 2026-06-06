import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp, loginTestUser } from "../helpers/auth";

// Asserts /auth/me, /auth/refresh, and the 401 Error shape conform to contracts/openapi.yaml:
//   - GET /auth/me 200 → { user: User } where User = { id, email, name? }
//   - GET /auth/me 401 → Error { error, message }
//   - POST /auth/refresh 204 → no body
//   - POST /auth/refresh 401 → Error { error, message }

describe("auth contract", () => {
  it("GET /auth/me 200 matches { user: User }", async () => {
    const { app } = makeTestApp();
    const cookies = await loginTestUser(app, { sub: "c1", email: "c1@example.com", name: "Cee" });
    const res = await request(app).get("/api/auth/me").set("Cookie", cookies);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Object.keys(res.body)).toEqual(["user"]);
    const keys = Object.keys(res.body.user).sort();
    expect(keys).toEqual(["email", "id", "name"]);
    expect(typeof res.body.user.id).toBe("string");
    expect(typeof res.body.user.email).toBe("string");
  });

  it("GET /auth/me 401 matches the Error schema", async () => {
    const { app } = makeTestApp();
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
    expect(res.body.error).toBe("UNAUTHORIZED");
    expect(typeof res.body.message).toBe("string");
  });

  it("POST /auth/refresh 204 has no body; 401 matches the Error schema", async () => {
    const { app } = makeTestApp();
    const cookies = await loginTestUser(app);

    const ok = await request(app).post("/api/auth/refresh").set("Cookie", cookies);
    expect(ok.status).toBe(204);
    expect(ok.body).toEqual({});

    const unauth = await request(app).post("/api/auth/refresh");
    expect(unauth.status).toBe(401);
    expect(Object.keys(unauth.body).sort()).toEqual(["error", "message"]);
  });
});
