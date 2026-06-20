/**
 * Maximum allowed length of a note, in characters (per spec FR-008 / data-model.md).
 * Shared so the client and server enforce the same limit.
 */
export const NOTE_MAX_LENGTH = 10000;

/**
 * Maximum allowed length of a contact value, in characters (spec FR-014). 320 is the
 * practical maximum length of an email address (64-char local part + "@" + 255-char
 * domain). Shared so the client and server enforce the same limit.
 */
export const CONTACT_MAX_LENGTH = 320;

/**
 * Maximum number of contacts a single user may store (spec FR-015). Shared so the
 * client can disable the add control at the cap and the server can reject the 51st.
 */
export const CONTACT_LIMIT = 50;

/**
 * Dead-man switch check-in interval bounds, in seconds (feature 008, FR-003/FR-021).
 * Minimum 1 hour, maximum 365 days. Shared so the client form and the server validation
 * enforce identical limits.
 */
export const CHECKIN_INTERVAL_MIN_SECONDS = 3600; // 1 hour
export const CHECKIN_INTERVAL_MAX_SECONDS = 31_536_000; // 365 days

/**
 * Dead-man switch grace-period bounds, in seconds (feature 008, FR-003/FR-021).
 * Minimum 1 hour, maximum 30 days.
 */
export const GRACE_PERIOD_MIN_SECONDS = 3600; // 1 hour
export const GRACE_PERIOD_MAX_SECONDS = 2_592_000; // 30 days

/**
 * Generous defaults that bias strongly against premature triggering (feature 008):
 * a 7-day check-in interval and a 2-day grace period. Pre-filled in the dashboard form
 * for a never-configured switch.
 */
export const DEADMAN_DEFAULT_INTERVAL_SECONDS = 604_800; // 7 days
export const DEADMAN_DEFAULT_GRACE_SECONDS = 172_800; // 2 days

/**
 * Maximum number of grace reminders sent to the user's own email across a single grace
 * window (feature 008, FR-011). Capped so the user is reminded but not spammed.
 */
export const DEADMAN_MAX_GRACE_REMINDERS = 3;
