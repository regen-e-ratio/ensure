import type { RequestHandler } from "express";

/**
 * A tiny in-process fixed-window rate limiter (feature 010, FR-011) — no dependency. It throttles
 * requests per key (the client IP by default) over a fixed window: at most `max` requests per
 * `windowMs`; the (max+1)th in a window gets a 429 with a generic message. Counters are kept in a
 * Map and lazily reset when a key's window elapses. This is deliberately simple (KISS): single
 * process, small scale; it is not a distributed limiter. Used to blunt brute-force enumeration of
 * the public release-token endpoint without affecting a normal single open.
 */
export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per key within a window. */
  max: number;
  /** Derive the throttle key from the request (default: client IP). */
  keyOf?: (ip: string) => string;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

interface Counter {
  count: number;
  resetAt: number;
}

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  const { windowMs, max } = options;
  const now = options.now ?? (() => Date.now());
  const keyOf = options.keyOf ?? ((ip: string) => ip);
  const counters = new Map<string, Counter>();

  return (req, res, next) => {
    const key = keyOf(req.ip ?? "unknown");
    const t = now();
    const existing = counters.get(key);

    if (!existing || t >= existing.resetAt) {
      counters.set(key, { count: 1, resetAt: t + windowMs });
      next();
      return;
    }

    if (existing.count >= max) {
      res
        .status(429)
        .json({ error: "RATE_LIMITED", message: "Too many requests. Please try again later." });
      return;
    }

    existing.count += 1;
    next();
  };
}
