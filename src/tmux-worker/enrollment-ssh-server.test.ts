/**
 * Unit tests for the SSH enrollment server rate limiting logic.
 *
 * Issue #1684 — SSH enrollment server
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isRateLimited,
  recordFailedAttempt,
  clearRateLimit,
  failedAuthAttempts,
} from './enrollment-ssh-server.ts';

describe('SSH enrollment rate limiting', () => {
  beforeEach(() => {
    failedAuthAttempts.clear();
  });

  it('allows first attempt from new IP', () => {
    expect(isRateLimited('1.2.3.4')).toBe(false);
  });

  it('rate-limits after MAX_FAILED_ATTEMPTS', () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(ip);
    }
    expect(isRateLimited(ip)).toBe(true);
  });

  it('does not rate-limit before threshold', () => {
    const ip = '10.0.0.2';
    for (let i = 0; i < 4; i++) {
      recordFailedAttempt(ip);
    }
    expect(isRateLimited(ip)).toBe(false);
  });

  it('clears rate limit on successful auth', () => {
    const ip = '10.0.0.3';
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt(ip);
    }
    expect(isRateLimited(ip)).toBe(true);

    clearRateLimit(ip);
    expect(isRateLimited(ip)).toBe(false);
  });

  it('isolates rate limits per IP', () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt('10.0.0.10');
    }
    expect(isRateLimited('10.0.0.10')).toBe(true);
    expect(isRateLimited('10.0.0.11')).toBe(false);
  });
});
