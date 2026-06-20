import { test, expect } from "@playwright/test";
import { loginAs, resetDeadman, fastForwardDeadman } from "./support/auth";

/**
 * US1 + US2: a signed-in user arms their dead-man switch (confirming the first arm), sees a
 * live countdown, checks in to stay active, and — after the deadline is fast-forwarded into
 * the past via the test seam — sees the switch enter its grace period.
 */

test.beforeEach(async ({ page }) => {
  await resetDeadman(page);
});

test("arm → countdown → check-in → fast-forward → grace", async ({ page }) => {
  await loginAs(page, { sub: "e2e-deadman", email: "deadman@example.com", name: "Dee" });

  // Auto-accept the first-arm confirmation dialog.
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/deadman");

  // Starts disarmed.
  await expect(page.getByTestId("deadman-state")).toHaveText(/disarmed/i);

  // Arm the switch (the form defaults are pre-filled, within bounds).
  await page.getByRole("button", { name: /arm switch/i }).click();

  // Now active with a live countdown.
  await expect(page.getByTestId("deadman-state")).toHaveText(/active/i);
  await expect(page.getByTestId("deadman-countdown")).toBeVisible();

  // Check in — stays active.
  await page.getByRole("button", { name: /i'm alive/i }).click();
  await expect(page.getByTestId("deadman-state")).toHaveText(/active/i);
  await expect(page.getByText(/checked in/i)).toBeVisible();

  // Fast-forward the deadline into the past (the seam runs one engine tick), then reload.
  await fastForwardDeadman(page);
  await page.reload();

  // The switch is now in its grace period.
  await expect(page.getByTestId("deadman-state")).toHaveText(/grace period/i);
});
