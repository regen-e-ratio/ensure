import { test, expect } from "@playwright/test";
import { loginAs, resetDeadman, capturedEmails, fastForwardDeadman } from "./support/auth";

/**
 * Feature 011 full cycle: a signed-in owner arms the switch, then — via the DEADMAN_TEST_MODE
 * fast-forward seam — misses the deadline and slips into grace. The grace reminder email embeds a
 * one-time `/checkin?token=…` link; the owner opens it (no session needed), the public page
 * confirms the check-in, and the dashboard shows the switch back to `active`. The in-process timer
 * stays disabled (playwright.config DEADMAN_TICK_DISABLED=1); the transition into grace is driven
 * by the fast-forward seam, which runs one engine tick itself.
 */

test.beforeEach(async ({ page }) => {
  await resetDeadman(page); // clears deadman config/events/releases/checkin tokens, captured emails
});

test("arm → fast-forward → grace reminder → open check-in link → active", async ({ page }) => {
  await loginAs(page, { sub: "e2e-checkin", email: "owner@example.com", name: "Olivia" });
  page.on("dialog", (dialog) => void dialog.accept()); // auto-accept first-arm confirm

  // Arm the switch.
  await page.goto("/deadman");
  await page.getByRole("button", { name: /arm switch/i }).click();
  await expect(page.getByTestId("deadman-state")).toHaveText(/active/i);

  // Fast-forward the deadline; the seam runs one tick → grace (sends the first reminder).
  await fastForwardDeadman(page);
  await page.reload();
  await expect(page.getByTestId("deadman-state")).toHaveText(/grace period/i);

  // Read the check-in link from the captured reminder email to the owner's own address.
  const emails = await capturedEmails(page);
  const reminder = emails.find(
    (e) => e.to === "owner@example.com" && /\/checkin\?token=/.test(e.text ?? e.html ?? ""),
  );
  expect(reminder, "a reminder email with a /checkin link was captured").toBeTruthy();
  const body = reminder!.text ?? reminder!.html ?? "";
  const path = body.match(/\/checkin\?token=[A-Za-z0-9_%-]+/)![0];

  // Open the one-time check-in link (public page, no session): the confirmation is shown.
  await page.goto(path);
  await expect(page.getByRole("heading", { name: /you're checked in/i })).toBeVisible();

  // The dashboard now shows the switch back to active.
  await page.goto("/deadman");
  await expect(page.getByTestId("deadman-state")).toHaveText(/active/i);
});
