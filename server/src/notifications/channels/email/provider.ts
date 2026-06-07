/**
 * The email-provider port — the single swap boundary for the external email vendor
 * (research.md D3). The Email channel depends only on this interface, so adopting a real
 * provider later is one adapter file + an env switch, with no change to callers, the
 * dispatcher, or the channel logic (FR-004, SC-002, SC-003). No vendor is chosen in v1;
 * the default adapter is the in-process {@link StubEmailProvider}.
 */
export interface EmailProvider {
  send(message: EmailMessage): Promise<ProviderResult>;
}

/** A normalized, ready-to-send email. Exactly one of `text`/`html` is set by the channel. */
export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body (set when bodyFormat = "text"). */
  text?: string;
  /** Sanitized HTML body (set when bodyFormat = "html"; sanitization happens in the channel). */
  html?: string;
}

/** What a provider reports back. `accepted` maps to a "sent" outcome; otherwise "failed". */
export interface ProviderResult {
  accepted: boolean;
  /** Provider-assigned id when accepted (surfaced as SendOutcome.providerMessageId). */
  providerMessageId?: string;
  /** Human-readable reason when not accepted (surfaced as SendOutcome.reason). */
  reason?: string;
}
