import type { Db } from "../db/index";
import { runDeadmanTick, type Deps } from "./engine";

/**
 * Options for the in-process driver. `tickMs` is the interval; `disabled` (from
 * `DEADMAN_TICK_DISABLED=1`) turns the timer off entirely — tests set it so the engine is
 * driven explicitly via `runDeadmanTick` and never fires non-deterministically (FR-015).
 */
export interface DriverOptions {
  tickMs: number;
  disabled: boolean;
}

/**
 * Start the in-process liveness timer (FR-015). When `disabled`, it does nothing and
 * returns a no-op stop function — so under `DEADMAN_TICK_DISABLED=1` no timer ever runs.
 * Otherwise it (1) runs a one-shot **boot-recovery** tick immediately, so a switch whose
 * deadline lapsed while the process was down is evaluated on startup (FR-014), and (2)
 * schedules a recurring tick every `tickMs`. Each tick is wrapped so a thrown error never
 * crashes the process. Returns a function that stops the timer.
 */
export function startDeadmanTimer(db: Db, deps: Deps, options: DriverOptions): () => void {
  if (options.disabled) {
    return () => {};
  }

  const tick = (): void => {
    void runDeadmanTick(db, deps, deps.now()).catch((err) => {
      // Never let a tick failure crash the process; the next tick retries.
      console.error("deadman tick failed:", err instanceof Error ? err.message : err);
    });
  };

  // Boot recovery: evaluate due switches immediately on startup.
  tick();

  const handle = setInterval(tick, options.tickMs);
  // Don't keep the event loop alive solely for the timer.
  if (typeof handle.unref === "function") handle.unref();

  return () => clearInterval(handle);
}
