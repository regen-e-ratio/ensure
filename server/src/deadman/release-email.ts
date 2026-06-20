/**
 * Build the release-delivery email (feature 010). The body explains a message is waiting for
 * the recipient and carries a single one-time `${appBaseUrl}/r/${token}` link and no other
 * secret; it is handed to the generic `notify()` dispatcher (email channel), never a provider
 * directly (FR-002). The raw token appears here exactly once, inside the link — it is never
 * stored or logged. No note plaintext is ever placed in the email.
 */
export interface ReleaseEmail {
  subject: string;
  body: string;
}

/** Compose the release email for `recipient` with a one-time view link under `appBaseUrl`. */
export function buildReleaseEmail(
  appBaseUrl: string,
  token: string,
  recipient: string,
): ReleaseEmail {
  const base = appBaseUrl.replace(/\/+$/, "");
  const link = `${base}/r/${encodeURIComponent(token)}`;
  const subject = "A message has been shared with you via Ensure";
  const body = [
    `Hello,`,
    "",
    `You were named as a contact in Ensure, and a message has now been released to ${recipient}.`,
    "",
    "Open the secure link below to read it. The link can be opened only once, so please be ready",
    "to read the message when you open it:",
    link,
    "",
    "This link is private to you and expires in 30 days. If you did not expect this message, you",
    "can safely ignore this email.",
  ].join("\n");
  return { subject, body };
}
