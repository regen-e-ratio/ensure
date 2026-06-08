import { describe, it, expect, vi } from "vitest";
import { StubEmailProvider } from "../../src/notifications/channels/email/stub-provider";
import type { EmailMessage } from "../../src/notifications/channels/email/provider";

const textMessage: EmailMessage = {
  to: "person@example.com",
  subject: "Hello subject",
  text: "Plain Body text",
};

const htmlMessage: EmailMessage = {
  to: "person@example.com",
  subject: "Hello subject",
  html: "<p>Sanitized Body html</p>",
};

describe("StubEmailProvider", () => {
  it("accepts a well-formed message and returns a provider message id", async () => {
    const result = await new StubEmailProvider().send(textMessage);
    expect(result.accepted).toBe(true);
    expect(typeof result.providerMessageId).toBe("string");
  });

  it("can be configured to fail, returning a reason and no id", async () => {
    const result = await new StubEmailProvider({ accept: false, reason: "boom" }).send(textMessage);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("boom");
    expect(result.providerMessageId).toBeUndefined();
  });

  it("does not echo recipient or body into the result (FR-014)", async () => {
    const result = await new StubEmailProvider().send(textMessage);
    expect(JSON.stringify(result)).not.toContain("person@example.com");
    expect(JSON.stringify(result)).not.toContain("Body");
  });

  // --- 007: opt-in debug log (US1 — logs every submitted field when enabled) ---

  it("logs one line with recipient, subject, body, and bodyFormat=text when debug is on (US1)", async () => {
    const log = vi.fn();
    await new StubEmailProvider({ debug: true, log }).send(textMessage);

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("person@example.com"); // recipient
    expect(line).toContain("Hello subject"); // subject
    expect(line).toContain("Plain Body text"); // body
    expect(line).toContain("text"); // derived body format
    // Clearly identifiable as debug output (FR-006)
    expect(line.toLowerCase()).toContain("debug");
  });

  it("reports bodyFormat=html and logs the sanitized html body when debug is on (US1)", async () => {
    const log = vi.fn();
    await new StubEmailProvider({ debug: true, log }).send(htmlMessage);

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("html"); // derived body format
    expect(line).toContain("<p>Sanitized Body html</p>"); // the sanitized html the stub received
  });

  // --- 007: off by default (US2 — silent when disabled, outcome invariant) ---

  it("never calls the log sink when debug is omitted or false (US2, FR-003)", async () => {
    const logOmitted = vi.fn();
    await new StubEmailProvider({ log: logOmitted }).send(textMessage);
    expect(logOmitted).not.toHaveBeenCalled();

    const logFalse = vi.fn();
    await new StubEmailProvider({ debug: false, log: logFalse }).send(textMessage);
    expect(logFalse).not.toHaveBeenCalled();
  });

  it("returns the same outcome whether debug is on or off (US2, FR-005 / SC-003)", async () => {
    const accepted = await new StubEmailProvider({ debug: true, log: vi.fn() }).send(textMessage);
    const acceptedNoDebug = await new StubEmailProvider().send(textMessage);
    expect(accepted).toEqual(acceptedNoDebug);

    const failed = await new StubEmailProvider({ accept: false, debug: true, log: vi.fn() }).send(
      textMessage,
    );
    const failedNoDebug = await new StubEmailProvider({ accept: false }).send(textMessage);
    expect(failed).toEqual(failedNoDebug);
  });
});
