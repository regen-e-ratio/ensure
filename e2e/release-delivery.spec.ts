import { test, expect } from "@playwright/test";
import { loginAs, resetDeadman, capturedEmails, fastForwardDeadman } from "./support/auth";

/**
 * Feature 010 full cycle: a signed-in owner writes a note, verifies a contact, arms the switch,
 * then — via the DEADMAN_TEST_MODE fast-forward seam — misses the deadline, runs through grace,
 * and triggers. The fired switch emails the verified contact a one-time link; the recipient opens
 * /r/<token> once to read the note, and a reopen shows "no longer available" (view-once / 410).
 * The in-process timer stays disabled (playwright.config DEADMAN_TICK_DISABLED=1); transitions are
 * driven by the fast-forward seam, which runs one engine tick itself.
 */

test.beforeEach(async ({ page }) => {
  await resetDeadman(page); // clears note, contacts, deadman config/events/releases, captured emails
});

/** Add a contact, send its verification email, and open the captured link to verify it. */
async function addAndVerifyContact(page: import("@playwright/test").Page, value: string) {
  await page.goto("/settings");
  await page.getByLabel(/email address/i).fill(value);
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText(value)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`send verification to ${value}`, "i") }).click();
  await expect(page.getByText(/verification email sent/i)).toBeVisible();

  const emails = await capturedEmails(page);
  const vEmail = emails.find((e) => e.to === value);
  const vBody = vEmail!.text ?? vEmail!.html ?? "";
  const vPath = vBody.match(/\/contact-verified\?token=[A-Za-z0-9_%-]+/)![0];
  await page.goto(vPath);
  await expect(page.getByRole("heading", { name: /your email is confirmed/i })).toBeVisible();
}

test("arm → fast-forward → trigger → open release link once → gone", async ({ page }) => {
  await loginAs(page, { sub: "e2e-release", email: "owner@example.com", name: "Ophelia" });
  page.on("dialog", (dialog) => void dialog.accept()); // auto-accept first-arm confirm

  // Owner writes a note.
  await page.goto("/");
  await page.getByLabel(/note/i).fill("the message my contact should receive");
  await page.getByRole("button", { name: /save/i }).click();
  await expect(page.getByText(/saved/i)).toBeVisible();

  // Verify a contact (only verified contacts receive a release).
  await addAndVerifyContact(page, "recipient@example.com");

  // Arm the switch.
  await page.goto("/deadman");
  await page.getByRole("button", { name: /arm switch/i }).click();
  await expect(page.getByTestId("deadman-state")).toHaveText(/active/i);

  // Fast-forward the deadline; the seam runs one tick → grace.
  await fastForwardDeadman(page);
  await page.reload();
  await expect(page.getByTestId("deadman-state")).toHaveText(/grace period/i);

  // Fast-forward again past the grace deadline → triggered (the release fires).
  await fastForwardDeadman(page);
  await page.reload();
  await expect(page.getByTestId("deadman-state")).toHaveText(/triggered/i);

  // Read the release link from the captured stub email to the verified contact.
  const emails = await capturedEmails(page);
  const releaseEmail = emails.find((e) => e.to === "recipient@example.com" && /\/r\//.test(e.text ?? e.html ?? ""));
  expect(releaseEmail, "a release email with a tokenized link was captured").toBeTruthy();
  const body = releaseEmail!.text ?? releaseEmail!.html ?? "";
  const path = body.match(/\/r\/[A-Za-z0-9_-]+/)![0];
  const token = path.split("/r/")[1]!;

  // The release email must never leak the note plaintext.
  expect(body).not.toContain("the message my contact should receive");

  // Open the link once (public page, no session): the note + single-use warning are shown.
  await page.goto(path);
  await expect(page.getByRole("heading", { name: /a message shared with you/i })).toBeVisible();
  await expect(page.getByText(/only be opened once/i)).toBeVisible();
  await expect(page.getByText("the message my contact should receive")).toBeVisible();

  // Reopen the same link → no longer available (view-once / 410).
  await page.goto(`/r/${token}`);
  await expect(page.getByText(/no longer available/i)).toBeVisible();
});
