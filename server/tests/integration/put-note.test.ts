import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { NOTE_MAX_LENGTH } from "@ensure/shared/constants";
import { createApp } from "../../src/app";
import { openDb, type Db } from "../../src/db/index";
import { getNote } from "../../src/db/note-repo";

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(":memory:");
  app = createApp(db);
});

describe("PUT /api/note", () => {
  it("saves text and returns the stored note", async () => {
    const res = await request(app).put("/api/note").send({ text: "Buy milk" });
    expect(res.status).toBe(200);
    expect(res.body.note.text).toBe("Buy milk");
    expect(typeof res.body.note.createdAt).toBe("string");
    expect(typeof res.body.note.updatedAt).toBe("string");
  });

  it("persists the note so it can be read back (SC-002)", async () => {
    await request(app).put("/api/note").send({ text: "Persisted text" });
    const stored = getNote(db);
    expect(stored?.text).toBe("Persisted text");
  });

  it("replaces the text in place on a second save, preserving createdAt (FR-006)", async () => {
    const first = await request(app).put("/api/note").send({ text: "v1" });
    const second = await request(app).put("/api/note").send({ text: "v2" });
    expect(second.body.note.text).toBe("v2");
    expect(second.body.note.createdAt).toBe(first.body.note.createdAt);
    // exactly one note row remains
    expect(getNote(db)?.text).toBe("v2");
  });

  it("rejects empty text with 400 (FR-004)", async () => {
    const res = await request(app).put("/api/note").send({ text: "" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
    expect(getNote(db)).toBeNull();
  });

  it("rejects whitespace-only text with 400 (FR-004)", async () => {
    const res = await request(app).put("/api/note").send({ text: "   " });
    expect(res.status).toBe(400);
    expect(getNote(db)).toBeNull();
  });

  it(`rejects text longer than ${NOTE_MAX_LENGTH} chars with 400 (FR-008)`, async () => {
    const res = await request(app)
      .put("/api/note")
      .send({ text: "a".repeat(NOTE_MAX_LENGTH + 1) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/10000/);
    expect(getNote(db)).toBeNull();
  });

  it("does not overwrite an existing note when a save is rejected", async () => {
    await request(app).put("/api/note").send({ text: "keep me" });
    await request(app).put("/api/note").send({ text: "   " });
    expect(getNote(db)?.text).toBe("keep me");
  });
});
