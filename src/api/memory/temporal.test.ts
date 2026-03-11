/**
 * Temporal parsing tests — Issue #2443
 * Covers timezone handling, month-end rollover, and strict date parsing.
 */

import { describe, it, expect } from 'vitest';
import { resolveRelativeTime, resolvePeriod } from './temporal.ts';

describe('resolveRelativeTime', () => {
  const now = new Date('2026-03-15T12:00:00Z');

  it('parses relative hours', () => {
    const result = resolveRelativeTime('24h', now);
    expect(result).toEqual(new Date('2026-03-14T12:00:00Z'));
  });

  it('parses relative days', () => {
    const result = resolveRelativeTime('7d', now);
    expect(result).toEqual(new Date('2026-03-08T12:00:00Z'));
  });

  it('parses relative weeks', () => {
    const result = resolveRelativeTime('2w', now);
    expect(result).toEqual(new Date('2026-03-01T12:00:00Z'));
  });

  it('handles month-end rollover: Jan 31 minus 1 month = Dec 31', () => {
    const jan31 = new Date('2026-01-31T12:00:00Z');
    const result = resolveRelativeTime('1m', jan31);
    expect(result!.getUTCMonth()).toBe(11); // December
    expect(result!.getUTCDate()).toBe(31);
    expect(result!.getUTCFullYear()).toBe(2025);
  });

  it('handles month-end rollover: Mar 31 minus 1 month = Feb 28', () => {
    const mar31 = new Date('2026-03-31T12:00:00Z');
    const result = resolveRelativeTime('1m', mar31);
    expect(result!.getUTCMonth()).toBe(1); // February
    expect(result!.getUTCDate()).toBe(28); // 2026 is not a leap year
  });

  it('handles leap year: Mar 31 minus 1 month = Feb 29 in leap year', () => {
    const mar31leap = new Date('2028-03-31T12:00:00Z'); // 2028 is a leap year
    const result = resolveRelativeTime('1m', mar31leap);
    expect(result!.getUTCMonth()).toBe(1); // February
    expect(result!.getUTCDate()).toBe(29);
  });

  it('parses date-only strings as UTC', () => {
    const result = resolveRelativeTime('2026-01-15');
    expect(result).toEqual(new Date('2026-01-15T00:00:00Z'));
  });

  it('parses ISO 8601 with Z offset', () => {
    const result = resolveRelativeTime('2026-01-01T00:00:00Z');
    expect(result).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('parses ISO 8601 with explicit timezone offset', () => {
    const result = resolveRelativeTime('2026-01-01T10:00:00+05:30');
    expect(result).toBeDefined();
    expect(result!.toISOString()).toBe('2026-01-01T04:30:00.000Z');
  });

  it('rejects timezone-less datetime strings', () => {
    const result = resolveRelativeTime('2026-01-01T00:00:00');
    expect(result).toBeNull();
  });

  it('rejects ambiguous formats', () => {
    expect(resolveRelativeTime('Jan 1 2026')).toBeNull();
    expect(resolveRelativeTime('01/01/2026')).toBeNull();
    expect(resolveRelativeTime('not-a-date')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(resolveRelativeTime('')).toBeNull();
  });

  it('handles whitespace in input', () => {
    const result = resolveRelativeTime('  2026-01-15  ');
    expect(result).toEqual(new Date('2026-01-15T00:00:00Z'));
  });
});

describe('resolvePeriod', () => {
  // Wednesday 2026-03-11 14:00:00Z
  const now = new Date('2026-03-11T14:00:00Z');

  it('resolves "today" to UTC start-of-day', () => {
    const result = resolvePeriod('today', now);
    expect(result).toBeDefined();
    expect(result!.since).toEqual(new Date('2026-03-11T00:00:00Z'));
    expect(result!.before).toBeUndefined();
  });

  it('resolves "yesterday"', () => {
    const result = resolvePeriod('yesterday', now);
    expect(result).toBeDefined();
    expect(result!.since).toEqual(new Date('2026-03-10T00:00:00Z'));
    expect(result!.before).toEqual(new Date('2026-03-11T00:00:00Z'));
  });

  it('resolves "this_week" starting on Monday (ISO 8601)', () => {
    const result = resolvePeriod('this_week', now);
    expect(result).toBeDefined();
    // March 11 2026 is a Wednesday, so Monday = March 9
    expect(result!.since).toEqual(new Date('2026-03-09T00:00:00Z'));
  });

  it('resolves "this_week" when today is Sunday', () => {
    const sunday = new Date('2026-03-15T14:00:00Z'); // Sunday
    const result = resolvePeriod('this_week', sunday);
    expect(result).toBeDefined();
    // Week containing this Sunday starts on Monday March 9
    expect(result!.since).toEqual(new Date('2026-03-09T00:00:00Z'));
  });

  it('resolves "this_week" when today is Monday', () => {
    const monday = new Date('2026-03-09T14:00:00Z'); // Monday
    const result = resolvePeriod('this_week', monday);
    expect(result).toBeDefined();
    expect(result!.since).toEqual(new Date('2026-03-09T00:00:00Z'));
  });

  it('resolves "last_week"', () => {
    const result = resolvePeriod('last_week', now);
    expect(result).toBeDefined();
    expect(result!.since).toEqual(new Date('2026-03-02T00:00:00Z'));
    expect(result!.before).toEqual(new Date('2026-03-09T00:00:00Z'));
  });

  it('resolves "this_month"', () => {
    const result = resolvePeriod('this_month', now);
    expect(result).toBeDefined();
    expect(result!.since).toEqual(new Date('2026-03-01T00:00:00Z'));
  });

  it('resolves "last_month"', () => {
    const result = resolvePeriod('last_month', now);
    expect(result).toBeDefined();
    expect(result!.since).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(result!.before).toEqual(new Date('2026-03-01T00:00:00Z'));
  });

  it('returns null for unknown period', () => {
    expect(resolvePeriod('next_year', now)).toBeNull();
  });

  it('handles "today" at 00:00:01 UTC', () => {
    const midnight = new Date('2026-03-11T00:00:01Z');
    const result = resolvePeriod('today', midnight);
    expect(result!.since).toEqual(new Date('2026-03-11T00:00:00Z'));
  });
});
