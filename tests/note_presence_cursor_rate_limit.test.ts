/**
 * Tests for rate limiting on cursor update endpoint.
 * Part of Issue #690.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getEndpointRateLimitCategory, getRateLimitConfig } from '../src/api/rate-limit/per-user.ts';

describe('Cursor Rate Limiting (Issue #690)', () => {
  const originalEnv = process.env.RATE_LIMIT_CURSOR_MAX;

  afterEach(() => {
    // Restore original env value
    if (originalEnv === undefined) {
      delete process.env.RATE_LIMIT_CURSOR_MAX;
    } else {
      process.env.RATE_LIMIT_CURSOR_MAX = originalEnv;
    }
  });

  describe('getEndpointRateLimitCategory', () => {
    it('returns "cursor" category for cursor update endpoints', () => {
      expect(getEndpointRateLimitCategory('PUT', '/notes/123/presence/cursor')).toBe('cursor');
    });

    it('returns "cursor" category for cursor endpoint with query params', () => {
      expect(getEndpointRateLimitCategory('PUT', '/notes/123/presence/cursor?foo=bar')).toBe('cursor');
    });

    it('returns "cursor" category regardless of HTTP method', () => {
      // Even though we expect PUT, the category detection should still work
      expect(getEndpointRateLimitCategory('POST', '/notes/123/presence/cursor')).toBe('cursor');
      expect(getEndpointRateLimitCategory('GET', '/notes/123/presence/cursor')).toBe('cursor');
    });

    it('returns "cursor" for work-item presence cursor (if present)', () => {
      expect(getEndpointRateLimitCategory('PUT', '/work-items/123/presence/cursor')).toBe('cursor');
    });

    it('does not return "cursor" for regular presence endpoints', () => {
      expect(getEndpointRateLimitCategory('POST', '/notes/123/presence')).toBe('write');
      expect(getEndpointRateLimitCategory('GET', '/notes/123/presence')).toBe('read');
      expect(getEndpointRateLimitCategory('DELETE', '/notes/123/presence')).toBe('write');
    });

    it('prioritizes cursor over write for cursor endpoints', () => {
      // cursor endpoints use PUT which would normally be "write"
      expect(getEndpointRateLimitCategory('PUT', '/notes/123/presence/cursor')).toBe('cursor');
    });
  });

  describe('getRateLimitConfig', () => {
    it('returns default cursor limit of 120 per minute', () => {
      delete process.env.RATE_LIMIT_CURSOR_MAX;
      const config = getRateLimitConfig('cursor');

      expect(config.max).toBe(120);
    });

    it('respects RATE_LIMIT_CURSOR_MAX env override', () => {
      process.env.RATE_LIMIT_CURSOR_MAX = '60';
      const config = getRateLimitConfig('cursor');

      expect(config.max).toBe(60);
    });

    it('cursor limit is higher than write limit for real-time updates', () => {
      delete process.env.RATE_LIMIT_CURSOR_MAX;
      delete process.env.RATE_LIMIT_WRITE_MAX;

      const cursorConfig = getRateLimitConfig('cursor');
      const writeConfig = getRateLimitConfig('write');

      // Cursor updates should have higher limit since they're frequent real-time events
      expect(cursorConfig.max).toBeGreaterThan(writeConfig.max);
    });
  });

  describe('Rate limit category comparison', () => {
    it('cursor category exists in rate limit system', () => {
      // This implicitly tests that 'cursor' is a valid RateLimitCategory
      const config = getRateLimitConfig('cursor');
      expect(config.max).toBeGreaterThan(0);
      expect(config.timeWindow).toBeGreaterThan(0);
    });
  });
});
