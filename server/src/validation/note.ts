import { z } from "zod";
import { NOTE_MAX_LENGTH } from "@ensure/shared/constants";

const noteInputSchema = z.object({
  text: z
    .string({
      required_error: "Note text is required.",
      invalid_type_error: "Note text is required.",
    })
    .max(NOTE_MAX_LENGTH, `Note text must be at most ${NOTE_MAX_LENGTH} characters.`)
    .refine((value) => value.trim().length > 0, { message: "Note text is required." }),
});

export type ParseResult = { ok: true; text: string } | { ok: false; message: string };

/**
 * Validate a PUT /api/note body. On success returns the verbatim text (FR-009);
 * on failure returns a single user-displayable message (FR-004, FR-008).
 */
export function parseNoteInput(body: unknown): ParseResult {
  const result = noteInputSchema.safeParse(body);
  if (result.success) {
    return { ok: true, text: result.data.text };
  }
  const message = result.error.issues[0]?.message ?? "Note text is invalid.";
  return { ok: false, message };
}
