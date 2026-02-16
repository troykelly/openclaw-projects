/**
 * Tests for computeNextRunAt helper.
 * Issue #1356: next_run_at must be computed from cron_expression + timezone.
 */
import { describe, it, expect } from 'vitest';
import { computeNextRunAt } from './schedule-next-run.ts';

describe('computeNextRunAt', () => {
  it('computes the next run for a simple every-5-minutes cron', () => {
    // At 10:02 UTC, the next */5 run is 10:05
    const reference = new Date('2026-02-16T10:02:00Z');
    const next = computeNextRunAt('*/5 * * * *', 'UTC', reference);

    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(reference.getTime());
    expect(next.getUTCMinutes()).toBe(5);
    expect(next.getUTCHours()).toBe(10);
  });

  it('computes next run for a daily cron at specific time', () => {
    // "0 9 * * *" = daily at 09:00 UTC
    // If reference is 2026-02-16 10:00 UTC, next is 2026-02-17 09:00 UTC
    const reference = new Date('2026-02-16T10:00:00Z');
    const next = computeNextRunAt('0 9 * * *', 'UTC', reference);

    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getUTCDate()).toBe(17);
  });

  it('respects timezone offset', () => {
    // "0 9 * * *" in America/New_York (UTC-5 in February)
    // At 2026-02-16T13:00:00Z (= 08:00 ET), next is 09:00 ET = 14:00 UTC
    const reference = new Date('2026-02-16T13:00:00Z');
    const next = computeNextRunAt('0 9 * * *', 'America/New_York', reference);

    expect(next.getUTCHours()).toBe(14); // 09:00 ET = 14:00 UTC
    expect(next.getUTCDate()).toBe(16); // same day
  });

  it('advances to next day when current time is past the cron time', () => {
    // "30 8 * * *" = 08:30 UTC daily
    // Reference: 2026-02-16 09:00 UTC (past 08:30), so next is 2026-02-17 08:30
    const reference = new Date('2026-02-16T09:00:00Z');
    const next = computeNextRunAt('30 8 * * *', 'UTC', reference);

    expect(next.getUTCHours()).toBe(8);
    expect(next.getUTCMinutes()).toBe(30);
    expect(next.getUTCDate()).toBe(17);
  });

  it('handles hourly cron', () => {
    // "0 * * * *" = every hour on the hour
    // At 10:30 UTC, next is 11:00 UTC
    const reference = new Date('2026-02-16T10:30:00Z');
    const next = computeNextRunAt('0 * * * *', 'UTC', reference);

    expect(next.getUTCHours()).toBe(11);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it('handles weekday-restricted cron', () => {
    // "0 9 * * 1" = Mondays at 09:00 UTC
    // 2026-02-16 is a Monday, but if reference is 10:00 (past 09:00), next is Feb 23
    const reference = new Date('2026-02-16T10:00:00Z');
    const next = computeNextRunAt('0 9 * * 1', 'UTC', reference);

    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCDate()).toBe(23); // next Monday
  });

  it('defaults to now when no currentDate is provided', () => {
    const next = computeNextRunAt('*/5 * * * *', 'UTC');

    expect(next).toBeInstanceOf(Date);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it('throws on invalid cron expression', () => {
    expect(() => computeNextRunAt('not a cron', 'UTC')).toThrow();
  });
});
