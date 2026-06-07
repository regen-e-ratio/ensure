import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;

beforeEach(() => {
  ({ app } = makeTestApp());
});

describe("/api/contact per-user isolation (FR-003)", () => {
  it("user B never sees user A's contacts and cannot delete them", async () => {
    const a = await loginTestUser(app, { sub: "user-a", email: "a@example.com" });
    const b = await loginTestUser(app, { sub: "user-b", email: "b@example.com" });

    const aAdd = await request(app)
      .post("/api/contact")
      .set("Cookie", a)
      .send({ type: "email", value: "alice@example.com" });
    expect(aAdd.status).toBe(201);
    const aId = aAdd.body.id as string;

    // B's list is independent (empty), never showing A's contact.
    const bList = await request(app).get("/api/contact").set("Cookie", b);
    expect(bList.body.contacts).toEqual([]);

    // B deleting A's id is a 204 no-op; A still has the contact.
    const bDelete = await request(app).delete(`/api/contact/${aId}`).set("Cookie", b);
    expect(bDelete.status).toBe(204);

    const aList = await request(app).get("/api/contact").set("Cookie", a);
    expect(aList.body.contacts.map((c: { value: string }) => c.value)).toEqual([
      "alice@example.com",
    ]);
  });

  it("the same email can exist independently for two different users", async () => {
    const a = await loginTestUser(app, { sub: "user-a", email: "a@example.com" });
    const b = await loginTestUser(app, { sub: "user-b", email: "b@example.com" });

    const aAdd = await request(app)
      .post("/api/contact")
      .set("Cookie", a)
      .send({ type: "email", value: "shared@example.com" });
    const bAdd = await request(app)
      .post("/api/contact")
      .set("Cookie", b)
      .send({ type: "email", value: "shared@example.com" });
    expect(aAdd.status).toBe(201);
    expect(bAdd.status).toBe(201);
  });
});
