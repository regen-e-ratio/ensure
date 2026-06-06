import { type Page } from "@playwright/test";

/**
 * Seed an authenticated session for `page` via the env-gated test-login seam
 * (POST /api/test/login, mounted only when AUTH_TEST_MODE=1). `page.request` shares
 * cookie storage with the page's browser context, so after this call the page is
 * signed in with the SAME access + refresh cookies the real Google flow issues —
 * exercising the real auth middleware without automating Google's consent screen
 * (research.md D6).
 */
export async function loginAs(
  page: Page,
  body: { sub?: string; email?: string; name?: string } = {},
): Promise<void> {
  const res = await page.request.post("/api/test/login", { data: body });
  if (!res.ok()) {
    throw new Error(`test-login failed with status ${res.status()}`);
  }
}

/** Clear the stored note (test-only reset seam) so specs start from a known state. */
export async function resetNote(page: Page): Promise<void> {
  await page.request.post("/api/test/reset");
}
