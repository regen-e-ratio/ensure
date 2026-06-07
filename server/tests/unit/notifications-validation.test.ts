import { describe, it, expect } from "vitest";
import { parseEmailRequest, EMAIL_SUBJECT_MAX, EMAIL_BODY_MAX } from "../../src/notifications/validation";
import type { NotificationRequest } from "../../src/notifications/types";

function emailRequest(overrides: Partial<{ recipient: string; subject: string; body: string; bodyFormat: string }> = {}): NotificationRequest {
  return {
    channel: "email",
    recipient: overrides.recipient ?? "person@example.com",
    content: {
      subject: overrides.subject ?? "Subject",
      body: overrides.body ?? "Body",
      bodyFormat: overrides.bodyFormat ?? "text",
    },
  };
}

describe("parseEmailRequest", () => {
  it("accepts a valid request and returns trimmed values", () => {
    const result = parseEmailRequest(emailRequest({ subject: "  Hi  ", body: "  Hello  " }));
    expect(result).toEqual({ ok: true, value: { recipient: "person@example.com", subject: "Hi", body: "Hello", bodyFormat: "text" } });
  });

  it("rejects a malformed recipient (FR-005)", () => {
    const result = parseEmailRequest(emailRequest({ recipient: "not-an-email" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/valid email/i);
  });

  it("rejects an empty/whitespace subject (FR-006)", () => {
    const result = parseEmailRequest(emailRequest({ subject: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/subject/i);
  });

  it("rejects an empty/whitespace body (FR-006)", () => {
    const result = parseEmailRequest(emailRequest({ body: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/body/i);
  });

  it(`rejects a subject longer than ${EMAIL_SUBJECT_MAX} chars`, () => {
    const result = parseEmailRequest(emailRequest({ subject: "a".repeat(EMAIL_SUBJECT_MAX + 1) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/200/);
  });

  it(`rejects a body longer than ${EMAIL_BODY_MAX} chars`, () => {
    const result = parseEmailRequest(emailRequest({ body: "a".repeat(EMAIL_BODY_MAX + 1) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/10000/);
  });

  it("rejects an unknown body format", () => {
    const result = parseEmailRequest(emailRequest({ bodyFormat: "markdown" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/format/i);
  });
});
