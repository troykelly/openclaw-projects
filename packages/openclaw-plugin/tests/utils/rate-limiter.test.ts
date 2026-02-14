/**
 * Tests for rate limiting utility.
 * Covers per-sender and per-recipient sliding window rate limits
 * with contact-trust-level awareness.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createRateLimiter,
  type RateLimiterConfig,
  type SenderTrust,
  DEFAULT_RATE_LIMITER_CONFIG,
} from '../../src/utils/rate-limiter.js';

describe('rate-limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('per-sender rate limiting', () => {
    it('should allow messages under the limit for known contacts', () => {
      const limiter = createRateLimiter();
      const trust: SenderTrust = 'known';

      const result = limiter.check('sender@example.com', 'recipient@example.com', trust);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it('should allow messages under the limit for unknown senders', () => {
      const limiter = createRateLimiter();
      const trust: SenderTrust = 'unknown';

      const result = limiter.check('+15551234567', 'recipient@example.com', trust);
      expect(result.allowed).toBe(true);
    });

    it('should block messages from blocked senders', () => {
      const limiter = createRateLimiter();
      const trust: SenderTrust = 'blocked';

      const result = limiter.check('blocked@evil.com', 'recipient@example.com', trust);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('should rate-limit unknown senders after threshold', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        unknownSenderLimit: 3,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);
      const trust: SenderTrust = 'unknown';

      // First 3 should pass
      for (let i = 0; i < 3; i++) {
        const result = limiter.check('unknown@sender.com', 'me@example.com', trust);
        expect(result.allowed).toBe(true);
      }

      // 4th should be rate-limited
      const result = limiter.check('unknown@sender.com', 'me@example.com', trust);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('rate limit');
    });

    it('should rate-limit known contacts at a higher threshold', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        knownSenderLimit: 5,
        unknownSenderLimit: 2,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      // Known can send 5
      for (let i = 0; i < 5; i++) {
        const result = limiter.check('known@friend.com', 'me@example.com', 'known');
        expect(result.allowed).toBe(true);
      }
      // 6th is blocked
      expect(limiter.check('known@friend.com', 'me@example.com', 'known').allowed).toBe(false);

      // Unknown can only send 2
      for (let i = 0; i < 2; i++) {
        const result = limiter.check('unknown@stranger.com', 'me@example.com', 'unknown');
        expect(result.allowed).toBe(true);
      }
      // 3rd is blocked
      expect(limiter.check('unknown@stranger.com', 'me@example.com', 'unknown').allowed).toBe(false);
    });

    it('should reset per-sender count after the window expires', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        unknownSenderLimit: 2,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      // Use up the limit
      limiter.check('sender@example.com', 'me@example.com', 'unknown');
      limiter.check('sender@example.com', 'me@example.com', 'unknown');
      expect(limiter.check('sender@example.com', 'me@example.com', 'unknown').allowed).toBe(false);

      // Advance time past the window
      vi.advanceTimersByTime(61_000);

      // Should be allowed again
      const result = limiter.check('sender@example.com', 'me@example.com', 'unknown');
      expect(result.allowed).toBe(true);
    });

    it('should track different senders independently', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        unknownSenderLimit: 1,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      expect(limiter.check('a@example.com', 'me@example.com', 'unknown').allowed).toBe(true);
      expect(limiter.check('b@example.com', 'me@example.com', 'unknown').allowed).toBe(true);
      // a is now rate-limited
      expect(limiter.check('a@example.com', 'me@example.com', 'unknown').allowed).toBe(false);
      // b is also rate-limited
      expect(limiter.check('b@example.com', 'me@example.com', 'unknown').allowed).toBe(false);
    });
  });

  describe('per-recipient global rate limiting', () => {
    it('should enforce a global cap across all senders for a recipient', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        knownSenderLimit: 100,
        recipientGlobalLimit: 5,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      // 5 different senders, one message each
      for (let i = 0; i < 5; i++) {
        const result = limiter.check(`sender${i}@example.com`, 'me@example.com', 'known');
        expect(result.allowed).toBe(true);
      }

      // 6th sender hits the global cap
      const result = limiter.check('sender5@example.com', 'me@example.com', 'known');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('global');
    });

    it('should reset global cap after the window expires', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        knownSenderLimit: 100,
        recipientGlobalLimit: 2,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      limiter.check('a@example.com', 'me@example.com', 'known');
      limiter.check('b@example.com', 'me@example.com', 'known');
      expect(limiter.check('c@example.com', 'me@example.com', 'known').allowed).toBe(false);

      vi.advanceTimersByTime(61_000);

      expect(limiter.check('c@example.com', 'me@example.com', 'known').allowed).toBe(true);
    });
  });

  describe('contextual trust levels', () => {
    it('should support "trusted" level with higher limits', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        trustedSenderLimit: 100,
        knownSenderLimit: 5,
        unknownSenderLimit: 2,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      // Trusted sender can send many messages
      for (let i = 0; i < 10; i++) {
        const result = limiter.check('trusted@friend.com', 'me@example.com', 'trusted');
        expect(result.allowed).toBe(true);
      }
    });

    it('should treat "blocked" as zero limit', () => {
      const limiter = createRateLimiter();
      const result = limiter.check('blocked@evil.com', 'me@example.com', 'blocked');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('RateLimitResult metadata', () => {
    it('should include remaining count', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        unknownSenderLimit: 5,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      const result = limiter.check('sender@example.com', 'me@example.com', 'unknown');
      expect(result.remaining).toBe(4);
    });

    it('should include limit in the result', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        unknownSenderLimit: 5,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      const result = limiter.check('sender@example.com', 'me@example.com', 'unknown');
      expect(result.limit).toBe(5);
    });

    it('should include retryAfterMs when rate-limited', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        unknownSenderLimit: 1,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      limiter.check('sender@example.com', 'me@example.com', 'unknown');
      const result = limiter.check('sender@example.com', 'me@example.com', 'unknown');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
    });
  });

  describe('cleanup', () => {
    it('should clean up expired entries to prevent memory leaks', () => {
      const config: RateLimiterConfig = {
        ...DEFAULT_RATE_LIMITER_CONFIG,
        knownSenderLimit: 200,
        unknownSenderLimit: 200,
        recipientGlobalLimit: 10_000,
        windowMs: 60_000,
      };
      const limiter = createRateLimiter(config);

      // Generate some entries
      for (let i = 0; i < 10; i++) {
        limiter.check(`sender${i}@example.com`, 'me@example.com', 'unknown');
      }

      expect(limiter.getStats().activeSenders).toBe(10);

      // Advance past window
      vi.advanceTimersByTime(120_000);

      // Trigger enough checks to reach the cleanup interval (100)
      // Using unique senders so per-sender limits don't kick in
      for (let i = 0; i < 100; i++) {
        limiter.check(`cleanup-trigger-${i}@example.com`, 'me@example.com', 'known');
      }

      const statsAfter = limiter.getStats();
      // The old 10 senders from before the time advance should be cleaned up.
      // Only the 100 new senders should remain.
      expect(statsAfter.activeSenders).toBeLessThanOrEqual(100);
      // And specifically, the original 10 should be gone
      expect(statsAfter.activeSenders).toBe(100);
    });
  });
});
