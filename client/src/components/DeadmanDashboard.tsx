import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  CHECKIN_INTERVAL_MIN_SECONDS,
  CHECKIN_INTERVAL_MAX_SECONDS,
  GRACE_PERIOD_MIN_SECONDS,
  GRACE_PERIOD_MAX_SECONDS,
} from "@ensure/shared/constants";
import {
  ApiError,
  checkin,
  getStatus,
  putConfig,
  type DeadmanStatus,
  type DeadmanEvent,
} from "../api/deadmanClient";

type Phase =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "error"; message: string };

/** Human-readable label for each switch state (FR-016 visibility). */
const STATE_LABEL: Record<DeadmanStatus["state"], string> = {
  disarmed: "Disarmed",
  active: "Active",
  grace: "Grace period",
  triggered: "Triggered",
};

/** Human-readable label for each event type. */
const EVENT_LABEL: Record<DeadmanEvent["type"], string> = {
  armed: "Armed",
  disarmed: "Disarmed",
  checkin: "Checked in",
  entered_grace: "Entered grace period",
  reminder_sent: "Reminder sent",
  triggered: "Triggered",
  config_changed: "Configuration changed",
};

/** Format a whole-second countdown as "Dd HH:MM:SS" (or "due now" when not positive). */
function formatCountdown(totalSeconds: number | null): string {
  if (totalSeconds === null) return "—";
  if (totalSeconds <= 0) return "Due now";
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${hms}` : hms;
}

/** ISO timestamp → locale string, or a dash when null. */
function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

/**
 * The dead-man switch dashboard (feature 008). Loads the caller's status, shows a labelled
 * state badge and a live countdown (role="status", aria-live="polite") while armed, a
 * label-bound interval/grace config form, an arm/disarm control with a confirm before the
 * very first arm (premature-trigger safety, FR-005), a prominent "I'm alive" check-in
 * button, and a recent-events list. Mirrors the ContactList/NoteEditor state-machine + a11y
 * patterns. No countdown runs while disarmed/triggered (US4).
 */
export function DeadmanDashboard() {
  const [status, setStatus] = useState<DeadmanStatus | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  // Form fields (seconds), seeded from the loaded status (defaults for a new switch).
  const [interval, setIntervalSeconds] = useState<number>(CHECKIN_INTERVAL_MIN_SECONDS);
  const [grace, setGraceSeconds] = useState<number>(GRACE_PERIOD_MIN_SECONDS);

  // Live countdown derived from secondsUntilDue (re-derived on each tick).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // The base for the countdown: when status loaded, secondsUntilDue + the local clock.
  const dueAtRef = useRef<number | null>(null);

  const apply = useCallback((next: DeadmanStatus) => {
    setStatus(next);
    setIntervalSeconds(next.checkinIntervalSeconds);
    setGraceSeconds(next.gracePeriodSeconds);
    if (next.secondsUntilDue !== null && (next.state === "active" || next.state === "grace")) {
      dueAtRef.current = Date.now() + next.secondsUntilDue * 1000;
      setSecondsLeft(next.secondsUntilDue);
    } else {
      dueAtRef.current = null;
      setSecondsLeft(null);
    }
  }, []);

  // Load status on mount.
  useEffect(() => {
    let active = true;
    getStatus()
      .then((s) => {
        if (!active) return;
        apply(s);
        setPhase({ kind: "idle" });
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof ApiError ? error.message : "Could not load your switch.";
        setPhase({ kind: "error", message });
      });
    return () => {
      active = false;
    };
  }, [apply]);

  // Tick the countdown once a second while there is a live deadline (US4: stops otherwise).
  useEffect(() => {
    if (dueAtRef.current === null) return;
    const id = window.setInterval(() => {
      if (dueAtRef.current === null) return;
      setSecondsLeft(Math.round((dueAtRef.current - Date.now()) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [status?.state, status?.nextCheckinDueAt, status?.graceDeadlineAt]);

  const isArmed = status?.enabled === true && status.state !== "triggered";
  // The very first arm (no prior arm event, currently disarmed) needs a confirmation.
  const isFirstArm = status?.state === "disarmed" && status.lastCheckinAt === null;

  async function submitConfig(enabled: boolean) {
    if (enabled && isFirstArm) {
      const ok = window.confirm(
        "Arm your dead-man switch? If you do not check in before each deadline, your switch " +
          "will eventually fire. You can disarm it at any time.",
      );
      if (!ok) return;
    }
    setPhase({ kind: "working" });
    try {
      const next = await putConfig({
        checkinIntervalSeconds: interval,
        gracePeriodSeconds: grace,
        enabled,
      });
      apply(next);
      setPhase({ kind: "idle" });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Could not update your switch.";
      setPhase({ kind: "error", message });
    }
  }

  async function handleArmDisarmSubmit(event: FormEvent) {
    event.preventDefault();
    // The form's submit button arms/re-configures (enabled:true).
    await submitConfig(true);
  }

  async function handleCheckin() {
    setPhase({ kind: "working" });
    try {
      const next = await checkin();
      apply(next);
      setPhase({ kind: "idle" });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Could not check in.";
      setPhase({ kind: "error", message });
    }
  }

  if (phase.kind === "loading") {
    return (
      <section aria-labelledby="deadman-heading">
        <h2 id="deadman-heading">Dead-man switch</h2>
        <p role="status" aria-live="polite">
          Loading…
        </p>
      </section>
    );
  }

  const events = status?.events ?? [];
  const busy = phase.kind === "working";

  return (
    <section aria-labelledby="deadman-heading">
      <h2 id="deadman-heading">Dead-man switch</h2>

      {/* State badge + live countdown. */}
      <div className="deadman-status">
        <p>
          Status:{" "}
          <span
            className={`deadman-badge deadman-badge--${status?.state ?? "disarmed"}`}
            data-testid="deadman-state"
          >
            {STATE_LABEL[status?.state ?? "disarmed"]}
          </span>
        </p>
        {isArmed ? (
          <p className="deadman-countdown" role="status" aria-live="polite">
            <span className="meta">
              {status?.state === "grace" ? "Grace ends in" : "Next check-in due in"}:
            </span>{" "}
            <span data-testid="deadman-countdown">{formatCountdown(secondsLeft)}</span>
          </p>
        ) : null}
      </div>

      {/* Big "I'm alive" check-in button — only meaningful while armed. */}
      {status && (status.state === "active" || status.state === "grace") ? (
        <button
          type="button"
          className="button deadman-checkin"
          onClick={() => void handleCheckin()}
          disabled={busy}
        >
          {busy ? "Checking in…" : "I'm alive — check in"}
        </button>
      ) : null}

      {status?.state === "triggered" ? (
        <p className="status status--error" role="alert">
          Your switch has already fired. It can no longer be checked in.
        </p>
      ) : null}

      {/* Config form. */}
      <form onSubmit={handleArmDisarmSubmit} className="deadman-config">
        <h3>Configuration</h3>

        <label htmlFor="deadman-interval">Check-in interval (seconds)</label>
        <input
          id="deadman-interval"
          type="number"
          value={interval}
          min={CHECKIN_INTERVAL_MIN_SECONDS}
          max={CHECKIN_INTERVAL_MAX_SECONDS}
          step={1}
          aria-describedby="deadman-interval-help"
          onChange={(e) => setIntervalSeconds(Number(e.target.value))}
          disabled={busy}
        />
        <p id="deadman-interval-help" className="meta">
          Between 1 hour ({CHECKIN_INTERVAL_MIN_SECONDS}s) and 365 days (
          {CHECKIN_INTERVAL_MAX_SECONDS}s).
        </p>

        <label htmlFor="deadman-grace">Grace period (seconds)</label>
        <input
          id="deadman-grace"
          type="number"
          value={grace}
          min={GRACE_PERIOD_MIN_SECONDS}
          max={GRACE_PERIOD_MAX_SECONDS}
          step={1}
          aria-describedby="deadman-grace-help"
          onChange={(e) => setGraceSeconds(Number(e.target.value))}
          disabled={busy}
        />
        <p id="deadman-grace-help" className="meta">
          Between 1 hour ({GRACE_PERIOD_MIN_SECONDS}s) and 30 days ({GRACE_PERIOD_MAX_SECONDS}s).
        </p>

        <div className="deadman-actions">
          <button type="submit" className="button" disabled={busy}>
            {isArmed ? "Save & re-arm" : "Arm switch"}
          </button>
          {isArmed ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void submitConfig(false)}
              disabled={busy}
            >
              Disarm
            </button>
          ) : null}
        </div>
      </form>

      {phase.kind === "error" ? (
        <p className="status status--error" role="alert">
          {phase.message}
        </p>
      ) : (
        <p className="status" role="status" aria-live="polite" />
      )}

      {/* Recent events (US3). */}
      <section aria-labelledby="deadman-events-heading" className="deadman-events">
        <h3 id="deadman-events-heading">Recent activity</h3>
        {events.length === 0 ? (
          <p className="meta">No activity yet.</p>
        ) : (
          <ul className="deadman-event-list">
            {events.map((ev) => (
              <li key={ev.id} className="deadman-event-list__item">
                <span className="deadman-event-list__type">{EVENT_LABEL[ev.type]}</span>{" "}
                <span className="meta">{formatTime(ev.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
