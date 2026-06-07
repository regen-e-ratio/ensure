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
  await request(app).put("/api/note").set("Cookie", cookies).send({ text: "top secret" });
});

describe("fail-closed reads (US2, FR-015, SC-007)", () => {
  it("a row whose key_version is absent from the keyring → 500 NOTE_DECRYPT_FAILED, no plaintext", async () => {
    db.prepare("UPDATE note SET key_version = 999 WHERE user_id = ?").run("e2e-user");

    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("NOTE_DECRYPT_FAILED");
    expect(JSON.stringify(res.body)).not.toContain("top secret");
  });

  it("a tampered ciphertext (auth-tag failure) → 500 NOTE_DECRYPT_FAILED, no plaintext", async () => {
    const row = db.prepare("SELECT ciphertext FROM note WHERE user_id = ?").get("e2e-user") as {
      ciphertext: Buffer;
    };
    const tampered = Buffer.from(row.ciphertext);
    const last = tampered.length - 1;
    tampered.writeUInt8(tampered.readUInt8(last) ^ 0xff, last); // flip a GCM tag byte
    db.prepare("UPDATE note SET ciphertext = ? WHERE user_id = ?").run(tampered, "e2e-user");

    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("NOTE_DECRYPT_FAILED");
    expect(JSON.stringify(res.body)).not.toContain("top secret");
  });
});
