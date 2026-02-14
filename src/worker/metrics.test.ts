/**
 * Prometheus metrics tests.
 * Part of Issue #1178.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Counter, Gauge, Histogram } from './metrics.ts';

describe('Counter', () => {
  let counter: Counter;

  beforeEach(() => {
    counter = new Counter('test_counter', 'Test counter help');
  });

  it('starts at zero', () => {
    expect(counter.get()).toBe(0);
  });

  it('increments by 1 by default', () => {
    counter.inc();
    expect(counter.get()).toBe(1);
  });

  it('increments by arbitrary value', () => {
    counter.inc({}, 5);
    expect(counter.get()).toBe(5);
  });

  it('tracks labels independently', () => {
    counter.inc({ status: 'ok' }, 3);
    counter.inc({ status: 'error' }, 1);
    expect(counter.get({ status: 'ok' })).toBe(3);
    expect(counter.get({ status: 'error' })).toBe(1);
    expect(counter.get({ status: 'unknown' })).toBe(0);
  });

  it('accumulates across multiple inc calls', () => {
    counter.inc({}, 2);
    counter.inc({}, 3);
    expect(counter.get()).toBe(5);
  });

  describe('serialize', () => {
    it('outputs Prometheus text format', () => {
      counter.inc({ method: 'GET' }, 10);
      const output = counter.serialize();
      expect(output).toContain('# HELP test_counter Test counter help');
      expect(output).toContain('# TYPE test_counter counter');
      expect(output).toContain('test_counter{method="GET"} 10');
    });

    it('serializes unlabeled counter', () => {
      counter.inc({}, 42);
      const output = counter.serialize();
      expect(output).toContain('test_counter 42');
    });

    it('serializes multiple label sets', () => {
      counter.inc({ status: 'ok' }, 5);
      counter.inc({ status: 'error' }, 2);
      const output = counter.serialize();
      expect(output).toContain('test_counter{status="ok"} 5');
      expect(output).toContain('test_counter{status="error"} 2');
    });
  });
});

describe('Gauge', () => {
  let gauge: Gauge;

  beforeEach(() => {
    gauge = new Gauge('test_gauge', 'Test gauge help');
  });

  it('starts at zero', () => {
    expect(gauge.get()).toBe(0);
  });

  it('sets value without labels', () => {
    gauge.set(42);
    expect(gauge.get()).toBe(42);
  });

  it('sets value with labels', () => {
    gauge.set({ kind: 'reminder' }, 10);
    expect(gauge.get({ kind: 'reminder' })).toBe(10);
  });

  it('overwrites previous value', () => {
    gauge.set(10);
    gauge.set(20);
    expect(gauge.get()).toBe(20);
  });

  it('increments via inc', () => {
    gauge.inc({ kind: 'test' }, 5);
    gauge.inc({ kind: 'test' }, 3);
    expect(gauge.get({ kind: 'test' })).toBe(8);
  });

  describe('serialize', () => {
    it('outputs Prometheus text format', () => {
      gauge.set({ kind: 'email' }, 7);
      const output = gauge.serialize();
      expect(output).toContain('# HELP test_gauge Test gauge help');
      expect(output).toContain('# TYPE test_gauge gauge');
      expect(output).toContain('test_gauge{kind="email"} 7');
    });
  });
});

describe('Histogram', () => {
  let histogram: Histogram;

  beforeEach(() => {
    histogram = new Histogram('test_hist', 'Test histogram help', [0.1, 0.5, 1, 5]);
  });

  it('tracks observations', () => {
    histogram.observe({}, 0.05);
    histogram.observe({}, 0.3);
    histogram.observe({}, 2);

    const output = histogram.serialize();
    expect(output).toContain('# HELP test_hist Test histogram help');
    expect(output).toContain('# TYPE test_hist histogram');
  });

  it('counts buckets correctly', () => {
    histogram.observe({}, 0.05); // fits in 0.1, 0.5, 1, 5
    histogram.observe({}, 0.3);  // fits in 0.5, 1, 5
    histogram.observe({}, 2);    // fits in 5

    const output = histogram.serialize();
    // bucket le="0.1" should have 1 (0.05)
    expect(output).toContain('test_hist_bucket{le="0.1"} 1');
    // bucket le="0.5" should have 2 (0.05, 0.3)
    expect(output).toContain('test_hist_bucket{le="0.5"} 2');
    // bucket le="1" should have 2 (0.05, 0.3)
    expect(output).toContain('test_hist_bucket{le="1"} 2');
    // bucket le="5" should have 3 (0.05, 0.3, 2)
    expect(output).toContain('test_hist_bucket{le="5"} 3');
    // +Inf should have 3
    expect(output).toContain('test_hist_bucket{le="+Inf"} 3');
    // sum (empty labels serialize as {})
    expect(output).toContain('test_hist_sum{} 2.35');
    // count
    expect(output).toContain('test_hist_count{} 3');
  });

  it('handles labeled observations', () => {
    histogram.observe({ method: 'GET' }, 0.2);
    const output = histogram.serialize();
    expect(output).toContain('test_hist_bucket{method="GET",le="0.5"} 1');
    expect(output).toContain('test_hist_sum{method="GET"} 0.2');
    expect(output).toContain('test_hist_count{method="GET"} 1');
  });

  it('uses default buckets when none provided', () => {
    const defaultHist = new Histogram('default_hist', 'Default buckets');
    expect(defaultHist.buckets.length).toBeGreaterThan(0);
    expect(defaultHist.buckets).toContain(0.005);
    expect(defaultHist.buckets).toContain(1);
    expect(defaultHist.buckets).toContain(120);
  });
});
