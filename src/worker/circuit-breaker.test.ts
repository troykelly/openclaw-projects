/**
 * Circuit breaker tests.
 * Part of Issue #1178.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.ts';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 500 });
  });

  describe('initial state', () => {
    it('starts CLOSED for unknown destinations', () => {
      expect(breaker.getState('https://example.com/hook')).toBe('closed');
    });

    it('isOpen returns false for unknown destinations', () => {
      expect(breaker.isOpen('https://example.com/hook')).toBe(false);
    });
  });

  describe('failure tracking', () => {
    it('stays CLOSED below threshold', () => {
      breaker.recordFailure('https://example.com/hook');
      breaker.recordFailure('https://example.com/hook');
      expect(breaker.getState('https://example.com/hook')).toBe('closed');
      expect(breaker.isOpen('https://example.com/hook')).toBe(false);
    });

    it('transitions to OPEN at threshold', () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure('https://example.com/hook');
      }
      expect(breaker.getState('https://example.com/hook')).toBe('open');
      expect(breaker.isOpen('https://example.com/hook')).toBe(true);
    });

    it('tracks destinations independently', () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure('https://a.example.com/hook');
      }
      expect(breaker.isOpen('https://a.example.com/hook')).toBe(true);
      expect(breaker.isOpen('https://b.example.com/hook')).toBe(false);
    });
  });

  describe('destination key extraction', () => {
    it('groups URLs by host', () => {
      breaker.recordFailure('https://example.com/path1');
      breaker.recordFailure('https://example.com/path2');
      breaker.recordFailure('https://example.com/path3');
      expect(breaker.isOpen('https://example.com/anything')).toBe(true);
    });

    it('treats different hosts separately', () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure('https://a.example.com/hook');
      }
      expect(breaker.isOpen('https://b.example.com/hook')).toBe(false);
    });

    it('handles non-URL strings gracefully', () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure('/relative/path');
      }
      expect(breaker.isOpen('/relative/path')).toBe(true);
    });
  });

  describe('success resets', () => {
    it('resets to CLOSED on success', () => {
      breaker.recordFailure('https://example.com/hook');
      breaker.recordFailure('https://example.com/hook');
      breaker.recordSuccess('https://example.com/hook');
      expect(breaker.getState('https://example.com/hook')).toBe('closed');
    });

    it('resets failure count on success', () => {
      breaker.recordFailure('https://example.com/hook');
      breaker.recordFailure('https://example.com/hook');
      breaker.recordSuccess('https://example.com/hook');
      // Two more failures should not trip (count was reset)
      breaker.recordFailure('https://example.com/hook');
      breaker.recordFailure('https://example.com/hook');
      expect(breaker.getState('https://example.com/hook')).toBe('closed');
    });
  });

  describe('cooldown and half-open', () => {
    it('transitions from OPEN to HALF_OPEN after cooldown', async () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure('https://example.com/hook');
      }
      expect(breaker.isOpen('https://example.com/hook')).toBe(true);

      // Wait for cooldown (500ms)
      await new Promise((r) => setTimeout(r, 600));

      // After cooldown, isOpen should return false (allows probe)
      expect(breaker.isOpen('https://example.com/hook')).toBe(false);
      expect(breaker.getState('https://example.com/hook')).toBe('half_open');
    });

    it('returns to CLOSED on success in HALF_OPEN state', async () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure('https://example.com/hook');
      }

      await new Promise((r) => setTimeout(r, 600));

      // Trigger transition to half_open
      breaker.isOpen('https://example.com/hook');
      expect(breaker.getState('https://example.com/hook')).toBe('half_open');

      // Record success → CLOSED
      breaker.recordSuccess('https://example.com/hook');
      expect(breaker.getState('https://example.com/hook')).toBe('closed');
    });

    it('returns to OPEN on failure in HALF_OPEN state', async () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure('https://example.com/hook');
      }

      await new Promise((r) => setTimeout(r, 600));

      breaker.isOpen('https://example.com/hook');
      expect(breaker.getState('https://example.com/hook')).toBe('half_open');

      // Fail enough times to re-open
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure('https://example.com/hook');
      }
      expect(breaker.getState('https://example.com/hook')).toBe('open');
    });
  });

  describe('getStats', () => {
    it('returns empty map initially', () => {
      const stats = breaker.getStats();
      expect(stats.size).toBe(0);
    });

    it('returns all tracked destinations', () => {
      breaker.recordFailure('https://a.example.com/hook');
      breaker.recordFailure('https://b.example.com/hook');
      const stats = breaker.getStats();
      expect(stats.size).toBe(2);
      expect(stats.has('a.example.com')).toBe(true);
      expect(stats.has('b.example.com')).toBe(true);
    });

    it('includes failure count in stats', () => {
      breaker.recordFailure('https://example.com/hook');
      breaker.recordFailure('https://example.com/hook');
      const stats = breaker.getStats();
      const info = stats.get('example.com');
      expect(info).toBeDefined();
      expect(info!.failures).toBe(2);
      expect(info!.state).toBe('closed');
    });
  });

  describe('default options', () => {
    it('uses threshold=5 and cooldownMs=60000 by default', () => {
      const defaultBreaker = new CircuitBreaker();

      // 4 failures should not trip (default threshold is 5)
      for (let i = 0; i < 4; i++) {
        defaultBreaker.recordFailure('https://example.com/hook');
      }
      expect(defaultBreaker.isOpen('https://example.com/hook')).toBe(false);

      // 5th failure should trip
      defaultBreaker.recordFailure('https://example.com/hook');
      expect(defaultBreaker.isOpen('https://example.com/hook')).toBe(true);
    });
  });
});
