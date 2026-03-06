/**
 * Unit tests for GitHub Rate Limit Management.
 * Issue #2203 — GitHub Rate Limit Management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRateLimitHeaders,
  checkRateLimit,
  reserveBudget,
  recordApiCall,
  calculatePollingInterval,
} from './rate-limit.ts';
import type { RateLimitStatus } from './rate-limit.ts';

function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

// ─── parseRateLimitHeaders ───

describe('parseRateLimitHeaders', () => {
  it('parses valid headers', () => {
    const result = parseRateLimitHeaders({
      'x-ratelimit-remaining': '4500',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1709712000',
      'x-ratelimit-resource': 'core',
    });

    expect(result).toEqual({
      remaining: 4500,
      limit: 5000,
      resetEpoch: 1709712000,
      resource: 'core',
    });
  });

  it('defaults resource to core when not provided', () => {
    const result = parseRateLimitHeaders({
      'x-ratelimit-remaining': '100',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1709712000',
    });

    expect(result).not.toBeNull();
    expect(result!.resource).toBe('core');
  });

  it('returns null when required headers are missing', () => {
    expect(parseRateLimitHeaders({})).toBeNull();
    expect(parseRateLimitHeaders({ 'x-ratelimit-remaining': '100' })).toBeNull();
    expect(parseRateLimitHeaders({
      'x-ratelimit-remaining': '100',
      'x-ratelimit-limit': '5000',
    })).toBeNull();
  });

  it('returns null for non-numeric values', () => {
    expect(parseRateLimitHeaders({
      'x-ratelimit-remaining': 'abc',
      'x-ratelimit-limit': '5000',
      'x-ratelimit-reset': '1709712000',
    })).toBeNull();
  });
});

// ─── checkRateLimit ───

describe('checkRateLimit', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('returns null when no rate limit data exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await checkRateLimit(pool as never, 'test-ns', 'core');
    expect(result).toBeNull();
  });

  it('returns rate limit status from DB', async () => {
    const futureDate = new Date(Date.now() + 3600_000);
    pool.query.mockResolvedValueOnce({
      rows: [{ remaining: 4500, limit: 5000, resets_at: futureDate }],
      rowCount: 1,
    });

    const result = await checkRateLimit(pool as never, 'test-ns', 'core');
    expect(result).not.toBeNull();
    expect(result!.remaining).toBe(4500);
    expect(result!.limit).toBe(5000);
    expect(result!.isLimited).toBe(false);
  });

  it('marks as limited when remaining <= reserve', async () => {
    const futureDate = new Date(Date.now() + 3600_000);
    pool.query.mockResolvedValueOnce({
      rows: [{ remaining: 50, limit: 5000, resets_at: futureDate }],
      rowCount: 1,
    });

    const result = await checkRateLimit(pool as never, 'test-ns', 'core', 100);
    expect(result!.isLimited).toBe(true);
  });

  it('marks as not limited when remaining > reserve', async () => {
    const futureDate = new Date(Date.now() + 3600_000);
    pool.query.mockResolvedValueOnce({
      rows: [{ remaining: 200, limit: 5000, resets_at: futureDate }],
      rowCount: 1,
    });

    const result = await checkRateLimit(pool as never, 'test-ns', 'core', 100);
    expect(result!.isLimited).toBe(false);
  });

  it('treats expired reset time as fully available', async () => {
    const pastDate = new Date(Date.now() - 60_000);
    pool.query.mockResolvedValueOnce({
      rows: [{ remaining: 0, limit: 5000, resets_at: pastDate }],
      rowCount: 1,
    });

    const result = await checkRateLimit(pool as never, 'test-ns', 'core');
    expect(result!.remaining).toBe(5000);
    expect(result!.isLimited).toBe(false);
  });

  it('uses custom reserve value', async () => {
    const futureDate = new Date(Date.now() + 3600_000);
    pool.query.mockResolvedValueOnce({
      rows: [{ remaining: 50, limit: 5000, resets_at: futureDate }],
      rowCount: 1,
    });

    const result = await checkRateLimit(pool as never, 'test-ns', 'core', 25);
    expect(result!.isLimited).toBe(false); // 50 > 25
  });
});

// ─── reserveBudget ───

describe('reserveBudget', () => {
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('allows reservation when no rate limit data exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await reserveBudget(pool as never, 'test-ns', 'core', 1);
    expect(result).toBe(true);
  });

  it('allows reservation when sufficient budget exists', async () => {
    const futureDate = new Date(Date.now() + 3600_000);
    // checkRateLimit query
    pool.query.mockResolvedValueOnce({
      rows: [{ remaining: 500, limit: 5000, resets_at: futureDate }],
      rowCount: 1,
    });
    // UPDATE query succeeds
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    const result = await reserveBudget(pool as never, 'test-ns', 'core', 5, 100);
    expect(result).toBe(true);
  });

  it('denies reservation when insufficient budget', async () => {
    const futureDate = new Date(Date.now() + 3600_000);
    pool.query.mockResolvedValueOnce({
      rows: [{ remaining: 105, limit: 5000, resets_at: futureDate }],
      rowCount: 1,
    });

    // Trying to reserve 10 but only 5 above reserve (105 - 100 = 5)
    const result = await reserveBudget(pool as never, 'test-ns', 'core', 10, 100);
    expect(result).toBe(false);
  });

  it('denies reservation when DB update finds no matching row', async () => {
    const futureDate = new Date(Date.now() + 3600_000);
    pool.query.mockResolvedValueOnce({
      rows: [{ remaining: 500, limit: 5000, resets_at: futureDate }],
      rowCount: 1,
    });
    // Concurrent update drained budget — rowCount is 0
    pool.query.mockResolvedValueOnce({ rowCount: 0 });

    const result = await reserveBudget(pool as never, 'test-ns', 'core', 5, 100);
    expect(result).toBe(false);
  });

  it('allows reservation when reset time has passed', async () => {
    const pastDate = new Date(Date.now() - 60_000);
    pool.query.mockResolvedValueOnce({
      rows: [{ remaining: 0, limit: 5000, resets_at: pastDate }],
      rowCount: 1,
    });

    const result = await reserveBudget(pool as never, 'test-ns', 'core', 1, 100);
    expect(result).toBe(true);
  });
});

// ─── recordApiCall ───

describe('recordApiCall', () => {
  it('upserts rate limit data', async () => {
    const pool = createMockPool();
    pool.query.mockResolvedValueOnce({ rowCount: 1 });

    await recordApiCall(pool as never, 'test-ns', 'core', {
      remaining: 4999,
      limit: 5000,
      resetEpoch: 1709712000,
      resource: 'core',
    });

    expect(pool.query).toHaveBeenCalledOnce();
    const [query, params] = pool.query.mock.calls[0];
    expect(query).toContain('INSERT INTO symphony_github_rate_limit');
    expect(query).toContain('ON CONFLICT (namespace, resource)');
    expect(params[0]).toBe('test-ns');
    expect(params[1]).toBe('core');
    expect(params[2]).toBe(4999);
    expect(params[3]).toBe(5000);
    expect(params[4]).toEqual(new Date(1709712000 * 1000));
  });
});

// ─── calculatePollingInterval ───

describe('calculatePollingInterval', () => {
  it('returns 30s when no status data', () => {
    expect(calculatePollingInterval(null)).toBe(30_000);
  });

  it('returns maxInterval when rate-limited (no budget above reserve)', () => {
    const status: RateLimitStatus = {
      remaining: 50,
      limit: 5000,
      resetsAt: new Date(Date.now() + 600_000), // 10 min
      isLimited: true,
    };

    const interval = calculatePollingInterval(status, 100);
    // Should wait until reset or maxInterval
    expect(interval).toBeLessThanOrEqual(600_000);
    expect(interval).toBeGreaterThanOrEqual(5_000);
  });

  it('distributes calls evenly across remaining time', () => {
    const status: RateLimitStatus = {
      remaining: 1100,
      limit: 5000,
      resetsAt: new Date(Date.now() + 600_000), // 10 min
      isLimited: false,
    };

    const interval = calculatePollingInterval(status, 100);
    // 1000 available calls over 600s = ~600ms per call
    // But clamped to minimum 5000ms
    expect(interval).toBe(5_000);
  });

  it('respects minimum interval', () => {
    const status: RateLimitStatus = {
      remaining: 10000,
      limit: 10000,
      resetsAt: new Date(Date.now() + 3600_000),
      isLimited: false,
    };

    const interval = calculatePollingInterval(status, 100, 10_000);
    expect(interval).toBeGreaterThanOrEqual(10_000);
  });

  it('respects maximum interval', () => {
    const status: RateLimitStatus = {
      remaining: 101,
      limit: 5000,
      resetsAt: new Date(Date.now() + 3600_000),
      isLimited: false,
    };

    // Only 1 call available over 1 hour
    const interval = calculatePollingInterval(status, 100, 5_000, 300_000);
    expect(interval).toBeLessThanOrEqual(300_000);
  });

  it('waits until reset when zero available budget', () => {
    const resetMs = 120_000; // 2 min
    const status: RateLimitStatus = {
      remaining: 100, // exactly at reserve
      limit: 5000,
      resetsAt: new Date(Date.now() + resetMs),
      isLimited: true,
    };

    const interval = calculatePollingInterval(status, 100, 5_000, 300_000);
    // Should be close to resetMs (capped at maxInterval)
    expect(interval).toBeGreaterThan(5_000);
    expect(interval).toBeLessThanOrEqual(300_000);
  });
});
