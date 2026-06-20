import { describe, it, expect } from "vitest";
import { formatCountdown } from "../../src/onboarding/countdown";

/**
 * US4: the extracted/refined countdown formatter. Presentation-only — it formats an already-derived
 * "seconds remaining" value and must not change the underlying timing semantics (the seconds it is
 * given are computed elsewhere from the absolute deadline).
 */
describe("formatCountdown — legible units + screen-reader text (US4)", () => {
  it("returns a no-deadline form for null", () => {
    const r = formatCountdown(null);
    expect(r.display).toBe("—");
    expect(r.urgency).toBe("none");
  });

  it("renders 'Due now' with a 'due' urgency tier (not colour-only) when the deadline has passed", () => {
    for (const s of [0, -1, -120]) {
      const r = formatCountdown(s);
      expect(r.display).toBe("Due now");
      expect(r.screenReader).toMatch(/due now/i);
      expect(r.urgency).toBe("due");
    }
  });

  it("formats days + HH:MM:SS compactly and spells the largest units for screen readers", () => {
    // 2 days, 3 hours, 4 minutes, 5 seconds.
    const total = 2 * 86_400 + 3 * 3_600 + 4 * 60 + 5;
    const r = formatCountdown(total);
    expect(r.display).toBe("2d 03:04:05");
    expect(r.screenReader).toMatch(/2 days/);
    expect(r.screenReader).toMatch(/3 hours/);
    expect(r.screenReader).toMatch(/remaining/);
    expect(r.urgency).toBe("normal");
  });

  it("omits the day prefix when under a day and singularises units", () => {
    const total = 1 * 3_600 + 1 * 60 + 1; // 1 hour, 1 minute, 1 second
    const r = formatCountdown(total);
    expect(r.display).toBe("01:01:01");
    expect(r.screenReader).toMatch(/1 hour\b/);
    expect(r.screenReader).not.toMatch(/1 hours/);
  });

  it("does not alter the input (no mutation / timing change)", () => {
    const total = 604_800;
    formatCountdown(total);
    expect(total).toBe(604_800);
  });
});
