import { describe, it, expect } from "vitest";
import { parseContactInput } from "../../src/validation/contact";
import { CONTACT_MAX_LENGTH } from "@ensure/shared/constants";

describe("parseContactInput", () => {
  it("accepts a valid email and returns the trimmed value with original case (FR-013)", () => {
    const result = parseContactInput({ type: "email", value: "  Alice@Example.com  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.type).toBe("email");
      expect(result.value).toBe("Alice@Example.com");
    }
  });

  it("rejects a missing value (FR-007)", () => {
    const result = parseContactInput({ type: "email" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/required/i);
  });

  it("rejects an empty / whitespace-only value (FR-007)", () => {
    const result = parseContactInput({ type: "email", value: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/required/i);
  });

  it("rejects a malformed email (FR-007)", () => {
    const result = parseContactInput({ type: "email", value: "not-an-email" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/valid email/i);
  });

  it("rejects a non-email type (FR-006)", () => {
    const result = parseContactInput({ type: "phone", value: "+15555550123" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/only email/i);
  });

  it(`rejects a value longer than ${CONTACT_MAX_LENGTH} characters (FR-014)`, () => {
    const longLocal = "a".repeat(CONTACT_MAX_LENGTH);
    const result = parseContactInput({ type: "email", value: `${longLocal}@example.com` });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/at most 320/i);
  });
});
