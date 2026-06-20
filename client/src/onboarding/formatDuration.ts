/**
 * Feature 012 — presentation-only duration formatter for the wizard's interval/grace step and the
 * help text. Renders a whole-second count as a single, human-readable unit label (e.g. "7 days",
 * "1 hour", "2 days"). This changes NO timing semantics — it only labels existing seconds values.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 seconds";
  const units: [label: string, size: number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
  ];
  for (const [label, size] of units) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${label}${n === 1 ? "" : "s"}`;
    }
  }
  // Non-exact: fall back to the largest whole unit (e.g. "1 day" for 90000s, rounded down).
  for (const [label, size] of units) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${label}${n === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
}
