import { describe, it, expect } from "vitest";
import { loadDeadmanConfig } from "../../src/config/env";

describe("loadDeadmanConfig", () => {
  it("uses sensible defaults when nothing is set", () => {
    const config = loadDeadmanConfig({});
    expect(config.tickMs).toBe(60000);
    expect(config.tickDisabled).toBe(false);
    expect(config.appBaseUrl).toBe("http://localhost:5173");
    expect(config.testMode).toBe(false);
  });

  it("reads DEADMAN_TICK_MS as a positive integer", () => {
    expect(loadDeadmanConfig({ DEADMAN_TICK_MS: "5000" }).tickMs).toBe(5000);
  });

  it("falls back to the default tick when DEADMAN_TICK_MS is non-numeric", () => {
    expect(loadDeadmanConfig({ DEADMAN_TICK_MS: "not-a-number" }).tickMs).toBe(60000);
  });

  it("treats DEADMAN_TICK_DISABLED=1 as disabled", () => {
    expect(loadDeadmanConfig({ DEADMAN_TICK_DISABLED: "1" }).tickDisabled).toBe(true);
  });

  it("treats DEADMAN_TEST_MODE=1 as enabled", () => {
    expect(loadDeadmanConfig({ DEADMAN_TEST_MODE: "1" }).testMode).toBe(true);
  });

  it("reads APP_BASE_URL when provided", () => {
    expect(loadDeadmanConfig({ APP_BASE_URL: "https://app.example.com" }).appBaseUrl).toBe(
      "https://app.example.com",
    );
  });
});
