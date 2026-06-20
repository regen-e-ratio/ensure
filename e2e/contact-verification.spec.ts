import { test, expect } from "@playwright/test";
import { loginAs, resetContacts, capturedEmails } from "./support/auth";

/**
 * Feature 009 (US1 + US2): a signed-in owner adds a contact, sends a verification email,
 * opens the link captured from the stub email, sees the success result page, and — back on
 * the contact list — sees the contact's verified badge. Asserts the contact list never leaks
 * the raw token.
 */

test.beforeEach(async ({ page }) => {
  await resetContacts(page);
});

test("add → send verification → open link → verified badge", async ({ page }) => {
  await loginAs(page, { sub: "e2e-verify", email: "owner@example.com", name: "Olive" });
  await page.goto("/settings");

  // Add a contact.
  await page.getByLabel(/email address/i).fill("recipient@example.com");
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText("recipient@example.com")).toBeVisible();

  // It starts unverified.
  await expect(page.getByText("Not verified")).toBeVisible();

  // Send the verification email.
  await page.getByRole("button", { name: /send verification to recipient@example.com/i }).click();
  await expect(page.getByText(/verification email sent/i)).toBeVisible();

  // Read the verification link out of the captured stub email.
  const emails = await capturedEmails(page);
  const email = emails.find((e) => e.to === "recipient@example.com");
  expect(email, "a verification email was captured").toBeTruthy();
  const body = email!.text ?? email!.html ?? "";
  const match = body.match(/\/contact-verified\?token=[A-Za-z0-9_%-]+/);
  expect(match, "the email body carries a verification link").toBeTruthy();
  const path = match![0];

  // The owner's contact list must never leak the raw token.
  const token = decodeURIComponent(path.split("token=")[1]!);
  const listJson = await (await page.request.get("/api/contact")).text();
  expect(listJson).not.toContain(token);

  // Open the link (public page, no session needed) → success result.
  await page.goto(path);
  await expect(page.getByRole("heading", { name: /your email is confirmed/i })).toBeVisible();

  // Back on the contact list, the contact now shows the verified badge.
  await page.goto("/settings");
  await expect(page.getByText("Verified")).toBeVisible();
  await expect(page.getByRole("button", { name: /resend verification to recipient@example.com/i })).toBeVisible();
});
