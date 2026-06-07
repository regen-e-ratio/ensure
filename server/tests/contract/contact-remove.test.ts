import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;
let cookies: string[];

async function addContact(value: string): Promise<string> {
  const res = await request(app)
    .post("/api/contact")
    .set("Cookie", cookies)
    .send({ type: "email", value });
  return res.body.id as string;
}

beforeEach(async () => {
  ({ app } = makeTestApp());
  cookies = await loginTestUser(app);
});

describe("DELETE /api/contact/:id contract (US3)", () => {
  it("removes an existing contact → 204 and it is gone from the list", async () => {
    const id = await addContact("alice@example.com");
    const res = await request(app).delete(`/api/contact/${id}`).set("Cookie", cookies);
    expect(res.status).toBe(204);
    const list = await request(app).get("/api/contact").set("Cookie", cookies);
    expect(list.body.contacts).toEqual([]);
  });

  it("is idempotent: deleting again → 204 (US3 #3)", async () => {
    const id = await addContact("alice@example.com");
    await request(app).delete(`/api/contact/${id}`).set("Cookie", cookies);
    const again = await request(app).delete(`/api/contact/${id}`).set("Cookie", cookies);
    expect(again.status).toBe(204);
  });

  it("returns 204 for a never-existed id", async () => {
    const res = await request(app).delete("/api/contact/nope").set("Cookie", cookies);
    expect(res.status).toBe(204);
  });

  it("rejects an unauthenticated request with 401 (FR-012)", async () => {
    const id = await addContact("alice@example.com");
    const res = await request(app).delete(`/api/contact/${id}`);
    expect(res.status).toBe(401);
  });
});
