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

function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && new Date(value).toISOString() === value;
}

describe("GET /api/note contract", () => {
  it("empty case matches NoteResponse with note: null", async () => {
    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Object.keys(res.body)).toEqual(["note"]);
    expect(res.body.note).toBeNull();
  });

  it("populated case matches NoteResponse with a Note", async () => {
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "x" });
    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(Object.keys(res.body)).toEqual(["note"]);
    expect(Object.keys(res.body.note).sort()).toEqual(["createdAt", "text", "updatedAt"]);
    expect(typeof res.body.note.text).toBe("string");
    expect(isIsoDate(res.body.note.createdAt)).toBe(true);
    expect(isIsoDate(res.body.note.updatedAt)).toBe(true);
  });
});
