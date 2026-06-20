import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Db } from "../../src/db/index";
import { runDeadmanTick, type Deps } from "../../src/deadman/engine";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;
let db: Db;
let cookies: string[];

beforeEach(async () => {
  ({ app, db } = makeTestApp());
  cookies = await loginTestUser(app);
});

const VALID = { checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true };

/** A no-network deps for driving the engine in-test (FR-015: timer stays off in tests). */
function testDeps(now: Date): Deps {
  return {
    now: () => now,
    userEmailFor: () => "e2e@example.com",
    notify: async () => {},
  };
}

describe("POST /api/deadman/checkin contract (US1, US2)", () => {
  it("on an active switch → 200 with the deadline reset (US1)", async () => {
    await request(app).put("/api/deadman/config").set("Cookie", cookies).send(VALID);
    const res = await request(app).post("/api/deadman/checkin").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("active");
    expect(res.body.secondsUntilDue).toBeGreaterThan(0);
    expect(res.body.events[0].type).toBe("checkin");
  });

  it("rejects a check-in on a never-configured/disarmed switch → 409 NOT_ARMED", async () => {
    const res = await request(app).post("/api/deadman/checkin").set("Cookie", cookies);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("NOT_ARMED");
  });

  it("fast-forward → tick → GET reports grace; checkin during grace returns to active (US2)", async () => {
    await request(app).put("/api/deadman/config").set("Cookie", cookies).send(VALID);
    // Force the deadline into the past via the test seam, then run one tick in-test.
    await request(app).post("/api/test/deadman").set("Cookie", cookies);
    await runDeadmanTick(db, testDeps(new Date()), new Date());

    const grace = await request(app).get("/api/deadman").set("Cookie", cookies);
    expect(grace.body.state).toBe("grace");
    expect(grace.body.graceDeadlineAt).toBeTruthy();

    // A check-in during grace returns the switch to active.
    const res = await request(app).post("/api/deadman/checkin").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("active");
    expect(res.body.graceDeadlineAt).toBeNull();
  });

  it("rejects a check-in on a triggered switch → 409 ALREADY_TRIGGERED", async () => {
    await request(app).put("/api/deadman/config").set("Cookie", cookies).send(VALID);
    // Fast-forward + two ticks (grace, then trigger).
    await request(app).post("/api/test/deadman").set("Cookie", cookies);
    await runDeadmanTick(db, testDeps(new Date()), new Date());
    // Fast-forward the grace deadline into the past too, then tick → triggered.
    await request(app).post("/api/test/deadman").set("Cookie", cookies);
    await runDeadmanTick(db, testDeps(new Date()), new Date());

    const status = await request(app).get("/api/deadman").set("Cookie", cookies);
    expect(status.body.state).toBe("triggered");

    const res = await request(app).post("/api/deadman/checkin").set("Cookie", cookies);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ALREADY_TRIGGERED");
  });

  it("no cookie → 401", async () => {
    const res = await request(app).post("/api/deadman/checkin");
    expect(res.status).toBe(401);
  });
});
