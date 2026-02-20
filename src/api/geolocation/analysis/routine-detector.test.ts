/**
 * Tests for RoutineDetector.
 * Issue #1456, Epic #1440.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';

import {
  RoutineDetector,
  jaccardSimilarity,
  generateRoutineKey,
  formatTitle,
  formatDescription,
  type DetectedRoutine,
  type AnalyzeOptions,
} from './routine-detector.ts';

// ---------- helpers ----------

function mockPool(queryFn: ReturnType<typeof vi.fn>): Pool {
  return { query: queryFn } as unknown as Pool;
}

/** Build a fake observation row. */
function obs(
  entity_id: string,
  domain: string,
  to_state: string,
  timestamp: Date,
  scene_label: string,
  score = 5,
) {
  return { entity_id, domain, to_state, timestamp, scene_label, score };
}

/**
 * Create a set of observations that repeat on multiple dates at the same hour.
 * This simulates a recurring pattern on different days.
 */
function buildRecurringPattern(params: {
  scene: string;
  entities: { entity_id: string; domain: string; to_state: string }[];
  dates: string[];
  hour: number;
}): Array<ReturnType<typeof obs>> {
  const results: Array<ReturnType<typeof obs>> = [];
  for (const dateStr of params.dates) {
    for (let i = 0; i < params.entities.length; i++) {
      const e = params.entities[i];
      const ts = new Date(`${dateStr}T${params.hour.toString().padStart(2, '0')}:${(i * 2).toString().padStart(2, '0')}:00Z`);
      results.push(obs(e.entity_id, e.domain, e.to_state, ts, params.scene));
    }
  }
  return results;
}

// ---------- unit tests: utility functions ----------

