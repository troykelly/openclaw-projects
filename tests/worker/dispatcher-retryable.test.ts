/**
 * Tests for dispatcher isRetryable classification.
 * Part of Issue #1178.
 */

import { describe, it, expect } from 'vitest';
import { isRetryable } from '../../src/api/webhooks/dispatcher.ts';

describe('isRetryable', () => {
  describe('retryable cases', () => {
    it('returns true for undefined (network error)', () => {
      expect(isRetryable(undefined)).toBe(true);
    });

    it('returns true for 408 (Request Timeout)', () => {
      expect(isRetryable(408)).toBe(true);
    });

    it('returns true for 409 (Conflict)', () => {
      expect(isRetryable(409)).toBe(true);
    });

    it('returns true for 425 (Too Early)', () => {
      expect(isRetryable(425)).toBe(true);
    });

    it('returns true for 429 (Too Many Requests)', () => {
      expect(isRetryable(429)).toBe(true);
    });

    it('returns true for 500 (Internal Server Error)', () => {
      expect(isRetryable(500)).toBe(true);
    });

    it('returns true for 502 (Bad Gateway)', () => {
      expect(isRetryable(502)).toBe(true);
    });

    it('returns true for 503 (Service Unavailable)', () => {
      expect(isRetryable(503)).toBe(true);
    });

    it('returns true for 504 (Gateway Timeout)', () => {
      expect(isRetryable(504)).toBe(true);
    });
  });

  describe('non-retryable cases', () => {
    it('returns false for 400 (Bad Request)', () => {
      expect(isRetryable(400)).toBe(false);
    });

    it('returns false for 401 (Unauthorized)', () => {
      expect(isRetryable(401)).toBe(false);
    });

    it('returns false for 403 (Forbidden)', () => {
      expect(isRetryable(403)).toBe(false);
    });

    it('returns false for 404 (Not Found)', () => {
      expect(isRetryable(404)).toBe(false);
    });

    it('returns false for 405 (Method Not Allowed)', () => {
      expect(isRetryable(405)).toBe(false);
    });

    it('returns false for 422 (Unprocessable Entity)', () => {
      expect(isRetryable(422)).toBe(false);
    });

    it('returns false for 200 (OK)', () => {
      expect(isRetryable(200)).toBe(false);
    });

    it('returns false for 301 (Moved Permanently)', () => {
      expect(isRetryable(301)).toBe(false);
    });
  });
});
