import { z } from "zod";
import {
  CHECKIN_INTERVAL_MIN_SECONDS,
  CHECKIN_INTERVAL_MAX_SECONDS,
  GRACE_PERIOD_MIN_SECONDS,
  GRACE_PERIOD_MAX_SECONDS,
} from "@ensure/shared/constants";

/**
 * Validate a PUT /api/deadman/config body (FR-003, FR-021): `checkinIntervalSeconds` and
 * `gracePeriodSeconds` must be integers within the shared bounds, and `enabled` must be a
 * boolean. The same bounds back the client form so both sides enforce one source of truth.
 */
const configInputSchema = z.object({
  checkinIntervalSeconds: z
    .number({
      required_error: "Check-in interval is required.",
      invalid_type_error: "Check-in interval is required.",
    })
    .int("Check-in interval must be a whole number of seconds.")
    .min(CHECKIN_INTERVAL_MIN_SECONDS, "Check-in interval is out of range.")
    .max(CHECKIN_INTERVAL_MAX_SECONDS, "Check-in interval is out of range."),
  gracePeriodSeconds: z
    .number({
      required_error: "Grace period is required.",
      invalid_type_error: "Grace period is required.",
    })
    .int("Grace period must be a whole number of seconds.")
    .min(GRACE_PERIOD_MIN_SECONDS, "Grace period is out of range.")
    .max(GRACE_PERIOD_MAX_SECONDS, "Grace period is out of range."),
  enabled: z.boolean({
    required_error: "Enabled is required.",
    invalid_type_error: "Enabled is required.",
  }),
});

export type DeadmanConfigInput = z.infer<typeof configInputSchema>;

export type ParseResult =
  | { ok: true; value: DeadmanConfigInput }
  | { ok: false; message: string };

/**
 * Parse and validate a config input body. On success returns the typed input; on failure
 * returns a single user-displayable message (the route maps this to 400 VALIDATION_ERROR),
 * mirroring `validation/contact.ts`.
 */
export function parseDeadmanConfigInput(body: unknown): ParseResult {
  const result = configInputSchema.safeParse(body);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const message = result.error.issues[0]?.message ?? "The configuration is invalid.";
  return { ok: false, message };
}
