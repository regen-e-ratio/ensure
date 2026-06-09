import type { EmailMessage, EmailProvider, ProviderResult } from "./provider";

/** Construction-time options for {@link StubEmailProvider}. */
export interface StubEmailProviderOptions {
  /** `accept: false` makes every send fail (to exercise the failure path); omitted/`true` accepts. */
  accept?: boolean;
  /** Failure reason surfaced when `accept` is false. */
  reason?: string;
  /**
   * Opt-in, **LOCAL-DEBUG-ONLY** content log (spec 007). When true, each {@link send} writes one
   * line containing the recipient, subject, body, and body format the stub received at the provider
   * boundary — so a developer can confirm the test-page fields reached the backend correctly. Off by
   * default (FR-002). This deliberately relaxes the "never log recipient/content" rule (005 FR-014)
   * **for the stub only** — it is safe because the stub performs no real send. Do not enable it
   * outside local debugging, and do not widen this to the channel/dispatch path or a real provider
   * (FR-007, FR-008).
   */
  debug?: boolean;
  /** Injectable sink for the debug line (defaults to `console.debug`); lets tests assert output. */
  log?: (line: string) => void;
}

/**
 * The default v1 email provider: performs **no network send**. It lets the whole
 * notification pipeline (validation, sanitization, routing, outcome reporting, the test
 * page, e2e) be exercised deterministically before any real vendor is chosen (research.md
 * D4). A real provider is added later by implementing {@link EmailProvider} and selecting
 * it via the EMAIL_PROVIDER env var (see quickstart.md).
 *
 * It never logs the recipient or body unless the opt-in {@link StubEmailProviderOptions.debug}
 * flag is set (off by default; local-debug-only — see that field's docs).
 */
export class StubEmailProvider implements EmailProvider {
  constructor(private readonly options: StubEmailProviderOptions = {}) {}

  async send(message: EmailMessage): Promise<ProviderResult> {
    if (this.options.debug) {
      const log = this.options.log ?? ((line: string) => console.debug(line));
      // Exactly one of text/html is set by the channel; html is already sanitized by then.
      const bodyFormat = message.html !== undefined ? "html" : "text";
      const body = message.html ?? message.text ?? "";
      log(
        `[email-stub:debug] received ${JSON.stringify({
          to: message.to,
          subject: message.subject,
          bodyFormat,
          body,
        })}`,
      );
    }

    if (this.options.accept === false) {
      return { accepted: false, reason: this.options.reason ?? "Stub provider is configured to fail." };
    }
    return { accepted: true, providerMessageId: "stub-accepted" };
  }
}
