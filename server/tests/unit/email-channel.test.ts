import { describe, it, expect } from "vitest";
import { createEmailChannel } from "../../src/notifications/channels/email/email-channel";
import type { EmailMessage, EmailProvider, ProviderResult } from "../../src/notifications/channels/email/provider";
import type { NotificationRequest } from "../../src/notifications/types";

/** A provider that records the last message it was handed and returns a configurable result. */
class CapturingProvider implements EmailProvider {
  last?: EmailMessage;
  constructor(private readonly result: ProviderResult = { accepted: true, providerMessageId: "id-1" }) {}
  async send(message: EmailMessage): Promise<ProviderResult> {
    this.last = message;
    return this.result;
  }
}

function request(content: Record<string, unknown>, recipient = "person@example.com"): NotificationRequest {
  return { channel: "email", recipient, content };
}

describe("Email channel", () => {
  it("returns invalid (no send) for a bad request (FR-006)", async () => {
    const provider = new CapturingProvider();
    const channel = createEmailChannel(provider);
    const result = await channel.send(request({ subject: "", body: "b", bodyFormat: "text" }));
    expect(result.kind).toBe("invalid");
    expect(provider.last).toBeUndefined();
  });

  it("sends a plain-text body as text and reports a sent outcome (FR-007)", async () => {
    const provider = new CapturingProvider();
    const channel = createEmailChannel(provider);
    const result = await channel.send(request({ subject: "Hi", body: "Hello", bodyFormat: "text" }));
    expect(provider.last).toMatchObject({ to: "person@example.com", subject: "Hi", text: "Hello" });
    expect(provider.last?.html).toBeUndefined();
    expect(result).toEqual({ kind: "outcome", outcome: { status: "sent", channel: "email", providerMessageId: "id-1" } });
  });

  it("sanitizes an HTML body before the provider, stripping scripts/handlers (FR-016)", async () => {
    const provider = new CapturingProvider();
    const channel = createEmailChannel(provider);
    const dangerous = '<p>Hi</p><script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">link</a>';
    await channel.send(request({ subject: "Hi", body: dangerous, bodyFormat: "html" }));
    const html = provider.last?.html ?? "";
    expect(html).toContain("<p>Hi</p>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(provider.last?.text).toBeUndefined();
  });

  it("maps a provider rejection to a failed outcome with a reason (FR-007)", async () => {
    const provider = new CapturingProvider({ accepted: false, reason: "mailbox full" });
    const channel = createEmailChannel(provider);
    const result = await channel.send(request({ subject: "Hi", body: "Hello", bodyFormat: "text" }));
    expect(result).toEqual({ kind: "outcome", outcome: { status: "failed", channel: "email", reason: "mailbox full" } });
  });

  it("fails with a timeout reason when the provider does not respond in time (FR-008)", async () => {
    const stalling: EmailProvider = { send: () => new Promise<ProviderResult>(() => {}) };
    const channel = createEmailChannel(stalling, { timeoutMs: 10 });
    const result = await channel.send(request({ subject: "Hi", body: "Hello", bodyFormat: "text" }));
    expect(result.kind).toBe("outcome");
    if (result.kind === "outcome") {
      expect(result.outcome.status).toBe("failed");
      expect(result.outcome.reason).toMatch(/did not respond in time/i);
    }
  });
});
