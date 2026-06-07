import { test, expect } from "@playwright/test";
import { loginAs, resetNote } from "./support/auth";

/**
 * US1: two distinct test-login users (distinct Google `sub`) each see only their own
 * note in the browser — never the other's content (FR-003, FR-005).
 */
test("two users each see only their own note", async ({ page }) => {
  await resetNote(page);

  // User A signs in and saves a note.
  await loginAs(page, { sub: "e2e-alice", email: "alice@example.com", name: "Alice" });
  await page.goto("/");
  await page.getByLabel(/note/i).fill("alpha note from alice");
  await page.getByRole("button", { name: /save/i }).click();
  await expect(page.getByText(/saved/i)).toBeVisible();

  // User B signs in (same browser context, replacing the session) → empty state, not A's note.
  await loginAs(page, { sub: "e2e-bob", email: "bob@example.com", name: "Bob" });
  await page.goto("/");
  await expect(page.getByLabel(/note/i)).toHaveValue("");
  await expect(page.getByText("alpha note from alice")).toHaveCount(0);

  // User B saves their own note.
  await page.getByLabel(/note/i).fill("beta note from bob");
  await page.getByRole("button", { name: /save/i }).click();
  await expect(page.getByText(/saved/i)).toBeVisible();

  // Back to user A: still their own note, never B's.
  await loginAs(page, { sub: "e2e-alice", email: "alice@example.com", name: "Alice" });
  await page.goto("/");
  await expect(page.getByLabel(/note/i)).toHaveValue("alpha note from alice");
  await expect(page.getByText("beta note from bob")).toHaveCount(0);
});
