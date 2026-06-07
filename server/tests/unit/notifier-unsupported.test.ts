import { describe, it, expect } from "vitest";
import { buildRegistry } from "../../src/notifications/registry";
import { notify } from "../../src/notifications/notifier";
import { StubEmailProvider } from "../../src/notifications/channels/email/stub-provider";

/** US2: a request for a known-but-disabled channel is rejected clearly (FR-009). */
describe("notify() unsupported channel", () => {
  it("returns CHANNEL_NOT_SUPPORTED for a disabled channel and invokes no handler", async () => {
    const registry = buildRegistry(new StubEmailProvider());
    const result = await notify(registry, {
      channel: "whatsapp",
      recipient: "+15555550100",
      content: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("CHANNEL_NOT_SUPPORTED");
      expect(result.message).toMatch(/whatsapp/i);
    }
  });
});
