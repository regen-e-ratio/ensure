import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";
import { StubEmailProvider } from "../../src/notifications/channels/email/stub-provider";

let app: Express;
let cookies: string[];

const validBody = {
  channel: "email",
  recipient: "person@example.com",
  subject: "Test notification",
  body: "Hello from the notification system.",
  bodyFormat: "text",
};

beforeEach(async () => {
  ({ app } = makeTestApp());
  cookies = await loginTestUser(app);
});

describe("POST /api/notifications/test", () => {
  it("requires a valid session (401)", async () => {
    const res = await request(app).post("/api/notifications/test").send(validBody);
    expect(res.status).toBe(401);
  });

  it("sends a valid Email and returns a sent outcome (200)", async () => {
    const res = await request(app).post("/api/notifications/test").set("Cookie", cookies).send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toMatchObject({ status: "sent", channel: "email" });
    expect(typeof res.body.outcome.providerMessageId).toBe("string");
  });

  it("rejects a malformed recipient with 400 and attempts no delivery (FR-006)", async () => {
    const res = await request(app)
      .post("/api/notifications/test")
      .set("Cookie", cookies)
      .send({ ...validBody, recipient: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.message).toMatch(/valid email/i);
  });

  it("rejects an empty body with 400 (FR-006)", async () => {
    const res = await request(app)
      .post("/api/notifications/test")
      .set("Cookie", cookies)
      .send({ ...validBody, body: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("reports a provider failure as a 200 failed outcome (FR-007, FR-008)", async () => {
    ({ app } = makeTestApp({ emailProvider: new StubEmailProvider({ accept: false, reason: "rejected by provider" }) }));
    cookies = await loginTestUser(app);
    const res = await request(app).post("/api/notifications/test").set("Cookie", cookies).send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.outcome).toMatchObject({ status: "failed", channel: "email", reason: "rejected by provider" });
  });
});
