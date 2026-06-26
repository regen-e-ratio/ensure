import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;
let cookies: string[];

beforeEach(async () => {
  ({ app } = makeTestApp());
  cookies = await loginTestUser(app);
});

function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && new Date(value).toISOString() === value;
}

describe("GET /api/contact contract (US1)", () => {
  it("empty case matches ContactListResponse with an empty array", async () => {
    const res = await request(app).get("/api/contact").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Object.keys(res.body)).toEqual(["contacts"]);
    expect(res.body.contacts).toEqual([]);
  });

  it("populated case returns Contact objects with exactly the contract keys", async () => {
    await request(app)
      .post("/api/contact")
      .set("Cookie", cookies)
      .send({ type: "email", value: "alice@example.com" });

    const res = await request(app).get("/api/contact").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(1);
    const [contact] = res.body.contacts;
    expect(Object.keys(contact).sort()).toEqual([
      "createdAt",
      "id",
      "type",
      "value",
    ]);
    expect(contact.type).toBe("email");
    expect(typeof contact.id).toBe("string");
    expect(contact.value).toBe("alice@example.com");
    expect(isIsoDate(contact.createdAt)).toBe(true);
  });

  it("rejects an unauthenticated request with 401 (FR-012)", async () => {
    const res = await request(app).get("/api/contact");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });
});
