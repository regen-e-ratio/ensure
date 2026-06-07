import { z } from "zod";
import type { NotificationRequest } from "./types";

/** Email field limits (clarified in spec: subject ≤ 200, body ≤ 10 000). */
export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_BODY_MAX = 10_000;

/** Validated Email payload (FR-005, FR-006). Values are trimmed. */
export interface ValidatedEmail {
  recipient: string;
  subject: string;
  body: string;
  bodyFormat: "text" | "html";
}

const emailSchema = z.object({
  recipient: z
    .string({ required_error: "Recipient is required.", invalid_type_error: "Recipient is required." })
    .trim()
    .min(1, "Recipient is required.")
    .email("Recipient must be a valid email address."),
  subject: z
    .string({ required_error: "Subject is required.", invalid_type_error: "Subject is required." })
    .trim()
    .min(1, "Subject is required.")
    .max(EMAIL_SUBJECT_MAX, `Subject must be at most ${EMAIL_SUBJECT_MAX} characters.`),
  body: z
    .string({ required_error: "Body is required.", invalid_type_error: "Body is required." })
    .trim()
    .min(1, "Body is required.")
    .max(EMAIL_BODY_MAX, `Body must be at most ${EMAIL_BODY_MAX} characters.`),
  bodyFormat: z.enum(["text", "html"], {
    errorMap: () => ({ message: "Body format must be 'text' or 'html'." }),
  }),
});

export type ParseResult =
  | { ok: true; value: ValidatedEmail }
  | { ok: false; message: string };

/**
 * Validate an Email notification request (recipient + content) before any delivery is
 * attempted (FR-006). Returns the first user-displayable message on failure.
 */
export function parseEmailRequest(request: NotificationRequest): ParseResult {
  const content =
    request.content && typeof request.content === "object" ? (request.content as Record<string, unknown>) : {};
  const result = emailSchema.safeParse({ recipient: request.recipient, ...content });
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const message = result.error.issues[0]?.message ?? "The request is invalid.";
  return { ok: false, message };
}
