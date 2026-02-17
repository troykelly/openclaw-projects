/**
 * Rate limiter for injection detection logging.
 *
 * Prevents log flooding when an attacker sends many injection-containing
 * messages. Logs the first N detections per key (sender/user_id) per window,
 * then samples at a configurable rate. Emits summary entries for suppressed
 * counts when a new window begins.
 *
 * Memory-bounded via maxEntries with LRU eviction of oldest keys.
 *
 * Issue #1257
 */

/** Configuration for the injection log rate limiter */
export interface InjectionLogRateLimiterConfig {
  /** Sliding window duration in milliseconds */
  windowMs: number;
  /** Maximum number of log entries allowed per key per window before sampling */
  maxLogsPerWindow: number;
  /** Probability (0-1) of logging after exceeding maxLogsPerWindow */
  sampleRate: number;
  /** Maximum number of tracked key entries (LRU eviction when exceeded) */
  maxEntries: number;
}

/** Result of a shouldLog check */
export interface InjectionLogResult {
  /** Whether this detection should be logged */
  log: boolean;
  /** Number of suppressed detections (in the current or previous window) */
  suppressed: number;
  /** Whether this is a summary entry reporting prior-window suppressions */
  summary: boolean;
}

/** Stats about the rate limiter's current state */
export interface InjectionLogRateLimiterStats {
  /** Number of currently tracked keys */
  activeKeys: number;
  /** Total number of suppressed detections across all keys */
  totalSuppressed: number;
}

/** Default configuration */
export const DEFAULT_INJECTION_LOG_RATE_LIMITER_CONFIG: InjectionLogRateLimiterConfig = {
  windowMs: 60_000,
  maxLogsPerWindow: 10,
  sampleRate: 0.1,
  maxEntries: 10_000,
};

/** Internal state per tracked key */
interface KeyState {
  /** Timestamp of the window start */
  windowStart: number;
  /** Number of detections logged in current window */
  logCount: number;
  /** Number of detections suppressed in current window */
  suppressedCount: number;
  /** Last activity timestamp (for LRU eviction) */
  lastSeen: number;
}

/** Injection log rate limiter instance */
export interface InjectionLogRateLimiter {
  /** Check whether a detection for the given key should be logged */
  shouldLog(key: string): InjectionLogResult;
  /** Get current stats */
  getStats(): InjectionLogRateLimiterStats;
}

/**
 * Create a new injection log rate limiter.
 *
 * @param config - Configuration overrides (defaults to DEFAULT_INJECTION_LOG_RATE_LIMITER_CONFIG)
 * @param randomFn - Optional random function for testing (defaults to Math.random)
 */
export function createInjectionLogRateLimiter(
  config: InjectionLogRateLimiterConfig = DEFAULT_INJECTION_LOG_RATE_LIMITER_CONFIG,
  randomFn: () => number = Math.random,
): InjectionLogRateLimiter {
  const entries = new Map<string, KeyState>();

  function now(): number {
    return Date.now();
  }

  function evictIfNeeded(): void {
    if (entries.size <= config.maxEntries) return;

    // Sort by lastSeen ascending (oldest first), evict until at maxEntries
    const sorted = [...entries.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    const toEvict = sorted.length - config.maxEntries;
    for (let i = 0; i < toEvict; i++) {
      entries.delete(sorted[i][0]);
    }
  }

  function shouldLog(key: string): InjectionLogResult {
    const currentTime = now();
    const existing = entries.get(key);

    // Check if we need to start a new window
    if (existing && currentTime - existing.windowStart >= config.windowMs) {
      // Window expired — check if there were suppressions to report
      const previousSuppressed = existing.suppressedCount;

      // Reset to new window
      existing.windowStart = currentTime;
      existing.logCount = 1;
      existing.suppressedCount = 0;
      existing.lastSeen = currentTime;

      if (previousSuppressed > 0) {
        // Emit a summary log entry reporting previous window suppressions
        return { log: true, suppressed: previousSuppressed, summary: true };
      }

      // Normal first log in new window, no summary needed
      return { log: true, suppressed: 0, summary: false };
    }

    if (!existing) {
      // First detection for this key
      entries.set(key, {
        windowStart: currentTime,
        logCount: 1,
        suppressedCount: 0,
        lastSeen: currentTime,
      });

      evictIfNeeded();
      return { log: true, suppressed: 0, summary: false };
    }

    // Within the same window
    existing.lastSeen = currentTime;

    if (existing.logCount < config.maxLogsPerWindow) {
      // Still under the limit
      existing.logCount++;
      return { log: true, suppressed: 0, summary: false };
    }

    // Over the limit — apply sampling
    existing.suppressedCount++;

    if (config.sampleRate > 0 && randomFn() < config.sampleRate) {
      // Sampled in — log it
      existing.logCount++;
      return { log: true, suppressed: existing.suppressedCount, summary: false };
    }

    // Suppressed
    return { log: false, suppressed: existing.suppressedCount, summary: false };
  }

  function getStats(): InjectionLogRateLimiterStats {
    let totalSuppressed = 0;
    for (const state of entries.values()) {
      totalSuppressed += state.suppressedCount;
    }
    return {
      activeKeys: entries.size,
      totalSuppressed,
    };
  }

  return { shouldLog, getStats };
}

/**
 * Shared singleton rate limiter for injection detection logging.
 * All callsites in the plugin share this instance so that rate limiting
 * is coordinated across tools and hooks within the same process.
 */
export const injectionLogLimiter = createInjectionLogRateLimiter();
