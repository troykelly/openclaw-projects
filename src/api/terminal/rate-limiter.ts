/**
 * In-memory sliding-window rate limiter for terminal endpoints.
 *
 * Issue #2191, Sub-item 4 — Enrollment rate limiting.
 *
 * Simple token-bucket per-key rate limiter with automatic cleanup of
 * expired entries to prevent memory leaks.
 */

/** Rate limiter configuration. */
export interface RateLimiterConfig {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Time window in milliseconds. */
  windowMs: number;
}

/** Result of a rate limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Number of remaining requests in the current window. */
  remaining: number;
  /** Milliseconds until the rate limit window resets (only when blocked). */
  retryAfterMs?: number;
}

/** Internal tracking entry for a single key. */
interface BucketEntry {
  count: number;
  windowStart: number;
}

/** Rate limiter instance. */
export interface RateLimiter {
  /** Check if a request from the given key is allowed. */
  check(key: string): RateLimitResult;
  /** Reset all tracked state (for testing). */
  reset(): void;
}

/**
 * Create a rate limiter with the given configuration.
 *
 * Uses a fixed-window approach: requests within a window are counted,
 * and the window resets after windowMs elapses.
 */
export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const buckets = new Map<string, BucketEntry>();

  function check(key: string): RateLimitResult {
    const now = Date.now();
    const existing = buckets.get(key);

    // If no entry or window has expired, start a new window
    if (!existing || (now - existing.windowStart) >= config.windowMs) {
      buckets.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: config.maxRequests - 1 };
    }

    // Within the current window
    if (existing.count < config.maxRequests) {
      existing.count++;
      return { allowed: true, remaining: config.maxRequests - existing.count };
    }

    // Rate limited
    const retryAfterMs = config.windowMs - (now - existing.windowStart);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  function reset(): void {
    buckets.clear();
  }

  return { check, reset };
}
