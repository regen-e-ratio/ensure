import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";

// Asserts the now-protected /note conforms to contracts/openapi.yaml:
//   - no token → 401 with Error { error: "UNAUTHORIZED", message }
//   - valid token → 200 (unchanged NoteResponse body shape)

let app: Express;

beforeEach(() => {
  ({ app } = makeTestApp());
});

describe("/api/note auth contract", () => {
  it("GET without a token → 401 Error shape", async () => {
    const res = await request(app).get("/api/note");
    expect(res.status).toBe(401);
    expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("PUT without a token → 401 Error shape", async () => {
    const res = await request(app).put("/api/note").send({ text: "x" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  it("GET with a valid token → 200 NoteResponse", async () => {
    const cookies = await loginTestUser(app);
    const res = await request(app).get("/api/note").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["note"]);
  });

  it("PUT with a valid token → 200 NoteResponse", async () => {
    const cookies = await loginTestUser(app);
    const res = await request(app).put("/api/note").set("Cookie", cookies).send({ text: "hi" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["note"]);
    expect(res.body.note.text).toBe("hi");
  });
});
