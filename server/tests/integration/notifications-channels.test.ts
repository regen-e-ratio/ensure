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

describe("GET /api/notifications/channels", () => {
  it("requires a valid session (401)", async () => {
    const res = await request(app).get("/api/notifications/channels");
    expect(res.status).toBe(401);
  });

  it("lists Email as available with its four fields (FR-011, FR-012)", async () => {
    const res = await request(app).get("/api/notifications/channels").set("Cookie", cookies);
    expect(res.status).toBe(200);
    const email = res.body.channels.find((c: { type: string }) => c.type === "email");
    expect(email).toBeTruthy();
    expect(email.available).toBe(true);
    expect(email.fields.map((f: { name: string }) => f.name)).toEqual(["recipient", "subject", "body", "bodyFormat"]);
    const format = email.fields.find((f: { name: string }) => f.name === "bodyFormat");
    expect(format.options).toEqual(["text", "html"]);
  });
});
