import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";
import type { Db } from "../../src/db/index";

let app: Express;
let db: Db;

beforeEach(() => {
  ({ app, db } = makeTestApp());
});

describe("GET /api/note fail-closed contract (US2)", () => {
  it("an undecryptable note → 500 with the { error, message } envelope and no content", async () => {
    const cookies = await loginTestUser(app);
    await request(app).put("/api/note").set("Cookie", cookies).send({ text: "classified" });
    db.prepare("UPDATE note SET key_version = 42 WHERE user_id = ?").run("e2e-user");

    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
    expect(res.body.error).toBe("NOTE_DECRYPT_FAILED");
    expect(typeof res.body.message).toBe("string");
    expect(JSON.stringify(res.body)).not.toContain("classified");
  });
});
