import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { openDb, type Db } from "../../src/db/index";

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(":memory:");
  app = createApp(db);
});

function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && new Date(value).toISOString() === value;
}

describe("GET /api/note contract", () => {
  it("empty case matches NoteResponse with note: null", async () => {
    const res = await request(app).get("/api/note");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Object.keys(res.body)).toEqual(["note"]);
    expect(res.body.note).toBeNull();
  });

  it("populated case matches NoteResponse with a Note", async () => {
    await request(app).put("/api/note").send({ text: "x" });
    const res = await request(app).get("/api/note");
    expect(Object.keys(res.body)).toEqual(["note"]);
    expect(Object.keys(res.body.note).sort()).toEqual(["createdAt", "text", "updatedAt"]);
    expect(typeof res.body.note.text).toBe("string");
    expect(isIsoDate(res.body.note.createdAt)).toBe(true);
    expect(isIsoDate(res.body.note.updatedAt)).toBe(true);
  });
});
