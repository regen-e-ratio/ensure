import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;

beforeEach(() => {
  ({ app } = makeTestApp());
});

describe("/api/note per-user contract (US1)", () => {
  it("a fresh user with no note → 200 { note: null } (FR-006)", async () => {
    const cookies = await loginTestUser(app, { sub: "fresh" });
    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ note: null });
  });

  it("two distinct-sub users round-trip their own text and never see the other's", async () => {
    const a = await loginTestUser(app, { sub: "user-a", email: "a@example.com" });
    const b = await loginTestUser(app, { sub: "user-b", email: "b@example.com" });

    const aPut = await request(app).put("/api/note").set("Cookie", a).send({ text: "alpha" });
    const bPut = await request(app).put("/api/note").set("Cookie", b).send({ text: "beta" });
    expect(aPut.body.note.text).toBe("alpha");
    expect(bPut.body.note.text).toBe("beta");

    expect((await request(app).get("/api/note").set("Cookie", a)).body.note.text).toBe("alpha");
    expect((await request(app).get("/api/note").set("Cookie", b)).body.note.text).toBe("beta");
  });
});
