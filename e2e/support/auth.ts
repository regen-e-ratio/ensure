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

/** Clear all stored contacts (test-only reset seam) so specs start from a known state. */
export async function resetContacts(page: Page): Promise<void> {
  await page.request.post("/api/test/reset");
}

/** Clear the dead-man switch config + events (test-only reset seam) so specs start clean. */
export async function resetDeadman(page: Page): Promise<void> {
  await page.request.post("/api/test/reset");
}

/**
 * Read back the emails the server captured (e.g. the release-delivery round-trip). Mounted
 * behind the same NOTE_ALLOW_TEST_RESET gate as the reset seam — never in production. Returns
 * the captured messages (most recent last) so a spec can extract an emailed link.
 */
export async function capturedEmails(
  page: Page,
): Promise<{ to: string; subject: string; text?: string; html?: string }[]> {
  const res = await page.request.get("/api/test/emails");
  if (!res.ok()) {
    throw new Error(`captured-emails failed with status ${res.status()}`);
  }
  const body = (await res.json()) as {
    emails: { to: string; subject: string; text?: string; html?: string }[];
  };
  return body.emails;
}

/**
 * Fast-forward the signed-in user's switch deadlines into the past via the env-gated test
 * seam (POST /api/test/deadman, mounted only when DEADMAN_TEST_MODE=1), so a spec can force
 * the miss-deadline → grace path without waiting real time. The page must be signed in.
 */
export async function fastForwardDeadman(page: Page): Promise<void> {
  const res = await page.request.post("/api/test/deadman");
  if (!res.ok()) {
    throw new Error(`fast-forward deadman failed with status ${res.status()}`);
  }
}
