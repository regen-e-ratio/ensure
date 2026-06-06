import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;
let cookies: string[];

beforeEach(async () => {
  ({ app } = makeTestApp());
  cookies = await loginTestUser(app);
});

describe("GET /api/note", () => {
  it("requires a valid session (401 without one)", async () => {
    const res = await request(app).get("/api/note");
    expect(res.status).toBe(401);
  });

  it("returns { note: null } when no note has been saved (FR-005)", async () => {
    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ note: null });
  });

  it("returns the saved note with createdAt/updatedAt (FR-006, FR-007)", async () => {
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "Hello there" });
    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.note.text).toBe("Hello there");
    expect(typeof res.body.note.createdAt).toBe("string");
    expect(typeof res.body.note.updatedAt).toBe("string");
  });

  it("reflects the latest text after an update", async () => {
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "first" });
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "second" });
    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(res.body.note.text).toBe("second");
  });
});
