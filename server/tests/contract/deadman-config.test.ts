import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  CHECKIN_INTERVAL_MIN_SECONDS,
  CHECKIN_INTERVAL_MAX_SECONDS,
  GRACE_PERIOD_MAX_SECONDS,
} from "@ensure/shared/constants";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;
let cookies: string[];

beforeEach(async () => {
  ({ app } = makeTestApp());
  cookies = await loginTestUser(app);
});

const VALID = { checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true };

describe("PUT /api/deadman/config contract (US1, US4)", () => {
  it("valid + enabled:true → 200 active with nextCheckinDueAt set", async () => {
    const res = await request(app).put("/api/deadman/config").set("Cookie", cookies).send(VALID);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("active");
    expect(res.body.enabled).toBe(true);
    expect(res.body.nextCheckinDueAt).toBeTruthy();
    expect(res.body.events.some((e: { type: string }) => e.type === "armed")).toBe(true);
  });

  it("enabled:false → 200 disarmed with null deadlines + a disarmed event (US4)", async () => {
    await request(app).put("/api/deadman/config").set("Cookie", cookies).send(VALID);
    const res = await request(app)
      .put("/api/deadman/config")
      .set("Cookie", cookies)
      .send({ ...VALID, enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("disarmed");
    expect(res.body.nextCheckinDueAt).toBeNull();
    expect(res.body.graceDeadlineAt).toBeNull();
    expect(res.body.events.some((e: { type: string }) => e.type === "disarmed")).toBe(true);
  });

  it("re-enable after disarm → active with a fresh nextCheckinDueAt (US4)", async () => {
    await request(app).put("/api/deadman/config").set("Cookie", cookies).send(VALID);
    await request(app)
      .put("/api/deadman/config")
      .set("Cookie", cookies)
      .send({ ...VALID, enabled: false });
    const res = await request(app).put("/api/deadman/config").set("Cookie", cookies).send(VALID);
    expect(res.body.state).toBe("active");
    expect(res.body.nextCheckinDueAt).toBeTruthy();
  });

  it("interval below min → 400 VALIDATION_ERROR, no change", async () => {
    const res = await request(app)
      .put("/api/deadman/config")
      .set("Cookie", cookies)
      .send({ ...VALID, checkinIntervalSeconds: CHECKIN_INTERVAL_MIN_SECONDS - 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    // still never-configured
    const status = await request(app).get("/api/deadman").set("Cookie", cookies);
    expect(status.body.state).toBe("disarmed");
  });

  it("interval above max → 400", async () => {
    const res = await request(app)
      .put("/api/deadman/config")
      .set("Cookie", cookies)
      .send({ ...VALID, checkinIntervalSeconds: CHECKIN_INTERVAL_MAX_SECONDS + 1 });
    expect(res.status).toBe(400);
  });

  it("grace above max → 400", async () => {
    const res = await request(app)
      .put("/api/deadman/config")
      .set("Cookie", cookies)
      .send({ ...VALID, gracePeriodSeconds: GRACE_PERIOD_MAX_SECONDS + 1 });
    expect(res.status).toBe(400);
  });

  it("no cookie → 401", async () => {
    const res = await request(app).put("/api/deadman/config").send(VALID);
    expect(res.status).toBe(401);
  });
});
