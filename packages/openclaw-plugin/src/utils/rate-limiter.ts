/**
 * Sliding window rate limiter for inbound message processing.
 *
 * Provides per-sender and per-recipient rate limiting with
 * contact-trust-level awareness. Uses in-memory sliding window
 * with automatic cleanup of expired entries.
 *
 * NOTE: State is in-memory and does not persist across process restarts
 * or span multiple instances. For multi-instance deployments, a
 * skill_store-backed implementation would be needed to share rate
 * limit state across processes.
 *
 * Part of Issue #1225 — rate limiting and spam protection.
 */

import { normalizeSender, type MessageChannel } from './spam-filter.js';

/** Trust levels for sender classification */
export type SenderTrust = 'trusted' | 'known' | 'unknown' | 'blocked';

/** Configuration for the rate limiter */
export interface RateLimiterConfig {
  /** Max messages per window for trusted senders (active thread, replied) */
  trustedSenderLimit: number;
  /** Max messages per window for known contacts */
  knownSenderLimit: number;
  /** Max messages per window for unknown senders */
  unknownSenderLimit: number;
  /** Global max messages per window for a single recipient */
  recipientGlobalLimit: number;
  /** Sliding window duration in milliseconds */
  windowMs: number;
  /**
   * Maximum number of tracked sender entries before forced eviction.
   * Prevents unbounded memory growth if traffic burst creates many keys
   * and then stops (entries would persist until the next cleanup cycle).
   * When exceeded, the oldest entries are evicted during the next check.
   */
  maxSenderEntries?: number;
}

/** Result of a rate limit check */
export interface RateLimitResult {
  /** Whether the message is allowed */
  allowed: boolean;
  /** Human-readable reason if denied, null if allowed */
  reason: string | null;
  /** Messages remaining in current window */
  remaining: number;
  /** The limit that applies to this sender */
  limit: number;
  /** Milliseconds until the earliest entry expires (for retry-after) */
  retryAfterMs: number | null;
}

/** Statistics about the rate limiter state */
export interface RateLimiterStats {
  /** Number of currently tracked senders */
  activeSenders: number;
  /** Number of currently tracked recipients */
  activeRecipients: number;
}

/** Rate limiter instance */
export interface RateLimiter {
  /**
   * Check if a message is allowed and record it if so.
   * Sender and recipient are normalized for consistent matching
   * (phone number formatting, email alias stripping).
   */
  check(sender: string, recipient: string, trust: SenderTrust, channel?: MessageChannel): RateLimitResult;
  /** Get current stats about the limiter */
  getStats(): RateLimiterStats;
}

/** Default rate limiter configuration */
export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  trustedSenderLimit: 100,
  knownSenderLimit: 50,
  unknownSenderLimit: 5,
  recipientGlobalLimit: 200,
  windowMs: 3_600_000, // 1 hour
  maxSenderEntries: 10_000,
};

/** Interval for running cleanup of expired entries */
const CLEANUP_INTERVAL_CHECKS = 100;

/**
 * Create a rate limiter instance.
 *
 * Uses a sliding window approach: each message records a timestamp,
 * and only timestamps within the current window are counted.
 *
 * @param config - Rate limiter configuration (uses defaults if omitted)
 * @returns RateLimiter instance
 */
