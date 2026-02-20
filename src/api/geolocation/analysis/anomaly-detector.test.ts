/**
 * Tests for AnomalyDetector.
 * Issue #1458, Epic #1440.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';

import {
  AnomalyDetector,
  type DetectedAnomaly,
  type RoutineRow,
  type ObservationInput,
} from './anomaly-detector.ts';
import type { ObservationContext } from '../ha-observation-scorer.ts';

// ---------- helpers ----------

function mockPool(queryFn: ReturnType<typeof vi.fn>): Pool {
  return { query: queryFn } as unknown as Pool;
}

function makeRoutine(overrides: Partial<RoutineRow> = {}): RoutineRow {
  return {
    id: 'routine-1',
    namespace: 'test-ns',
    key: 'bedtime:22:monday,tuesday',
    title: 'Evening Bedtime',
    confidence: 0.8,
    time_window: { start_hour: 22, end_hour: 23, avg_duration_minutes: 15 },
    days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    sequence: [
      { entity_id: 'light.bedroom', domain: 'light', to_state: 'off', offset_minutes: 0 },
      { entity_id: 'lock.front_door', domain: 'lock', to_state: 'locked', offset_minutes: 2 },
    ],
    ...overrides,
  };
}

function makeObs(overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    entity_id: 'light.bedroom',
    domain: 'light',
    to_state: 'off',
    score: 5,
    scene_label: 'bedtime',
    timestamp: new Date('2026-02-18T22:00:00Z'),
    ...overrides,
  };
}

function makeContext(overrides: Partial<ObservationContext> = {}): ObservationContext {
  return {
    day_of_week: 'wednesday',
    time_bucket: 'night_late',
    is_weekend: false,
    ...overrides,
  };
}

// ---------- tests ----------

describe('AnomalyDetector', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let detector: AnomalyDetector;

  beforeEach(() => {
    queryFn = vi.fn();
    detector = new AnomalyDetector(mockPool(queryFn));
  });

  describe('cold-start', () => {
    it('returns no non-escalation anomalies when no confirmed routines exist', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await detector.evaluate(
        [makeObs()], // normal observation (light off)
        makeContext(),
        'test-ns',
      );

      // Non-escalation observations should produce no anomalies during cold start
      const nonEscalation = result.filter((a) => a.type !== 'escalation');
      expect(nonEscalation).toEqual([]);
    });

    it('still detects escalation events during cold-start (no routines)', async () => {
      // Return no confirmed routines
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // Store anomaly
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        makeObs({
          entity_id: 'alarm_control_panel.home',
          domain: 'alarm_control_panel',
          to_state: 'triggered',
          score: 9,
        }),
      ];

      const result = await detector.evaluate(
        observations,
        makeContext({ time_bucket: 'night' }),
        'test-ns',
      );

      const escalations = result.filter((a) => a.type === 'escalation');
      expect(escalations.length).toBe(1);
      expect(escalations[0].score).toBe(10);
      expect(escalations[0].should_notify).toBe(true);
    });

    it('checkMissing returns empty when no confirmed routines exist', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await detector.checkMissing('test-ns');
      expect(result).toEqual([]);
    });
  });

  describe('unexpected_activity', () => {
    it('detects unexpected entity changes during active routine window', async () => {
      const routine = makeRoutine();

      // Return confirmed routine
      queryFn.mockResolvedValueOnce({ rows: [routine], rowCount: 1 });
      // Store anomaly
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        // This entity is NOT in the routine sequence
        makeObs({
          entity_id: 'switch.garage',
          domain: 'switch',
          to_state: 'on',
          score: 5,
        }),
      ];

      const result = await detector.evaluate(
        observations,
        makeContext(),
        'test-ns',
      );

      const unexpected = result.filter((a) => a.type === 'unexpected_activity');
      expect(unexpected.length).toBe(1);
      expect(unexpected[0].entities).toContain('switch.garage');
      expect(unexpected[0].score).toBeGreaterThanOrEqual(1);
    });

    it('does not flag activity matching active routine', async () => {
      const routine = makeRoutine();

      queryFn.mockResolvedValueOnce({ rows: [routine], rowCount: 1 });
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        // This matches the routine sequence exactly
        makeObs({ entity_id: 'light.bedroom', to_state: 'off', score: 5 }),
      ];

      const result = await detector.evaluate(
        observations,
        makeContext(),
        'test-ns',
      );

      const unexpected = result.filter((a) => a.type === 'unexpected_activity');
      expect(unexpected.length).toBe(0);
    });
  });

  describe('routine_deviation', () => {
    it('detects when routine entity goes to unexpected state', async () => {
      const routine = makeRoutine();

      queryFn.mockResolvedValueOnce({ rows: [routine], rowCount: 1 });
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        // Bedroom light turned ON instead of OFF (deviation)
        makeObs({ entity_id: 'light.bedroom', to_state: 'on', score: 5 }),
      ];

      const result = await detector.evaluate(
        observations,
        makeContext(),
        'test-ns',
      );

      const deviations = result.filter((a) => a.type === 'routine_deviation');
      expect(deviations.length).toBe(1);
      expect(deviations[0].routine_id).toBe('routine-1');
      expect(deviations[0].reason).toContain('expected off');
      expect(deviations[0].reason).toContain('got on');
    });

    it('does not flag deviations when routine is not active', async () => {
      const routine = makeRoutine({
        days: ['saturday'], // Not active on wednesday
      });

      queryFn.mockResolvedValueOnce({ rows: [routine], rowCount: 1 });
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        makeObs({ entity_id: 'light.bedroom', to_state: 'on', score: 5 }),
      ];

      const result = await detector.evaluate(
        observations,
        makeContext(),
        'test-ns',
      );

      const deviations = result.filter((a) => a.type === 'routine_deviation');
      expect(deviations.length).toBe(0);
    });
  });

  describe('escalation', () => {
    it('detects critical entity state change at night', async () => {
      queryFn.mockResolvedValueOnce({ rows: [makeRoutine()], rowCount: 1 });
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        makeObs({
          entity_id: 'alarm_control_panel.home',
          domain: 'alarm_control_panel',
          to_state: 'triggered',
          score: 9,
        }),
      ];

      const result = await detector.evaluate(
        observations,
        makeContext({ time_bucket: 'night' }),
        'test-ns',
      );

      const escalations = result.filter((a) => a.type === 'escalation');
      expect(escalations.length).toBe(1);
      expect(escalations[0].score).toBe(10); // Night = max score
      expect(escalations[0].should_notify).toBe(true);
    });

    it('detects lock unlocked as escalation', async () => {
      queryFn.mockResolvedValueOnce({ rows: [makeRoutine()], rowCount: 1 });
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        makeObs({
          entity_id: 'lock.front_door',
          domain: 'lock',
          to_state: 'unlocked',
          score: 7,
        }),
      ];

      const result = await detector.evaluate(
        observations,
        makeContext({ time_bucket: 'afternoon' }),
        'test-ns',
      );

      const escalations = result.filter((a) => a.type === 'escalation');
      expect(escalations.length).toBe(1);
      expect(escalations[0].score).toBe(8); // Daytime = lower score
      expect(escalations[0].should_notify).toBe(true);
    });

    it('does not escalate normal domain/state combinations', async () => {
      queryFn.mockResolvedValueOnce({ rows: [makeRoutine()], rowCount: 1 });
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        makeObs({ entity_id: 'light.living', domain: 'light', to_state: 'on', score: 3 }),
      ];

      const result = await detector.evaluate(
        observations,
        makeContext(),
        'test-ns',
      );

      const escalations = result.filter((a) => a.type === 'escalation');
      expect(escalations.length).toBe(0);
    });
  });

  describe('missing_routine', () => {
    it('detects missing routine when expected window has passed', async () => {
      const routine = makeRoutine({
        time_window: { start_hour: 7, end_hour: 8, avg_duration_minutes: 30 },
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      });

      // Fetch routines
      queryFn.mockResolvedValueOnce({ rows: [routine], rowCount: 1 });
      // Check recent observations — none found
      queryFn.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });
      // Store anomaly
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      // Mock current time to be after the routine window
      const now = new Date('2026-02-18T12:00:00Z'); // Wednesday noon
      vi.useFakeTimers();
      vi.setSystemTime(now);

      try {
        const result = await detector.checkMissing('test-ns');

        const missing = result.filter((a) => a.type === 'missing_routine');
        expect(missing.length).toBe(1);
        expect(missing[0].routine_id).toBe('routine-1');
        expect(missing[0].reason).toContain('did not occur');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not flag missing when routine window has not passed yet', async () => {
      const routine = makeRoutine({
        time_window: { start_hour: 22, end_hour: 23, avg_duration_minutes: 30 },
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      });

      queryFn.mockResolvedValueOnce({ rows: [routine], rowCount: 1 });

      // Current time is before the routine window end
      const now = new Date('2026-02-18T20:00:00Z'); // 20:00 < 23:00
      vi.useFakeTimers();
      vi.setSystemTime(now);

      try {
        const result = await detector.checkMissing('test-ns');
        expect(result).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not flag missing when observations exist in window', async () => {
      const routine = makeRoutine({
        time_window: { start_hour: 7, end_hour: 8, avg_duration_minutes: 30 },
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      });

      queryFn.mockResolvedValueOnce({ rows: [routine], rowCount: 1 });
      // Observations found!
      queryFn.mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1 });

      const now = new Date('2026-02-18T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      try {
        const result = await detector.checkMissing('test-ns');
        expect(result).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('notification thresholds', () => {
    it('scores 1-4 do not trigger notification', async () => {
      const routine = makeRoutine({
        confidence: 0.1, // Low confidence → low missing score
        time_window: { start_hour: 7, end_hour: 8, avg_duration_minutes: 30 },
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      });

      queryFn.mockResolvedValueOnce({ rows: [routine], rowCount: 1 });
      queryFn.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const now = new Date('2026-02-18T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      try {
        const result = await detector.checkMissing('test-ns');
        if (result.length > 0 && result[0].score < 5) {
          expect(result[0].should_notify).toBe(false);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('escalation scores >= 8 always notify', async () => {
      queryFn.mockResolvedValueOnce({ rows: [makeRoutine()], rowCount: 1 });
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        makeObs({
          entity_id: 'alarm_control_panel.home',
          domain: 'alarm_control_panel',
          to_state: 'triggered',
          score: 9,
        }),
      ];

      const result = await detector.evaluate(
        observations,
        makeContext({ time_bucket: 'night' }),
        'test-ns',
      );

      const escalations = result.filter((a) => a.type === 'escalation');
      expect(escalations.length).toBe(1);
      expect(escalations[0].score).toBeGreaterThanOrEqual(8);
      expect(escalations[0].should_notify).toBe(true);
    });
  });

  describe('persistence', () => {
    it('stores anomalies in ha_anomalies table', async () => {
      queryFn.mockResolvedValueOnce({ rows: [makeRoutine()], rowCount: 1 });
      queryFn.mockResolvedValue({ rows: [], rowCount: 1 });

      const observations: ObservationInput[] = [
        makeObs({
          entity_id: 'alarm_control_panel.home',
          domain: 'alarm_control_panel',
          to_state: 'triggered',
          score: 9,
        }),
      ];

      await detector.evaluate(
        observations,
        makeContext({ time_bucket: 'night' }),
        'test-ns',
      );

      // Find INSERT calls
      const insertCalls = queryFn.mock.calls.filter((call) => {
        const sql = call[0] as string;
        return sql.includes('INSERT INTO ha_anomalies');
      });

      expect(insertCalls.length).toBeGreaterThan(0);
      const params = insertCalls[0][1] as unknown[];
      expect(params[0]).toBe('test-ns'); // namespace
    });
  });
});
