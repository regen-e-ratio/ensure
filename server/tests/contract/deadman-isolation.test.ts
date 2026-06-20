import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeTestApp, loginTestUser } from "../helpers/auth";

let app: Express;
let alice: string[];
let bob: string[];

beforeEach(async () => {
  ({ app } = makeTestApp());
  alice = await loginTestUser(app, { sub: "alice", email: "alice@example.com" });
  bob = await loginTestUser(app, { sub: "bob", email: "bob@example.com" });
});

const ARM = { checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true };

describe("dead-man switch cross-user isolation (FR-018)", () => {
  it("B's status never reflects A's state or events", async () => {
    await request(app).put("/api/deadman/config").set("Cookie", alice).send(ARM);
    await request(app).post("/api/deadman/checkin").set("Cookie", alice);

    const bobStatus = await request(app).get("/api/deadman").set("Cookie", bob);
    expect(bobStatus.body.state).toBe("disarmed");
    expect(bobStatus.body.events).toEqual([]);

    const aliceStatus = await request(app).get("/api/deadman").set("Cookie", alice);
    expect(aliceStatus.body.state).toBe("active");
    expect(aliceStatus.body.events.length).toBeGreaterThan(0);
  });

  it("B disarming never affects A's armed switch", async () => {
    await request(app).put("/api/deadman/config").set("Cookie", alice).send(ARM);
    await request(app)
      .put("/api/deadman/config")
      .set("Cookie", bob)
      .send({ ...ARM, enabled: false });

    const aliceStatus = await request(app).get("/api/deadman").set("Cookie", alice);
    expect(aliceStatus.body.state).toBe("active");
  });

  it("B's check-in does not reset A's deadline", async () => {
    await request(app).put("/api/deadman/config").set("Cookie", alice).send(ARM);
    await request(app).put("/api/deadman/config").set("Cookie", bob).send(ARM);

    const aliceBefore = await request(app).get("/api/deadman").set("Cookie", alice);
    await request(app).post("/api/deadman/checkin").set("Cookie", bob);
    const aliceAfter = await request(app).get("/api/deadman").set("Cookie", alice);

    expect(aliceAfter.body.nextCheckinDueAt).toBe(aliceBefore.body.nextCheckinDueAt);
  });
});
