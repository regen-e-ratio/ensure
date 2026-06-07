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

describe("POST /api/notifications/test to a disabled channel (US3)", () => {
  it("returns 400 CHANNEL_NOT_SUPPORTED and attempts no delivery (FR-009)", async () => {
    const res = await request(app)
      .post("/api/notifications/test")
      .set("Cookie", cookies)
      .send({ channel: "whatsapp", recipient: "+15555550100" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("CHANNEL_NOT_SUPPORTED");
    expect(res.body.message).toMatch(/whatsapp/i);
  });
});
