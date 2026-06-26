import { test, expect } from "@playwright/test";
import { loginAs, resetDeadman } from "./support/auth";

/**
 * Feature 012 (US1) — the guided first-run flow, end to end. A fresh (never-armed) user is offered
 * the dismissible wizard on the dashboard and is walked through write a note → add a contact
 * → set interval/grace → confirm arm, after which the switch is `active` and the wizard steps aside.
 * A second spec covers the dismiss path. Each step drives an EXISTING endpoint (no new backend); the
 * suite keeps `DEADMAN_TICK_DISABLED=1` (playwright.config) and reuses the AUTH/DEADMAN test seams.
 */

test.beforeEach(async ({ page }) => {
  await resetDeadman(page);
});

test("first-run wizard: note → add contact → arm → active, wizard steps aside", async ({
  page,
}) => {
  await loginAs(page, { sub: "e2e-onboard", email: "onboard@example.com", name: "Ona" });

  // Auto-accept the first-arm confirmation dialog.
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/deadman");

  // The wizard is offered for a never-armed user, at the write-note step.
  await expect(
    page.getByRole("heading", { name: /set up your dead-man switch/i }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /step 1 — write your note/i })).toBeVisible();

  // Step 1 — write a note (drives PUT /api/note) and continue.
  await page.getByLabel("Note").fill("To my family: the documents are in the safe.");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(/^saved\.$/i)).toBeVisible();
  await page.getByRole("button", { name: /i've saved my note — continue/i }).click();

  // Step 2 — add a contact (drives POST /api/contact).
  await expect(
    page.getByRole("heading", { name: /step 2 — add a contact/i }),
  ).toBeVisible();
  await page.getByLabel(/email address/i).fill("trusted@example.com");
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText("trusted@example.com")).toBeVisible();
  await page.getByRole("button", { name: /i've added a contact — continue/i }).click();

  // The wizard resumes at step 3 (a contact now exists).
  await expect(page.getByRole("heading", { name: /step 3 — set your schedule (&|and) arm/i })).toBeVisible();

  // Step 3 — arm (form defaults are within bounds; the confirm dialog is auto-accepted).
  await page.getByRole("button", { name: /arm my switch/i }).click();

  // The wizard reaches completion (the arm via PUT /api/deadman/config succeeded).
  await expect(page.getByRole("heading", { name: /your switch is set up/i })).toBeVisible();

  // Closing the wizard leaves the dashboard fully usable.
  await page.getByRole("button", { name: /^done$/i }).click();
  await expect(
    page.getByRole("heading", { name: /set up your dead-man switch/i }),
  ).toBeHidden();

  // The switch is now active (and once ever-armed the wizard is no longer auto-offered).
  await page.reload();
  await expect(page.getByTestId("deadman-state")).toHaveText(/active/i);
  await expect(page.getByRole("button", { name: /i'm alive/i })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /set up your dead-man switch/i }),
  ).toBeHidden();
});

test("first-run wizard: dismiss leaves the dashboard usable and stays hidden", async ({ page }) => {
  await loginAs(page, { sub: "e2e-onboard-dismiss", email: "dismiss@example.com", name: "Dis" });
  await page.goto("/deadman");

  await expect(
    page.getByRole("heading", { name: /set up your dead-man switch/i }),
  ).toBeVisible();

  // Dismiss via the labelled Skip control.
  await page.getByRole("button", { name: /skip for now/i }).click();
  await expect(
    page.getByRole("heading", { name: /set up your dead-man switch/i }),
  ).toBeHidden();

  // The dashboard is fully usable (the config form is present).
  await expect(page.getByRole("button", { name: /arm switch/i })).toBeVisible();

  // It stays hidden on same-session navigation.
  await page.goto("/");
  await page.goto("/deadman");
  await expect(
    page.getByRole("heading", { name: /set up your dead-man switch/i }),
  ).toBeHidden();
});
