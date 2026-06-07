import type { EmailProvider, ProviderResult } from "./provider";

/**
 * The default v1 email provider: performs **no network send**. It lets the whole
 * notification pipeline (validation, sanitization, routing, outcome reporting, the test
 * page, e2e) be exercised deterministically before any real vendor is chosen (research.md
 * D4). A real provider is added later by implementing {@link EmailProvider} and selecting
 * it via the EMAIL_PROVIDER env var (see quickstart.md).
 *
 * It never logs the recipient or body (FR-014).
 */
export class StubEmailProvider implements EmailProvider {
  /**
   * @param behavior Test/inspection hook. `accept: false` makes every send fail (to
   *   exercise the failure path); omitted/`true` accepts.
   */
  constructor(private readonly behavior: { accept?: boolean; reason?: string } = {}) {}

  async send(): Promise<ProviderResult> {
    if (this.behavior.accept === false) {
      return { accepted: false, reason: this.behavior.reason ?? "Stub provider is configured to fail." };
    }
    return { accepted: true, providerMessageId: "stub-accepted" };
  }
}
