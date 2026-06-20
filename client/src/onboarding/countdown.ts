/**
 * Feature 012 (US4) — presentation-only countdown formatting extracted from the feature-008
 * dashboard and refined for legibility + screen readers. This module changes NO timing semantics:
 * it formats an already-derived "seconds remaining" value (computed from the absolute deadline) and
 * does not alter the clock, the deadline, or any endpoint contract (FR-010).
 */

/** The formatted countdown: a compact visible label, a verbose screen-reader phrase, and urgency. */
export interface FormattedCountdown {
  /** Compact, tabular visible label, e.g. "2d 03:04:05", "03:04:05", or "Due now". */
  display: string;
  /** Verbose, screen-reader-friendly phrase, e.g. "2 days, 3 hours, 4 minutes remaining". */
  screenReader: string;
  /**
   * Urgency tier used to convey importance WITHOUT relying on colour alone (a text label + an icon
   * accompany it in the UI): `none` when there is no live deadline, `normal` otherwise, `due` once
   * the deadline has passed. Callers add a textual/non-colour cue per tier.
   */
  urgency: "none" | "normal" | "due";
}

function unitPhrase(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * Format a whole-second countdown. `null` means there is no live deadline (disarmed/triggered);
 * a non-positive value means the deadline has passed ("Due now"). The visible label stays compact
 * and tabular ("2d 03:04:05"); the screen-reader phrase spells the largest two non-zero units in
 * words so a screen reader announces something legible rather than a colon-packed string.
 */
export function formatCountdown(totalSeconds: number | null): FormattedCountdown {
  if (totalSeconds === null) {
    return { display: "—", screenReader: "No deadline", urgency: "none" };
  }
  if (totalSeconds <= 0) {
    return { display: "Due now", screenReader: "Due now", urgency: "due" };
  }

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  const display = days > 0 ? `${days}d ${hms}` : hms;

  // Spell the two largest non-zero units for the screen reader (legible, not a colon string).
  const parts: string[] = [];
  if (days > 0) parts.push(unitPhrase(days, "day"));
  if (hours > 0) parts.push(unitPhrase(hours, "hour"));
  if (minutes > 0) parts.push(unitPhrase(minutes, "minute"));
  if (seconds > 0) parts.push(unitPhrase(seconds, "second"));
  const spoken = parts.slice(0, 2).join(", ");
  const screenReader = `${spoken} remaining`;

  return { display, screenReader, urgency: "normal" };
}
