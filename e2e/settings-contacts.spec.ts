import { test, expect } from "@playwright/test";
import { loginAs, resetContacts } from "./support/auth";

/**
 * US1–US3: a signed-in user manages their contacts on /settings; contacts persist
 * across reloads; and two distinct users (distinct Google `sub`) each see only their
 * own contacts (FR-003).
 */

test.beforeEach(async ({ page }) => {
  await resetContacts(page);
});

test("adds and removes a contact, persisting across reload", async ({ page }) => {
  await loginAs(page, { sub: "e2e-alice", email: "alice@example.com", name: "Alice" });
  await page.goto("/settings");

  // Empty state initially.
  await expect(page.getByText(/no contacts yet/i)).toBeVisible();

  // Add a contact (US2).
  await page.getByLabel(/email address/i).fill("friend@example.com");
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText("friend@example.com")).toBeVisible();

  // Persists across reload (FR-009).
  await page.reload();
  await expect(page.getByText("friend@example.com")).toBeVisible();

  // Remove it (US3) and confirm it stays gone after reload.
  await page.getByRole("button", { name: /remove friend@example.com/i }).click();
  await expect(page.getByText("friend@example.com")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("friend@example.com")).toHaveCount(0);
});

test("two users each see only their own contacts", async ({ page }) => {
  // Alice adds a contact.
  await loginAs(page, { sub: "e2e-alice", email: "alice@example.com", name: "Alice" });
  await page.goto("/settings");
  await page.getByLabel(/email address/i).fill("alice-friend@example.com");
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText("alice-friend@example.com")).toBeVisible();

  // Bob signs in (same context, replacing the session) → never sees Alice's contact.
  await loginAs(page, { sub: "e2e-bob", email: "bob@example.com", name: "Bob" });
  await page.goto("/settings");
  await expect(page.getByText(/no contacts yet/i)).toBeVisible();
  await expect(page.getByText("alice-friend@example.com")).toHaveCount(0);

  // Back to Alice: her contact is still there.
  await loginAs(page, { sub: "e2e-alice", email: "alice@example.com", name: "Alice" });
  await page.goto("/settings");
  await expect(page.getByText("alice-friend@example.com")).toBeVisible();
});