export function createRateLimiter(config: RateLimiterConfig = DEFAULT_RATE_LIMITER_CONFIG): RateLimiter {
  /** Map of sender -> array of message timestamps */
  const senderWindows = new Map<string, number[]>();
  /** Map of recipient -> array of message timestamps */
  const recipientWindows = new Map<string, number[]>();
  /** Counter for triggering periodic cleanup */
  let checkCount = 0;

  /**
   * Get the rate limit for a given trust level.
   */
  function getLimitForTrust(trust: SenderTrust): number {
    switch (trust) {
      case 'trusted':
        return config.trustedSenderLimit;
      case 'known':
        return config.knownSenderLimit;
      case 'unknown':
        return config.unknownSenderLimit;
      case 'blocked':
        return 0;
    }
  }

  /**
   * Prune timestamps older than the window from an array.
   * Returns only timestamps within the current window.
   */
  function pruneWindow(timestamps: number[], now: number): number[] {
    const cutoff = now - config.windowMs;
    return timestamps.filter((ts) => ts > cutoff);
  }

  /**
   * Clean up expired entries from all windows.
   */
  function cleanup(now: number): void {
    for (const [key, timestamps] of senderWindows) {
      const pruned = pruneWindow(timestamps, now);
      if (pruned.length === 0) {
        senderWindows.delete(key);
      } else {
        senderWindows.set(key, pruned);
      }
    }

    for (const [key, timestamps] of recipientWindows) {
      const pruned = pruneWindow(timestamps, now);
      if (pruned.length === 0) {
        recipientWindows.delete(key);
      } else {
        recipientWindows.set(key, pruned);
      }
    }
  }

  /**
   * Evict oldest sender entries when max capacity is exceeded.
   * Prevents unbounded memory growth from traffic bursts that create
   * many keys and then stop before the next cleanup cycle runs.
   *
   * TODO: This only evicts senderWindows, not recipientWindows. In practice
   * recipientWindows is bounded by the number of distinct recipients (typically
   * small), but a similar cap should be added if this assumption changes.
   */
  function evictIfOverCapacity(): void {
    const maxEntries = config.maxSenderEntries ?? 10_000;
    if (senderWindows.size <= maxEntries) {
      return;
    }

    // Find entries with the oldest most-recent timestamp and evict them
    const entries = Array.from(senderWindows.entries()).map(([key, timestamps]) => ({
      key,
      newestTs: timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0,
    }));
    entries.sort((a, b) => a.newestTs - b.newestTs);

    const toEvict = senderWindows.size - maxEntries;
    for (let i = 0; i < toEvict; i++) {
      senderWindows.delete(entries[i].key);
    }
  }

  return {
    check(sender: string, recipient: string, trust: SenderTrust, channel?: MessageChannel): RateLimitResult {
      const now = Date.now();
      checkCount++;

      // Periodic cleanup and eviction to prevent memory leaks
      if (checkCount % CLEANUP_INTERVAL_CHECKS === 0) {
        cleanup(now);
        evictIfOverCapacity();
      }

      const limit = getLimitForTrust(trust);

      // Blocked senders are always denied
      if (trust === 'blocked') {
        return {
          allowed: false,
          reason: 'sender is blocked (zero rate limit)',
          remaining: 0,
          limit: 0,
          retryAfterMs: null,
        };
      }

      // Normalize sender/recipient for consistent tracking across format variants
      const ch = channel ?? (sender.includes('@') ? 'email' : 'sms');
      const senderKey = normalizeSender(sender, ch);
      let senderTimestamps = senderWindows.get(senderKey) ?? [];
      senderTimestamps = pruneWindow(senderTimestamps, now);

      if (senderTimestamps.length >= limit) {
        // Calculate retry-after from the oldest entry in window
        const oldestTs = senderTimestamps[0];
        const retryAfterMs = oldestTs + config.windowMs - now;

        return {
          allowed: false,
          reason: `per-sender rate limit exceeded (${senderTimestamps.length}/${limit} in window)`,
          remaining: 0,
          limit,
          retryAfterMs: Math.max(0, retryAfterMs),
        };
      }

      // Check per-recipient global limit
      const recipientCh = channel ?? (recipient.includes('@') ? 'email' : 'sms');
      const recipientKey = normalizeSender(recipient, recipientCh);
      let recipientTimestamps = recipientWindows.get(recipientKey) ?? [];
      recipientTimestamps = pruneWindow(recipientTimestamps, now);

      if (recipientTimestamps.length >= config.recipientGlobalLimit) {
        const oldestTs = recipientTimestamps[0];
        const retryAfterMs = oldestTs + config.windowMs - now;

        return {
          allowed: false,
          reason: `global recipient rate limit exceeded (${recipientTimestamps.length}/${config.recipientGlobalLimit} in window)`,
          remaining: 0,
          limit: config.recipientGlobalLimit,
          retryAfterMs: Math.max(0, retryAfterMs),
        };
      }

      // Message is allowed — record it
      senderTimestamps.push(now);
      senderWindows.set(senderKey, senderTimestamps);

      recipientTimestamps.push(now);
      recipientWindows.set(recipientKey, recipientTimestamps);

      return {
        allowed: true,
        reason: null,
        remaining: limit - senderTimestamps.length,
        limit,
        retryAfterMs: null,
      };
    },

    getStats(): RateLimiterStats {
      return {
        activeSenders: senderWindows.size,
        activeRecipients: recipientWindows.size,
      };
    },
  };
}
