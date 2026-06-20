import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  DEADMAN_DEFAULT_INTERVAL_SECONDS,
  DEADMAN_DEFAULT_GRACE_SECONDS,
} from "@ensure/shared/constants";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;
let cookies: string[];

beforeEach(async () => {
  ({ app } = makeTestApp());
  cookies = await loginTestUser(app);
});

describe("GET /api/deadman contract (US1, US3)", () => {
  it("never-configured → 200 disarmed with defaults + null deadlines", async () => {
    const res = await request(app).get("/api/deadman").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("disarmed");
    expect(res.body.enabled).toBe(false);
    expect(res.body.checkinIntervalSeconds).toBe(DEADMAN_DEFAULT_INTERVAL_SECONDS);
    expect(res.body.gracePeriodSeconds).toBe(DEADMAN_DEFAULT_GRACE_SECONDS);
    expect(res.body.nextCheckinDueAt).toBeNull();
    expect(res.body.graceDeadlineAt).toBeNull();
    expect(res.body.secondsUntilDue).toBeNull();
    expect(res.body.events).toEqual([]);
  });

  it("armed → active with a positive secondsUntilDue", async () => {
    await request(app)
      .put("/api/deadman/config")
      .set("Cookie", cookies)
      .send({ checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true });

    const res = await request(app).get("/api/deadman").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("active");
    expect(res.body.secondsUntilDue).toBeGreaterThan(0);
    expect(res.body.nextCheckinDueAt).toBeTruthy();
  });

  it("includes an events array reflecting armed/checkin, newest-first (US3)", async () => {
    await request(app)
      .put("/api/deadman/config")
      .set("Cookie", cookies)
      .send({ checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true });
    await request(app).post("/api/deadman/checkin").set("Cookie", cookies);

    const res = await request(app).get("/api/deadman").set("Cookie", cookies);
    const types = res.body.events.map((e: { type: string }) => e.type);
    expect(types[0]).toBe("checkin"); // newest first
    expect(types).toContain("armed");
  });

  it("no cookie → 401", async () => {
    const res = await request(app).get("/api/deadman");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });
});
