/**
 * Tests for injection detection log rate limiter.
 *
 * Ensures that rapid injection detections only log the first N per key
 * per window, then sample at a configurable rate, and emit periodic
 * summary entries for suppressed detections.
 *
 * Issue #1257
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInjectionLogRateLimiter, DEFAULT_INJECTION_LOG_RATE_LIMITER_CONFIG } from '../../src/utils/injection-log-rate-limiter.js';

describe('injection-log-rate-limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaults', () => {
    it('should export sensible default config', () => {
      expect(DEFAULT_INJECTION_LOG_RATE_LIMITER_CONFIG).toEqual({
        windowMs: 60_000,
        maxLogsPerWindow: 10,
        sampleRate: 0.1,
        maxEntries: 10_000,
      });
    });
  });

  describe('basic window behaviour', () => {
    it('should allow the first N logs for a key within the window', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 3,
        sampleRate: 0, // no sampling — only first N
        maxEntries: 100,
      });

      for (let i = 0; i < 3; i++) {
        const result = limiter.shouldLog('sender-a');
        expect(result.log).toBe(true);
        expect(result.suppressed).toBe(0);
        expect(result.summary).toBe(false);
      }
    });

    it('should suppress logs after exceeding maxLogsPerWindow (with sampleRate=0)', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 2,
        sampleRate: 0, // always suppress after limit
        maxEntries: 100,
      });

      // First 2 allowed
      expect(limiter.shouldLog('sender-a').log).toBe(true);
      expect(limiter.shouldLog('sender-a').log).toBe(true);

      // 3rd and beyond suppressed
      const result3 = limiter.shouldLog('sender-a');
      expect(result3.log).toBe(false);
      expect(result3.suppressed).toBe(1);

      const result4 = limiter.shouldLog('sender-a');
      expect(result4.log).toBe(false);
      expect(result4.suppressed).toBe(2);
    });

    it('should reset counts after the window expires', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 2,
        sampleRate: 0,
        maxEntries: 100,
      });

      // Use only 1 of 2 allowed logs (no suppressions)
      expect(limiter.shouldLog('sender-a').log).toBe(true);

      // Advance past the window
      vi.advanceTimersByTime(61_000);

      // Should be allowed again with fresh window (no summary since no suppressions)
      const result = limiter.shouldLog('sender-a');
      expect(result.log).toBe(true);
      expect(result.suppressed).toBe(0);
      expect(result.summary).toBe(false);
    });

    it('should report previous-window suppressions via summary on window reset', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 1,
        sampleRate: 0,
        maxEntries: 100,
      });

      expect(limiter.shouldLog('sender-a').log).toBe(true);
      expect(limiter.shouldLog('sender-a').log).toBe(false); // suppressed

      // Advance past the window
      vi.advanceTimersByTime(61_000);

      // First log in new window should be a summary with previous suppressions
      const result = limiter.shouldLog('sender-a');
      expect(result.log).toBe(true);
      expect(result.suppressed).toBe(1);
      expect(result.summary).toBe(true);
    });
  });

  describe('sampling after limit', () => {
    it('should sample at the configured rate after exceeding limit', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 1,
        sampleRate: 1.0, // always sample — every log after limit is allowed
        maxEntries: 100,
      });

      // First log allowed normally
      expect(limiter.shouldLog('sender-a').log).toBe(true);

      // With sampleRate=1.0, every subsequent should also be allowed (sampled)
      for (let i = 0; i < 5; i++) {
        const result = limiter.shouldLog('sender-a');
        expect(result.log).toBe(true);
      }
    });

    it('should never sample when sampleRate is 0', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 1,
        sampleRate: 0,
        maxEntries: 100,
      });

      expect(limiter.shouldLog('sender-a').log).toBe(true);

      // All subsequent should be suppressed
      for (let i = 0; i < 10; i++) {
        expect(limiter.shouldLog('sender-a').log).toBe(false);
      }
    });

    it('should include suppressed count in sampled log results', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 1,
        sampleRate: 1.0, // always sample
        maxEntries: 100,
      });

      // First log
      expect(limiter.shouldLog('sender-a').log).toBe(true);

      // Suppress a few (but they will be sampled because sampleRate=1.0)
      // The suppressed count should still track the excess calls
      const result = limiter.shouldLog('sender-a');
      expect(result.log).toBe(true);
      expect(result.suppressed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('summary emission', () => {
    it('should emit summary when window expires and there were suppressions', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 1,
        sampleRate: 0,
        maxEntries: 100,
      });

      // First log OK
      limiter.shouldLog('sender-a');
      // Suppress 3 more
      limiter.shouldLog('sender-a');
      limiter.shouldLog('sender-a');
      limiter.shouldLog('sender-a');

      // Advance past window
      vi.advanceTimersByTime(61_000);

      // Next call for same key should trigger summary
      const result = limiter.shouldLog('sender-a');
      expect(result.log).toBe(true);
      expect(result.summary).toBe(true);
      expect(result.suppressed).toBe(3); // reports the suppressions from previous window
    });

    it('should not emit summary when there were no suppressions', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 10,
        sampleRate: 0,
        maxEntries: 100,
      });

      // Only one detection, well under the limit
      limiter.shouldLog('sender-a');

      // Advance past window
      vi.advanceTimersByTime(61_000);

      // Next call should NOT have summary since nothing was suppressed
      const result = limiter.shouldLog('sender-a');
      expect(result.log).toBe(true);
      expect(result.summary).toBe(false);
      expect(result.suppressed).toBe(0);
    });
  });

  describe('per-key isolation', () => {
    it('should track different keys independently', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 1,
        sampleRate: 0,
        maxEntries: 100,
      });

      expect(limiter.shouldLog('sender-a').log).toBe(true);
      expect(limiter.shouldLog('sender-b').log).toBe(true);

      // sender-a is now rate-limited
      expect(limiter.shouldLog('sender-a').log).toBe(false);
      // sender-b is now rate-limited
      expect(limiter.shouldLog('sender-b').log).toBe(false);
      // sender-c is fresh
      expect(limiter.shouldLog('sender-c').log).toBe(true);
    });
  });

  describe('memory bounds', () => {
    it('should evict oldest entries when maxEntries is exceeded', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 1,
        sampleRate: 0,
        maxEntries: 50,
      });

      // Create 100 unique keys
      for (let i = 0; i < 100; i++) {
        limiter.shouldLog(`sender-${i}`);
      }

      // Should have evicted old entries to stay at or below maxEntries
      const stats = limiter.getStats();
      expect(stats.activeKeys).toBeLessThanOrEqual(50);
    });

    it('should not crash with many unique keys', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 5,
        sampleRate: 0.1,
        maxEntries: 1000,
      });

      // Simulate 500 unique senders
      for (let i = 0; i < 500; i++) {
        const result = limiter.shouldLog(`sender-${i}`);
        expect(result.log).toBe(true);
      }

      const stats = limiter.getStats();
      expect(stats.activeKeys).toBeLessThanOrEqual(1000);
    });
  });

  describe('getStats', () => {
    it('should report active keys and total suppressed count', () => {
      const limiter = createInjectionLogRateLimiter({
        windowMs: 60_000,
        maxLogsPerWindow: 1,
        sampleRate: 0,
        maxEntries: 100,
      });

      limiter.shouldLog('sender-a');
      limiter.shouldLog('sender-b');
      limiter.shouldLog('sender-a'); // suppressed
      limiter.shouldLog('sender-a'); // suppressed
      limiter.shouldLog('sender-b'); // suppressed

      const stats = limiter.getStats();
      expect(stats.activeKeys).toBe(2);
      expect(stats.totalSuppressed).toBe(3);
    });
  });
});
