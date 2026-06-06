import { test, expect } from "@playwright/test";

// US2: the gate is real — no session is seeded in this spec (research.md D6).

test("redirects an unauthenticated visitor from / to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: /sign in with google/i })).toBeVisible();
});

test("a direct API call without a session returns 401", async ({ request }) => {
  const res = await request.get("/api/note");
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBe("UNAUTHORIZED");
});
