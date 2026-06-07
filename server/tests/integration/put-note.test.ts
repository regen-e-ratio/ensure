import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { NOTE_MAX_LENGTH } from "@ensure/shared/constants";
import { makeTestApp, loginTestUser, TEST_ENCRYPTION_KEYRING } from "../helpers/auth";
import { getNote } from "../../src/db/note-repo";
import type { Db } from "../../src/db/index";

let app: Express;
let db: Db;
let cookies: string[];

// The test-login seam defaults to this Google `sub` (see createTestLoginHandler).
const readNote = () => getNote(db, "e2e-user", TEST_ENCRYPTION_KEYRING);

beforeEach(async () => {
  ({ app, db } = makeTestApp());
  cookies = await loginTestUser(app);
});

describe("PUT /api/note", () => {
  it("requires a valid session (401 without one)", async () => {
    const res = await request(app).put("/api/note").send({ text: "no session" });
    expect(res.status).toBe(401);
    expect(readNote()).toBeNull();
  });

  it("saves text and returns the stored note", async () => {
    const res = await request(app)
      .put("/api/note")
      .set("Cookie", cookies)
      .send({ text: "Buy milk" });
    expect(res.status).toBe(200);
    expect(res.body.note.text).toBe("Buy milk");
    expect(typeof res.body.note.createdAt).toBe("string");
    expect(typeof res.body.note.updatedAt).toBe("string");
  });

  it("persists the note so it can be read back (SC-002)", async () => {
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "Persisted text" });
    const stored = readNote();
    expect(stored?.text).toBe("Persisted text");
  });

  it("replaces the text in place on a second save, preserving createdAt (FR-006)", async () => {
    const first = await request(app).put("/api/note").set("Cookie", cookies).send({ text: "v1" });
    const second = await request(app).put("/api/note").set("Cookie", cookies).send({ text: "v2" });
    expect(second.body.note.text).toBe("v2");
    expect(second.body.note.createdAt).toBe(first.body.note.createdAt);
    expect(readNote()?.text).toBe("v2");
  });

  it("rejects empty text with 400 (FR-004)", async () => {
    const res = await request(app).put("/api/note").set("Cookie", cookies).send({ text: "" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
    expect(readNote()).toBeNull();
  });

  it("rejects whitespace-only text with 400 (FR-004)", async () => {
    const res = await request(app).put("/api/note").set("Cookie", cookies).send({ text: "   " });
    expect(res.status).toBe(400);
    expect(readNote()).toBeNull();
  });

  it(`rejects text longer than ${NOTE_MAX_LENGTH} chars with 400 (FR-008)`, async () => {
    const res = await request(app)
      .put("/api/note")
      .set("Cookie", cookies)
      .send({ text: "a".repeat(NOTE_MAX_LENGTH + 1) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/10000/);
    expect(readNote()).toBeNull();
  });

  it("does not overwrite an existing note when a save is rejected", async () => {
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "keep me" });
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "   " });
    expect(readNote()?.text).toBe("keep me");
  });
});
