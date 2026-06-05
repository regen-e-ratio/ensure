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

describe("GET /api/note", () => {
  it("returns { note: null } when no note has been saved (FR-005)", async () => {
    const res = await request(app).get("/api/note");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ note: null });
  });

  it("returns the saved note with createdAt/updatedAt (FR-006, FR-007)", async () => {
    await request(app).put("/api/note").send({ text: "Hello there" });
    const res = await request(app).get("/api/note");
    expect(res.status).toBe(200);
    expect(res.body.note.text).toBe("Hello there");
    expect(typeof res.body.note.createdAt).toBe("string");
    expect(typeof res.body.note.updatedAt).toBe("string");
  });

  it("reflects the latest text after an update", async () => {
    await request(app).put("/api/note").send({ text: "first" });
    await request(app).put("/api/note").send({ text: "second" });
    const res = await request(app).get("/api/note");
    expect(res.body.note.text).toBe("second");
  });
});
