import { describe, it, expect } from "vitest";
import { buildRegistry } from "../../src/notifications/registry";
import { notify } from "../../src/notifications/notifier";
import { StubEmailProvider } from "../../src/notifications/channels/email/stub-provider";

/**
 * US2: any caller can use the generic capability directly (no HTTP, no channel-specific
 * code) and gets the same outcome the endpoint path produces (FR-001, SC-002).
 */
describe("notify() reuse from any caller", () => {
  it("delivers an Email notification and reports a sent outcome", async () => {
    const registry = buildRegistry(new StubEmailProvider());
    const result = await notify(registry, {
      channel: "email",
      recipient: "person@example.com",
      content: { subject: "Hi", body: "Hello", bodyFormat: "text" },
    });
    expect(result).toEqual({ ok: true, outcome: { status: "sent", channel: "email", providerMessageId: "stub-accepted" } });
  });

  it("reports a validation rejection without attempting delivery (FR-006)", async () => {
    const registry = buildRegistry(new StubEmailProvider());
    const result = await notify(registry, {
      channel: "email",
      recipient: "not-an-email",
      content: { subject: "Hi", body: "Hello", bodyFormat: "text" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("VALIDATION_ERROR");
  });
});
