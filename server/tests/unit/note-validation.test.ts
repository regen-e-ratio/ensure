import { describe, it, expect } from "vitest";
import { NOTE_MAX_LENGTH } from "@ensure/shared/constants";
import { parseNoteInput } from "../../src/validation/note";

describe("parseNoteInput", () => {
  it("accepts non-empty text and returns it verbatim", () => {
    const result = parseNoteInput({ text: "  hello\nworld  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("  hello\nworld  ");
  });

  it("rejects empty text (FR-004)", () => {
    const result = parseNoteInput({ text: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/required/i);
  });

  it("rejects whitespace-only text (FR-004)", () => {
    const result = parseNoteInput({ text: "   \n\t " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/required/i);
  });

  it(`rejects text longer than ${NOTE_MAX_LENGTH} characters (FR-008)`, () => {
    const result = parseNoteInput({ text: "a".repeat(NOTE_MAX_LENGTH + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/10000/);
  });

  it(`accepts text exactly ${NOTE_MAX_LENGTH} characters`, () => {
    const result = parseNoteInput({ text: "a".repeat(NOTE_MAX_LENGTH) });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing or non-string text field", () => {
    expect(parseNoteInput({}).ok).toBe(false);
    expect(parseNoteInput({ text: 42 }).ok).toBe(false);
  });
});