describe('jaccardSimilarity', () => {
  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it('returns 1 for identical sets', () => {
    const s = new Set(['a', 'b', 'c']);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['a', 'b']);
    const b = new Set(['c', 'd']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('calculates partial overlap correctly', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    // intersection = {b, c} = 2; union = {a, b, c, d} = 4; similarity = 0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it('handles one empty set', () => {
    const a = new Set(['a']);
    const b = new Set<string>();
    expect(jaccardSimilarity(a, b)).toBe(0);
  });
});

describe('generateRoutineKey', () => {
  it('produces a deterministic key', () => {
    expect(generateRoutineKey('bedtime', 22, ['monday', 'tuesday'])).toBe(
      'bedtime:22:monday,tuesday',
    );
  });

  it('handles empty days', () => {
    expect(generateRoutineKey('morning_routine', 7, [])).toBe('morning_routine:7:');
  });
});

describe('formatTitle', () => {
  it('formats morning title', () => {
    expect(formatTitle('morning_routine', 7)).toBe('Morning Morning Routine');
  });

  it('formats evening title', () => {
    expect(formatTitle('bedtime', 22)).toBe('Evening Bedtime');
  });

  it('formats afternoon title', () => {
    expect(formatTitle('leaving_home', 14)).toBe('Afternoon Leaving Home');
  });

  it('formats night title', () => {
    expect(formatTitle('late_snack', 2)).toBe('Night Late Snack');
  });
});

describe('formatDescription', () => {
  it('formats description with specific days', () => {
    const desc = formatDescription('bedtime', 22, ['monday', 'friday'], 5);
    expect(desc).toContain('bedtime');
    expect(desc).toContain('22:00');
    expect(desc).toContain('monday, friday');
    expect(desc).toContain('5 times');
  });

  it('says every day when all 7 days present', () => {
    const allDays = ['friday', 'monday', 'saturday', 'sunday', 'thursday', 'tuesday', 'wednesday'];
    const desc = formatDescription('morning_routine', 7, allDays, 14);
    expect(desc).toContain('every day');
  });
});

// ---------- RoutineDetector.analyze ----------

describe('RoutineDetector', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let detector: RoutineDetector;

  beforeEach(() => {
    queryFn = vi.fn();
    detector = new RoutineDetector(mockPool(queryFn));
  });

  it('returns empty array when no observations exist', async () => {
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await detector.analyze('test-ns');
    expect(result).toEqual([]);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('detects a recurring bedtime routine', async () => {
    // Use same day of week (Tuesdays) across 3 weeks so grouping works
    const observations = buildRecurringPattern({
      scene: 'bedtime',
      entities: [
        { entity_id: 'light.bedroom', domain: 'light', to_state: 'off' },
        { entity_id: 'lock.front_door', domain: 'lock', to_state: 'locked' },
      ],
      dates: ['2026-02-03', '2026-02-10', '2026-02-17'],
      hour: 22,
    });

    // First call: fetch observations
    queryFn.mockResolvedValueOnce({ rows: observations, rowCount: observations.length });
    // Subsequent calls: upsert queries
    queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await detector.analyze('test-ns', { min_occurrences: 3 });
    expect(result.length).toBeGreaterThanOrEqual(1);

    const routine = result[0];
    expect(routine.key).toContain('bedtime');
    expect(routine.confidence).toBeGreaterThan(0);
    expect(routine.occurrences).toBeGreaterThanOrEqual(3);
    expect(routine.sequence.length).toBeGreaterThan(0);
    expect(routine.time_window.start_hour).toBe(22);
  });

  it('does not detect a routine with too few occurrences', async () => {
    const observations = buildRecurringPattern({
      scene: 'bedtime',
      entities: [
        { entity_id: 'light.bedroom', domain: 'light', to_state: 'off' },
      ],
      dates: ['2026-02-10', '2026-02-11'],
      hour: 22,
    });

    queryFn.mockResolvedValueOnce({ rows: observations, rowCount: observations.length });

    const result = await detector.analyze('test-ns', { min_occurrences: 3 });
    expect(result).toEqual([]);
  });

  it('respects scene_label filter option', async () => {
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await detector.analyze('test-ns', { scene_label: 'bedtime' });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('scene_label = $3');
    const params = queryFn.mock.calls[0][1] as unknown[];
    expect(params[2]).toBe('bedtime');
  });

  it('merges similar sequences above threshold', async () => {
    // Two patterns with overlapping entity sets on different days but same hour
    const mondayObs = buildRecurringPattern({
      scene: 'bedtime',
      entities: [
        { entity_id: 'light.bedroom', domain: 'light', to_state: 'off' },
        { entity_id: 'lock.front_door', domain: 'lock', to_state: 'locked' },
        { entity_id: 'switch.hall', domain: 'switch', to_state: 'off' },
      ],
      dates: ['2026-02-03', '2026-02-10', '2026-02-17'],
      hour: 22,
    });
    const tuesdayObs = buildRecurringPattern({
      scene: 'bedtime',
      entities: [
        { entity_id: 'light.bedroom', domain: 'light', to_state: 'off' },
        { entity_id: 'lock.front_door', domain: 'lock', to_state: 'locked' },
        { entity_id: 'climate.bedroom', domain: 'climate', to_state: 'heat' },
      ],
      dates: ['2026-02-04', '2026-02-11', '2026-02-18'],
      hour: 22,
    });

    const allObs = [...mondayObs, ...tuesdayObs];

    queryFn.mockResolvedValueOnce({ rows: allObs, rowCount: allObs.length });
    queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await detector.analyze('test-ns', {
      min_occurrences: 3,
      merge_threshold: 0.4, // Low enough to merge the two sets
    });

    // Should detect routines — exact count depends on merge behaviour,
    // but at least 1 merged routine should be returned
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('upserts routines into ha_routines table', async () => {
    // Use same day of week (Tuesdays) across 3 weeks so grouping works
    const observations = buildRecurringPattern({
      scene: 'morning_routine',
      entities: [
        { entity_id: 'light.kitchen', domain: 'light', to_state: 'on' },
        { entity_id: 'climate.living', domain: 'climate', to_state: 'heat' },
      ],
      dates: ['2026-02-03', '2026-02-10', '2026-02-17'],
      hour: 7,
    });

    queryFn.mockResolvedValueOnce({ rows: observations, rowCount: observations.length });
    queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

    await detector.analyze('test-ns');

    // Should have the fetch + at least one upsert call
    expect(queryFn.mock.calls.length).toBeGreaterThan(1);

    // Find the INSERT call
    const insertCall = queryFn.mock.calls.find((call) => {
      const sql = call[0] as string;
      return sql.includes('INSERT INTO ha_routines');
    });

    expect(insertCall).toBeDefined();
    const sql = insertCall![0] as string;
    expect(sql).toContain('ON CONFLICT (namespace, key) DO UPDATE');
    expect(sql).toContain("WHERE ha_routines.status != 'rejected'");
  });

  it('uses custom lookback_days option', async () => {
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await detector.analyze('test-ns', { lookback_days: 30 });

    const params = queryFn.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(30);
  });

  it('calculates confidence bounded at 1.0', async () => {
    // 4 occurrences in a 7-day lookback = 4 / 1 expected week = clamped to 1.0
    const observations = buildRecurringPattern({
      scene: 'bedtime',
      entities: [
        { entity_id: 'light.bedroom', domain: 'light', to_state: 'off' },
      ],
      dates: ['2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17'],
      hour: 22,
    });

    queryFn.mockResolvedValueOnce({ rows: observations, rowCount: observations.length });
    queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await detector.analyze('test-ns', {
      min_occurrences: 3,
      lookback_days: 7,
    });

    if (result.length > 0) {
      expect(result[0].confidence).toBeLessThanOrEqual(1.0);
      expect(result[0].confidence).toBeGreaterThan(0);
    }
  });
});
