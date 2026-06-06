import { test, expect } from "@playwright/test";
import { loginAs, resetNote } from "./support/auth";

test.beforeEach(async ({ page }) => {
  await resetNote(page);
  await loginAs(page); // the note page is now gated behind SSO (D6 test-login seam)
});

// US1: write a note, save, and confirm it persists after a page reload (SC-002).
test("writes a note, saves, and it persists after reload", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel(/note/i).fill("Remember the milk");
  await page.getByRole("button", { name: /save/i }).click();

  await expect(page.getByText(/saved/i)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/note/i)).toHaveValue("Remember the milk");
});
