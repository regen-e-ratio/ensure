import type { RequestHandler } from "express";
import type { EmailMessage, EmailProvider, ProviderResult } from "../notifications/channels/email/provider";

/**
 * Test-only email provider that records every message the dispatcher sends and then delegates
 * to a wrapped provider (the real stub). Mounted ONLY behind the existing test gates
 * (NOTE_ALLOW_TEST_RESET), never in production — it lets e2e read back the verification link
 * the server emailed without a real inbox. It captures only what the stub already received and
 * exposes it via a test seam; no behaviour change to the send path.
 */
export class CapturingEmailProvider implements EmailProvider {
  public readonly captured: EmailMessage[] = [];
  constructor(private readonly inner: EmailProvider) {}

  async send(message: EmailMessage): Promise<ProviderResult> {
    this.captured.push(message);
    return this.inner.send(message);
  }
}

/** Handler for GET /api/test/emails — returns the captured emails (most recent last). */
export function createCapturedEmailsHandler(provider: CapturingEmailProvider): RequestHandler {
  return (_req, res) => {
    res.status(200).json({ emails: provider.captured });
  };
}
