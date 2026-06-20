import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Db } from "../../src/db/index";
import { createApp } from "../../src/app";
import { openDb } from "../../src/db/index";
import { upsertConfig, setState, getConfig } from "../../src/deadman/config-repo";
import { createCheckinToken } from "../../src/db/checkin-token-repo";
import { listEvents } from "../../src/deadman/event-repo";
import { mintToken, hashToken } from "../../src/deadman/tokens";
import { TEST_AUTH_CONFIG, TEST_ENCRYPTION_KEYRING } from "../helpers/auth";

process.env.DEADMAN_TICK_DISABLED = "1";

function seedUser(db: Db, id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO user (id, email, name, created_at, last_login_at) VALUES (?,?,?,?,?)",
  ).run(id, `${id}@example.com`, null, "2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z");
}

const NOW = "2026-06-20T00:00:00.000Z";
const FUTURE = "2030-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
const ARM = { checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800, enabled: true };

/** Arm `userId` and move the switch into `grace`. */
function armInGrace(db: Db, userId: string): void {
  seedUser(db, userId);
  upsertConfig(db, userId, ARM, NOW);
  setState(db, userId, "grace", { graceDeadlineAt: FUTURE, remindersSent: 1 }, NOW);
}

/** Mint a check-in token for `userId` and return the raw token. */
function makeToken(db: Db, userId: string, expiresAt: string): string {
  const token = mintToken();
  createCheckinToken(db, userId, hashToken(token), expiresAt, NOW);
  return token;
}

describe("GET /api/deadman/checkin contract (feature 011, public)", () => {
  let app: Express;
  let db: Db;

  beforeEach(() => {
    db = openDb(":memory:");
    app = createApp(db, {
      auth: TEST_AUTH_CONFIG,
      encryption: TEST_ENCRYPTION_KEYRING,
      appBaseUrl: "https://app.example.test",
      enableTestReset: true,
      enableDeadmanTestMode: true,
    });
  });

  it("a valid, unused, unexpired token on a grace switch → checked_in, clock reset, token used", async () => {
    armInGrace(db, "owner");
    const token = makeToken(db, "owner", FUTURE);

    const res = await request(app).get(`/api/deadman/checkin?token=${token}`); // no session
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "checked_in" });

    const config = getConfig(db, "owner")!;
    expect(config.state).toBe("active");
    expect(config.graceDeadlineAt).toBeNull();
    expect(config.remindersSent).toBe(0);
    expect(config.nextCheckinDueAt).not.toBeNull();

    const used = db.prepare("SELECT used_at FROM checkin_token").get() as { used_at: string | null };
    expect(used.used_at).not.toBeNull();

    const events = listEvents(db, "owner");
    expect(events.some((e) => e.type === "checkin")).toBe(true);
  });

  it("the checkin event detail carries only the new nextCheckinDueAt, never a token", async () => {
    armInGrace(db, "owner");
    const token = makeToken(db, "owner", FUTURE);
    await request(app).get(`/api/deadman/checkin?token=${token}`);

    const event = listEvents(db, "owner").find((e) => e.type === "checkin")!;
    expect(event.detail).not.toBeNull();
    expect(event.detail).not.toContain(token);
    expect(JSON.parse(event.detail!)).toHaveProperty("nextCheckinDueAt");
  });

  it("opening a reminder link early (active switch) still checks in", async () => {
    seedUser(db, "owner");
    upsertConfig(db, "owner", ARM, NOW); // armed, active
    const token = makeToken(db, "owner", FUTURE);

    const res = await request(app).get(`/api/deadman/checkin?token=${token}`);
    expect(res.body).toEqual({ status: "checked_in" });
    expect(getConfig(db, "owner")!.state).toBe("active");
  });

  it("a second open of the same token → not_available, no second reset, no extra event", async () => {
    armInGrace(db, "owner");
    const token = makeToken(db, "owner", FUTURE);
    await request(app).get(`/api/deadman/checkin?token=${token}`);
    const before = getConfig(db, "owner")!.nextCheckinDueAt;

    const res = await request(app).get(`/api/deadman/checkin?token=${token}`);
    expect(res.body).toEqual({ status: "not_available" });
    expect(getConfig(db, "owner")!.nextCheckinDueAt).toBe(before);
    const checkins = listEvents(db, "owner").filter((e) => e.type === "checkin");
    expect(checkins).toHaveLength(1);
  });

  it("an expired token → not_available, used_at stays null, clock not reset", async () => {
    armInGrace(db, "owner");
    const before = getConfig(db, "owner")!;
    const token = makeToken(db, "owner", PAST);

    const res = await request(app).get(`/api/deadman/checkin?token=${token}`);
    expect(res.body).toEqual({ status: "not_available" });

    const used = db.prepare("SELECT used_at FROM checkin_token").get() as { used_at: string | null };
    expect(used.used_at).toBeNull();
    expect(getConfig(db, "owner")!.nextCheckinDueAt).toBe(before.nextCheckinDueAt);
    expect(getConfig(db, "owner")!.state).toBe("grace");
  });

  it("an unknown token → not_available, discloses nothing", async () => {
    const res = await request(app).get(`/api/deadman/checkin?token=${mintToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "not_available" });
  });

  it("a malformed token → not_available", async () => {
    const res = await request(app).get(`/api/deadman/checkin?token=${encodeURIComponent("not a token!")}`);
    expect(res.body).toEqual({ status: "not_available" });
  });

  it("a missing token → not_available", async () => {
    const res = await request(app).get(`/api/deadman/checkin`);
    expect(res.body).toEqual({ status: "not_available" });
  });

  it("a valid token whose switch is triggered → not_available, but token IS consumed (replay-proof)", async () => {
    seedUser(db, "owner");
    upsertConfig(db, "owner", ARM, NOW);
    setState(db, "owner", "triggered", { graceDeadlineAt: FUTURE }, NOW);
    const token = makeToken(db, "owner", FUTURE);

    const res = await request(app).get(`/api/deadman/checkin?token=${token}`);
    expect(res.body).toEqual({ status: "not_available" });
    expect(getConfig(db, "owner")!.state).toBe("triggered");
    // Still consumed so it cannot be replayed once the switch is checkable again.
    const used = db.prepare("SELECT used_at FROM checkin_token").get() as { used_at: string | null };
    expect(used.used_at).not.toBeNull();
    expect(listEvents(db, "owner").some((e) => e.type === "checkin")).toBe(false);
  });

  it("a valid token whose switch is disarmed → not_available, token consumed, no checkin event", async () => {
    seedUser(db, "owner");
    upsertConfig(db, "owner", { ...ARM, enabled: false }, NOW); // disarmed
    const token = makeToken(db, "owner", FUTURE);

    const res = await request(app).get(`/api/deadman/checkin?token=${token}`);
    expect(res.body).toEqual({ status: "not_available" });
    const used = db.prepare("SELECT used_at FROM checkin_token").get() as { used_at: string | null };
    expect(used.used_at).not.toBeNull();
    expect(listEvents(db, "owner").some((e) => e.type === "checkin")).toBe(false);
  });

  it("never echoes the raw token in the response (SC-005)", async () => {
    armInGrace(db, "owner");
    const token = makeToken(db, "owner", FUTURE);
    const res = await request(app).get(`/api/deadman/checkin?token=${token}`);
    expect(JSON.stringify(res.body)).not.toContain(token);
  });
});
