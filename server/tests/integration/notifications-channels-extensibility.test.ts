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

describe("GET /api/notifications/channels extensibility (US3)", () => {
  it("lists WhatsApp and push as unavailable (cannot send) (FR-011)", async () => {
    const res = await request(app).get("/api/notifications/channels").set("Cookie", cookies);
    expect(res.status).toBe(200);
    const byType = Object.fromEntries(res.body.channels.map((c: { type: string; available: boolean }) => [c.type, c.available]));
    expect(byType).toMatchObject({ email: true, whatsapp: false, push: false });
  });
});
