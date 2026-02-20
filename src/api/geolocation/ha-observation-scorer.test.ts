/**
 * Tests for observation scorer interface utilities.
 *
 * Covers the buildObservationContext helper that derives temporal context
 * from a Date object.
 *
 * Issue #1453, Epic #1440.
 */

import { describe, expect, it } from 'vitest';
import { buildObservationContext } from './ha-observation-scorer.ts';

describe('buildObservationContext', () => {
  it('classifies 3am as night bucket', () => {
    const date = new Date('2026-02-18T03:00:00'); // Wednesday
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('night');
    expect(ctx.day_of_week).toBe('wednesday');
    expect(ctx.is_weekend).toBe(false);
  });

  it('classifies 7am as morning_early bucket', () => {
    const date = new Date('2026-02-18T07:30:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('morning_early');
  });

  it('classifies 10am as morning bucket', () => {
    const date = new Date('2026-02-18T10:00:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('morning');
  });

  it('classifies 2pm as afternoon bucket', () => {
    const date = new Date('2026-02-18T14:00:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('afternoon');
  });

  it('classifies 7pm as evening bucket', () => {
    const date = new Date('2026-02-18T19:00:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('evening');
  });

  it('classifies 11pm as night_late bucket', () => {
    const date = new Date('2026-02-18T23:00:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('night_late');
  });

  it('identifies Saturday as weekend', () => {
    const date = new Date('2026-02-21T12:00:00'); // Saturday
    const ctx = buildObservationContext(date);
    expect(ctx.is_weekend).toBe(true);
    expect(ctx.day_of_week).toBe('saturday');
  });

  it('identifies Sunday as weekend', () => {
    const date = new Date('2026-02-22T12:00:00'); // Sunday
    const ctx = buildObservationContext(date);
    expect(ctx.is_weekend).toBe(true);
    expect(ctx.day_of_week).toBe('sunday');
  });

  it('identifies Monday as weekday', () => {
    const date = new Date('2026-02-16T12:00:00'); // Monday
    const ctx = buildObservationContext(date);
    expect(ctx.is_weekend).toBe(false);
    expect(ctx.day_of_week).toBe('monday');
  });

  it('boundary: 5:59am is still night', () => {
    const date = new Date('2026-02-18T05:59:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('night');
  });

  it('boundary: 6:00am transitions to morning_early', () => {
    const date = new Date('2026-02-18T06:00:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('morning_early');
  });

  it('boundary: 8:59am is still morning_early', () => {
    const date = new Date('2026-02-18T08:59:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('morning_early');
  });

  it('boundary: 9:00am transitions to morning', () => {
    const date = new Date('2026-02-18T09:00:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('morning');
  });

  it('boundary: 16:59 is still afternoon', () => {
    const date = new Date('2026-02-18T16:59:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('afternoon');
  });

  it('boundary: 17:00 transitions to evening', () => {
    const date = new Date('2026-02-18T17:00:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('evening');
  });

  it('boundary: 20:59 is still evening', () => {
    const date = new Date('2026-02-18T20:59:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('evening');
  });

  it('boundary: 21:00 transitions to night_late', () => {
    const date = new Date('2026-02-18T21:00:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('night_late');
  });

  it('midnight is night bucket', () => {
    const date = new Date('2026-02-18T00:00:00');
    const ctx = buildObservationContext(date);
    expect(ctx.time_bucket).toBe('night');
  });
});
