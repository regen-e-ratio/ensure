import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";
import type { Db } from "../../src/db/index";

let app: Express;
let db: Db;
let cookies: string[];

beforeEach(async () => {
  ({ app, db } = makeTestApp());
  cookies = await loginTestUser(app);
});

function storedCiphertext(userId = "e2e-user"): Buffer {
  const row = db.prepare("SELECT ciphertext FROM note WHERE user_id = ?").get(userId) as {
    ciphertext: Buffer;
  };
  return row.ciphertext;
}

describe("note encryption at rest (US2)", () => {
  it("stores ciphertext, not the plaintext bytes (FR-008, SC-003)", async () => {
    const secret = "my very secret note content";
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: secret });

    const blob = storedCiphertext();
    expect(Buffer.isBuffer(blob)).toBe(true);
    expect(blob.includes(Buffer.from(secret, "utf8"))).toBe(false);
  });

  it("round-trips content losslessly through PUT then GET (FR-009, SC-004)", async () => {
    for (const text of ["plain", "unicode café ☕ 你好 🔐", "a".repeat(10_000)]) {
      await request(app).put("/api/note").set("Cookie", cookies).send({ text });
      const res = await request(app).get("/api/note").set("Cookie", cookies);
      expect(res.body.note.text).toBe(text);
    }
  });

  it("re-encrypts with a fresh nonce each save (same text → different ciphertext)", async () => {
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "same" });
    const first = Buffer.from(storedCiphertext());
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "same" });
    const second = storedCiphertext();
    expect(first.equals(second)).toBe(false);
  });
});
