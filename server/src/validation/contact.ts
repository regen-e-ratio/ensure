import { z } from "zod";
import { CONTACT_MAX_LENGTH } from "@ensure/shared/constants";

/**
 * Validate a POST /api/contact body. Only `type: "email"` is accepted in this release
 * (FR-006); the value must be a well-formed email (FR-007), non-empty after trimming,
 * and at most CONTACT_MAX_LENGTH characters (FR-014). The value is trimmed but its case
 * is preserved (FR-013) — normalization for de-duplication happens in the repo.
 */
const contactInputSchema = z.object({
  type: z.literal("email"),
  value: z
    .string({
      required_error: "Email is required.",
      invalid_type_error: "Email is required.",
    })
    .trim()
    .min(1, "Email is required.")
    .max(CONTACT_MAX_LENGTH, `Email must be at most ${CONTACT_MAX_LENGTH} characters.`)
    .email("Enter a valid email address."),
});

export type ContactType = z.infer<typeof contactInputSchema>["type"];

export type ParseResult =
  | { ok: true; type: ContactType; value: string }
  | { ok: false; message: string };

/**
 * Parse and validate a contact input body. On success returns the canonical `type` and
 * the trimmed `value` (original case preserved). On failure returns a single
 * user-displayable message (the route maps this to 400 VALIDATION_ERROR).
 */
export function parseContactInput(body: unknown): ParseResult {
  const result = contactInputSchema.safeParse(body);
  if (result.success) {
    return { ok: true, type: result.data.type, value: result.data.value };
  }
  const issue = result.error.issues[0];
  // The only non-self-describing failure is an unsupported `type` literal.
  const message =
    issue?.path[0] === "type"
      ? "Only email contacts are supported."
      : (issue?.message ?? "That contact is invalid.");
  return { ok: false, message };
}
