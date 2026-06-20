/**
 * Build the contact-verification email (feature 009). The body carries a single
 * `${appBaseUrl}/contact-verified?token=${token}` link and no other secret; it is handed to
 * the generic `notify()` dispatcher (email channel), never a provider directly (FR-004). The
 * raw token appears here exactly once, inside the link — it is never stored or logged.
 */
export interface VerificationEmail {
  subject: string;
  body: string;
}

/** Compose the verification email for `recipient` with a one-time link under `appBaseUrl`. */
export function buildVerificationEmail(
  appBaseUrl: string,
  token: string,
  recipient: string,
): VerificationEmail {
  const base = appBaseUrl.replace(/\/+$/, "");
  const link = `${base}/contact-verified?token=${encodeURIComponent(token)}`;
  const subject = "Confirm your email for Ensure";
  const body = [
    `Someone added ${recipient} as a contact in Ensure and asked to verify this address.`,
    "",
    "To confirm you control this address, open the link below:",
    link,
    "",
    "This link can be used once and expires within 24 hours. If you did not expect this,",
    "you can safely ignore this email.",
  ].join("\n");
  return { subject, body };
}
