import { test, expect } from "@playwright/test";
import { loginAs } from "./support/auth";

test.beforeEach(async ({ page }) => {
  await loginAs(page); // the notifications page is gated behind SSO (D6 test-login seam)
});

// US1: send a notification through the test page and see an explicit success outcome
// (against the v1 stub provider — no real email is delivered).
test("sends a stub email and shows a success outcome", async ({ page }) => {
  await page.goto("/notifications");

  await page.getByLabel("Recipient address").fill("person@example.com");
  await page.getByLabel("Subject").fill("Hello from e2e");
  await page.getByLabel("Body", { exact: true }).fill("This is a test notification.");
  await page.getByRole("button", { name: /send notification/i }).click();

  await expect(page.getByText(/sent\./i)).toBeVisible();
});

// US3: future channels are visible but cannot be selected to send.
test("shows WhatsApp and push as unavailable", async ({ page }) => {
  await page.goto("/notifications");
  await expect(page.getByRole("option", { name: /whatsapp/i })).toBeDisabled();
  await expect(page.getByRole("option", { name: /push/i })).toBeDisabled();
});
