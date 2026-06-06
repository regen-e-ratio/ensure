import { test, expect } from "@playwright/test";
import { loginAs, resetNote } from "./support/auth";

// US2 sign-in happy path (session seeded via the test-login seam). Sign-out is
// covered by the US4 spec appended below.

test.beforeEach(async ({ page }) => {
  await resetNote(page);
});

test("a signed-in user reaches the protected note page", async ({ page }) => {
  await loginAs(page);
  await page.goto("/");
  // We land on the note view (not bounced to /login) and can edit.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /store a note/i })).toBeVisible();
  await expect(page.getByLabel(/note/i)).toBeVisible();
});

// US4: signing out returns to /login and protected content is no longer reachable.
test("signing out returns to /login and re-gates protected content", async ({ page }) => {
  await loginAs(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /store a note/i })).toBeVisible();

  await page.getByRole("button", { name: /sign out/i }).click();

  // Redirected to the login page.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: /sign in with google/i })).toBeVisible();

  // Protected content is no longer reachable: visiting / bounces back to /login.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});
