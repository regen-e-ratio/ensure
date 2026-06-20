import { describe, it, expect } from "vitest";
import { DEADMAN_MAX_GRACE_REMINDERS } from "@ensure/shared/constants";
import { evaluate } from "../../src/deadman/engine";
import type { DeadmanConfig } from "../../src/deadman/config-repo";

const BASE: DeadmanConfig = {
  userId: "u1",
  enabled: true,
  state: "active",
  checkinIntervalSeconds: 604800,
  gracePeriodSeconds: 172800,
  lastCheckinAt: "2026-06-20T00:00:00.000Z",
  nextCheckinDueAt: "2026-06-27T00:00:00.000Z",
  graceDeadlineAt: null,
  remindersSent: 0,
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
};

function at(iso: string): Date {
  return new Date(iso);
}

describe("evaluate — disarmed / triggered (US1, US4)", () => {
  it("returns noop for a disarmed switch", () => {
    const config = { ...BASE, enabled: false, state: "disarmed" as const, nextCheckinDueAt: null };
    expect(evaluate(config, at("2030-01-01T00:00:00.000Z")).kind).toBe("noop");
  });

  it("returns noop for an already-triggered switch (idempotent, never re-fires)", () => {
    const config = { ...BASE, state: "triggered" as const };
    expect(evaluate(config, at("2030-01-01T00:00:00.000Z")).kind).toBe("noop");
  });
});

describe("evaluate — active (US1, US2)", () => {
  it("stays while the deadline is in the future", () => {
    expect(evaluate(BASE, at("2026-06-26T00:00:00.000Z")).kind).toBe("stay");
  });

  it("enters grace when the deadline is in the past", () => {
    expect(evaluate(BASE, at("2026-06-28T00:00:00.000Z")).kind).toBe("enter_grace");
  });

  it("enters grace exactly at the deadline (inclusive boundary now >= deadline)", () => {
    expect(evaluate(BASE, at("2026-06-27T00:00:00.000Z")).kind).toBe("enter_grace");
  });
});

describe("evaluate — grace (US2)", () => {
  const grace: DeadmanConfig = {
    ...BASE,
    state: "grace",
    nextCheckinDueAt: "2026-06-27T00:00:00.000Z",
    graceDeadlineAt: "2026-06-29T00:00:00.000Z",
    remindersSent: 1,
  };

  it("triggers when the grace deadline is in the past", () => {
    expect(evaluate(grace, at("2026-06-30T00:00:00.000Z")).kind).toBe("trigger");
  });

  it("triggers exactly at the grace deadline (inclusive)", () => {
    expect(evaluate(grace, at("2026-06-29T00:00:00.000Z")).kind).toBe("trigger");
  });

  it("reminds again while inside grace and under the cap", () => {
    expect(evaluate(grace, at("2026-06-28T00:00:00.000Z")).kind).toBe("remind");
  });

  it("does not remind past the cap (stays instead)", () => {
    const capped = { ...grace, remindersSent: DEADMAN_MAX_GRACE_REMINDERS };
    expect(evaluate(capped, at("2026-06-28T00:00:00.000Z")).kind).toBe("stay");
  });
});
