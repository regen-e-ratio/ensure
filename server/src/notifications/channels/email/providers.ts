import type { EmailProvider } from "./provider";
import { StubEmailProvider } from "./stub-provider";

/**
 * Select the configured email provider by name (EMAIL_PROVIDER env). v1 supports only the
 * in-process `stub`; a real provider is added by implementing {@link EmailProvider} and
 * adding a case here (see quickstart.md "Adding a real email provider"). An unknown name
 * fails fast so a misconfiguration cannot silently fall back to not sending.
 */
export function createEmailProvider(name: string): EmailProvider {
  switch (name) {
    case "stub":
      return new StubEmailProvider();
    default:
      throw new Error(
        `Unknown EMAIL_PROVIDER "${name}". Supported: "stub". ` +
          `Implement an EmailProvider adapter and register it in providers.ts.`,
      );
  }
}
