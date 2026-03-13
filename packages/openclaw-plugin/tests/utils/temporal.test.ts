/**
 * Tests for temporal utility functions — Issues #2434, #2430.
 */

import { describe, expect, it } from 'vitest';
import { resolveRelativeTime, resolveTtl } from '../../src/utils/temporal.js';

describe('resolveRelativeTime', () => {
  const baseTime = new Date('2026-03-12T10:00:00Z');

  it('should resolve hours (24h)', () => {
    const result = resolveRelativeTime('24h', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-03-11T10:00:00.000Z');
  });

  it('should resolve hours (1h)', () => {
    const result = resolveRelativeTime('1h', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-03-12T09:00:00.000Z');
  });

  it('should resolve days (7d)', () => {
    const result = resolveRelativeTime('7d', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-03-05T10:00:00.000Z');
  });

  it('should resolve weeks (2w)', () => {
    const result = resolveRelativeTime('2w', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-02-26T10:00:00.000Z');
  });

  it('should resolve months (1m)', () => {
    const result = resolveRelativeTime('1m', baseTime);
    expect(result).not.toBeNull();
    // March 12 minus 1 month = Feb 12
    expect(result!.toISOString()).toBe('2026-02-12T10:00:00.000Z');
  });

  it('should resolve ISO datetime with Z timezone', () => {
    const result = resolveRelativeTime('2026-01-15T08:00:00Z', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('should resolve date-only (YYYY-MM-DD) as UTC start-of-day', () => {
    const result = resolveRelativeTime('2026-01-15', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('should reject timezone-less datetime', () => {
    const result = resolveRelativeTime('2026-01-15T08:00:00', baseTime);
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = resolveRelativeTime('', baseTime);
    expect(result).toBeNull();
  });

  it('should return null for invalid format', () => {
    const result = resolveRelativeTime('tomorrow', baseTime);
    expect(result).toBeNull();
  });

  it('should handle month-end rollover correctly (March 31 - 1m = Feb 28)', () => {
    const marchEnd = new Date('2026-03-31T10:00:00Z');
    const result = resolveRelativeTime('1m', marchEnd);
    expect(result).not.toBeNull();
    // Feb 28 (2026 is not a leap year)
    expect(result!.toISOString()).toBe('2026-02-28T10:00:00.000Z');
  });
});

describe('resolveTtl', () => {
  const baseTime = new Date('2026-03-12T10:00:00Z');

  it('should resolve 24h TTL to future date', () => {
    const result = resolveTtl('24h', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-03-13T10:00:00.000Z');
  });

  it('should resolve 1h TTL', () => {
    const result = resolveTtl('1h', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-03-12T11:00:00.000Z');
  });

  it('should resolve 7d TTL', () => {
    const result = resolveTtl('7d', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-03-19T10:00:00.000Z');
  });

  it('should resolve 3d TTL', () => {
    const result = resolveTtl('3d', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-03-15T10:00:00.000Z');
  });

  it('should resolve 30d TTL', () => {
    const result = resolveTtl('30d', baseTime);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2026-04-11T10:00:00.000Z');
  });

  it('should reject 0h (zero TTL)', () => {
    const result = resolveTtl('0h', baseTime);
    expect(result).toBeNull();
  });

  it('should reject negative-like strings', () => {
    const result = resolveTtl('-1d', baseTime);
    expect(result).toBeNull();
  });

  it('should reject TTL over 365 days', () => {
    const result = resolveTtl('400d', baseTime);
    expect(result).toBeNull();
  });

  it('should reject invalid format', () => {
    const result = resolveTtl('forever', baseTime);
    expect(result).toBeNull();
  });

  it('should reject ISO datetime (not a TTL)', () => {
    const result = resolveTtl('2026-01-15T00:00:00Z', baseTime);
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = resolveTtl('', baseTime);
    expect(result).toBeNull();
  });
});
