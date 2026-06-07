import { describe, it, expect } from "vitest";
import { StubEmailProvider } from "../../src/notifications/channels/email/stub-provider";

describe("StubEmailProvider", () => {
  it("accepts a well-formed message and returns a provider message id", async () => {
    const result = await new StubEmailProvider().send();
    expect(result.accepted).toBe(true);
    expect(typeof result.providerMessageId).toBe("string");
  });

  it("can be configured to fail, returning a reason and no id", async () => {
    const result = await new StubEmailProvider({ accept: false, reason: "boom" }).send();
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("boom");
    expect(result.providerMessageId).toBeUndefined();
  });

  it("does not echo recipient or body into the result (FR-014)", async () => {
    const result = await new StubEmailProvider().send();
    expect(JSON.stringify(result)).not.toContain("person@example.com");
    expect(JSON.stringify(result)).not.toContain("Body");
  });
});
