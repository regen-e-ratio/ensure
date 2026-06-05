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

// Asserts PUT /api/note responses conform to contracts/openapi.yaml
// (NoteResponse with a Note of exactly {text, createdAt, updatedAt}, and Error of {error, message}).
function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && new Date(value).toISOString() === value;
}

describe("PUT /api/note contract", () => {
  it("success response matches the NoteResponse schema", async () => {
    const res = await request(app).put("/api/note").send({ text: "hello" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Object.keys(res.body)).toEqual(["note"]);

    const note = res.body.note;
    expect(Object.keys(note).sort()).toEqual(["createdAt", "text", "updatedAt"]);
    expect(typeof note.text).toBe("string");
    expect(isIsoDate(note.createdAt)).toBe(true);
    expect(isIsoDate(note.updatedAt)).toBe(true);
  });

  it("validation failure matches the Error schema", async () => {
    const res = await request(app).put("/api/note").send({ text: "" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
    expect(typeof res.body.error).toBe("string");
    expect(typeof res.body.message).toBe("string");
  });
});
