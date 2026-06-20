import { describe, it, expect } from "vitest";
import {
  CHECKIN_INTERVAL_MIN_SECONDS,
  CHECKIN_INTERVAL_MAX_SECONDS,
  GRACE_PERIOD_MIN_SECONDS,
  GRACE_PERIOD_MAX_SECONDS,
} from "@ensure/shared/constants";
import { parseDeadmanConfigInput } from "../../src/validation/deadman";

describe("parseDeadmanConfigInput", () => {
  it("accepts in-bounds interval/grace + boolean enabled", () => {
    const result = parseDeadmanConfigInput({
      checkinIntervalSeconds: 604800,
      gracePeriodSeconds: 172800,
      enabled: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.checkinIntervalSeconds).toBe(604800);
      expect(result.value.enabled).toBe(true);
    }
  });

  it("accepts the exact min and max bounds", () => {
    expect(
      parseDeadmanConfigInput({
        checkinIntervalSeconds: CHECKIN_INTERVAL_MIN_SECONDS,
        gracePeriodSeconds: GRACE_PERIOD_MIN_SECONDS,
        enabled: false,
      }).ok,
    ).toBe(true);
    expect(
      parseDeadmanConfigInput({
        checkinIntervalSeconds: CHECKIN_INTERVAL_MAX_SECONDS,
        gracePeriodSeconds: GRACE_PERIOD_MAX_SECONDS,
        enabled: false,
      }).ok,
    ).toBe(true);
  });

  it("rejects an interval below the minimum", () => {
    const result = parseDeadmanConfigInput({
      checkinIntervalSeconds: CHECKIN_INTERVAL_MIN_SECONDS - 1,
      gracePeriodSeconds: 172800,
      enabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an interval above the maximum", () => {
    const result = parseDeadmanConfigInput({
      checkinIntervalSeconds: CHECKIN_INTERVAL_MAX_SECONDS + 1,
      gracePeriodSeconds: 172800,
      enabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a grace above the maximum", () => {
    const result = parseDeadmanConfigInput({
      checkinIntervalSeconds: 604800,
      gracePeriodSeconds: GRACE_PERIOD_MAX_SECONDS + 1,
      enabled: true,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-integer interval", () => {
    expect(
      parseDeadmanConfigInput({
        checkinIntervalSeconds: 604800.5,
        gracePeriodSeconds: 172800,
        enabled: true,
      }).ok,
    ).toBe(false);
  });

  it("rejects a missing enabled flag", () => {
    expect(
      parseDeadmanConfigInput({ checkinIntervalSeconds: 604800, gracePeriodSeconds: 172800 }).ok,
    ).toBe(false);
  });

  it("rejects a non-object body", () => {
    expect(parseDeadmanConfigInput(null).ok).toBe(false);
    expect(parseDeadmanConfigInput("nope").ok).toBe(false);
  });
});
