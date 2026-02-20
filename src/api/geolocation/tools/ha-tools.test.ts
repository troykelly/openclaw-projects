/**
 * Tests for Home Assistant OpenClaw agent tools.
 * Issue #1462, Epic #1440.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';

import {
  executeObservationsQuery,
  HA_OBSERVATIONS_QUERY_TOOL,
  type HaObservationsQueryParams,
} from './ha-observations-tool.ts';

import {
  executeRoutinesList,
  executeRoutineUpdate,
  HA_ROUTINES_LIST_TOOL,
  HA_ROUTINE_UPDATE_TOOL,
  type HaRoutinesListParams,
  type HaRoutineUpdateParams,
} from './ha-routines-tool.ts';

import {
  executeAnomaliesList,
  executeAnomalyResolve,
  HA_ANOMALIES_LIST_TOOL,
  HA_ANOMALY_RESOLVE_TOOL,
  type HaAnomaliesListParams,
  type HaAnomalyResolveParams,
} from './ha-anomalies-tool.ts';

// ---------- helpers ----------

function mockPool(queryFn: ReturnType<typeof vi.fn>): Pool {
  return { query: queryFn } as unknown as Pool;
}

const TEST_NS = 'test-namespace';

// ---------- tool metadata tests ----------

describe('tool metadata', () => {
  it('ha_observations_query has correct metadata', () => {
    expect(HA_OBSERVATIONS_QUERY_TOOL.name).toBe('ha_observations_query');
    expect(HA_OBSERVATIONS_QUERY_TOOL.description).toBeTruthy();
    expect(HA_OBSERVATIONS_QUERY_TOOL.parameters.type).toBe('object');
    expect(HA_OBSERVATIONS_QUERY_TOOL.parameters.properties).toHaveProperty('from');
    expect(HA_OBSERVATIONS_QUERY_TOOL.parameters.properties).toHaveProperty('to');
    expect(HA_OBSERVATIONS_QUERY_TOOL.parameters.properties).toHaveProperty('entity_id');
    expect(HA_OBSERVATIONS_QUERY_TOOL.parameters.properties).toHaveProperty('domain');
    expect(HA_OBSERVATIONS_QUERY_TOOL.parameters.properties).toHaveProperty('min_score');
    expect(HA_OBSERVATIONS_QUERY_TOOL.parameters.properties).toHaveProperty('scene_label');
    expect(HA_OBSERVATIONS_QUERY_TOOL.parameters.properties).toHaveProperty('limit');
  });

  it('ha_routines_list has correct metadata', () => {
    expect(HA_ROUTINES_LIST_TOOL.name).toBe('ha_routines_list');
    expect(HA_ROUTINES_LIST_TOOL.description).toBeTruthy();
    expect(HA_ROUTINES_LIST_TOOL.parameters.properties).toHaveProperty('status');
    expect(HA_ROUTINES_LIST_TOOL.parameters.properties).toHaveProperty('min_confidence');
  });

  it('ha_routine_update has correct metadata', () => {
    expect(HA_ROUTINE_UPDATE_TOOL.name).toBe('ha_routine_update');
    expect(HA_ROUTINE_UPDATE_TOOL.description).toBeTruthy();
    expect(HA_ROUTINE_UPDATE_TOOL.parameters.required).toContain('routine_id');
    expect(HA_ROUTINE_UPDATE_TOOL.parameters.properties).toHaveProperty('status');
    expect(HA_ROUTINE_UPDATE_TOOL.parameters.properties).toHaveProperty('title');
    expect(HA_ROUTINE_UPDATE_TOOL.parameters.properties).toHaveProperty('description');
  });

  it('ha_anomalies_list has correct metadata', () => {
    expect(HA_ANOMALIES_LIST_TOOL.name).toBe('ha_anomalies_list');
    expect(HA_ANOMALIES_LIST_TOOL.description).toBeTruthy();
    expect(HA_ANOMALIES_LIST_TOOL.parameters.properties).toHaveProperty('type');
    expect(HA_ANOMALIES_LIST_TOOL.parameters.properties).toHaveProperty('resolved');
    expect(HA_ANOMALIES_LIST_TOOL.parameters.properties).toHaveProperty('min_score');
  });

  it('ha_anomaly_resolve has correct metadata', () => {
    expect(HA_ANOMALY_RESOLVE_TOOL.name).toBe('ha_anomaly_resolve');
    expect(HA_ANOMALY_RESOLVE_TOOL.description).toBeTruthy();
    expect(HA_ANOMALY_RESOLVE_TOOL.parameters.required).toContain('anomaly_id');
    expect(HA_ANOMALY_RESOLVE_TOOL.parameters.properties).toHaveProperty('notes');
  });
});

// ---------- executeObservationsQuery ----------

describe('executeObservationsQuery', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let pool: Pool;

  beforeEach(() => {
    queryFn = vi.fn();
    pool = mockPool(queryFn);
  });

  it('queries with namespace only when no filters given', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const result = await executeObservationsQuery(pool, TEST_NS, {});

    expect(result.total).toBe(0);
    expect(result.observations).toEqual([]);
    expect(result.query_summary).toContain('Found 0');

    // Should have called with namespace = $1 only
    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('namespace = $1');
  });

  it('applies entity_id filter', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeObservationsQuery(pool, TEST_NS, { entity_id: 'light.bedroom' });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('entity_id = $2');
    const params = queryFn.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe('light.bedroom');
  });

  it('applies domain filter', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeObservationsQuery(pool, TEST_NS, { domain: 'light' });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('domain = $2');
  });

  it('applies min_score filter', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeObservationsQuery(pool, TEST_NS, { min_score: 5 });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('score >= $2');
    const params = queryFn.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(5);
  });

  it('applies scene_label filter', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeObservationsQuery(pool, TEST_NS, { scene_label: 'bedtime' });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('scene_label = $2');
  });

  it('applies time range filters', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeObservationsQuery(pool, TEST_NS, {
      from: '2026-02-18T00:00:00Z',
      to: '2026-02-20T23:59:59Z',
    });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('timestamp >= $2');
    expect(sql).toContain('timestamp <= $3');
  });

  it('clamps limit to MAX_LIMIT', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeObservationsQuery(pool, TEST_NS, { limit: 999 });

    const params = queryFn.mock.calls[0][1] as unknown[];
    // Last param should be clamped to 200
    expect(params[params.length - 1]).toBe(200);
  });

  it('returns error summary for invalid from date', async () => {
    const result = await executeObservationsQuery(pool, TEST_NS, { from: 'not-a-date' });

    expect(result.total).toBe(0);
    expect(result.query_summary).toContain('Invalid');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('returns error summary for invalid to date', async () => {
    const result = await executeObservationsQuery(pool, TEST_NS, { to: 'garbage' });

    expect(result.total).toBe(0);
    expect(result.query_summary).toContain('Invalid');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('returns results with query summary', async () => {
    const fakeObs = [
      {
        entity_id: 'light.bedroom',
        domain: 'light',
        from_state: 'on',
        to_state: 'off',
        score: 5,
        scene_label: 'bedtime',
        timestamp: '2026-02-19T22:00:00Z',
        attributes: {},
      },
    ];
    queryFn.mockResolvedValueOnce({ rows: fakeObs });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const result = await executeObservationsQuery(pool, TEST_NS, { entity_id: 'light.bedroom' });

    expect(result.observations).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.query_summary).toContain('Found 1');
    expect(result.query_summary).toContain('entity=light.bedroom');
  });

  it('applies multiple filters simultaneously', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeObservationsQuery(pool, TEST_NS, {
      entity_id: 'light.bedroom',
      domain: 'light',
      min_score: 3,
      scene_label: 'bedtime',
    });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('entity_id = $2');
    expect(sql).toContain('domain = $3');
    expect(sql).toContain('score >= $4');
    expect(sql).toContain('scene_label = $5');
  });
});

// ---------- executeRoutinesList ----------

describe('executeRoutinesList', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let pool: Pool;

  beforeEach(() => {
    queryFn = vi.fn();
    pool = mockPool(queryFn);
  });

  it('queries with namespace only when no filters given', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const result = await executeRoutinesList(pool, TEST_NS, {});

    expect(result.total).toBe(0);
    expect(result.routines).toEqual([]);
  });

  it('applies status filter', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeRoutinesList(pool, TEST_NS, { status: 'confirmed' });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('status = $2');
    const params = queryFn.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe('confirmed');
  });

  it('rejects invalid status', async () => {
    const result = await executeRoutinesList(pool, TEST_NS, { status: 'bogus' });

    expect(result.total).toBe(0);
    expect(result.query_summary).toContain('Invalid status');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('applies min_confidence filter', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeRoutinesList(pool, TEST_NS, { min_confidence: 0.7 });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('confidence >= $2');
    const params = queryFn.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(0.7);
  });

  it('returns routines with query summary', async () => {
    const fakeRoutine = {
      id: '00000000-0000-0000-0000-000000000001',
      key: 'bedtime:22:monday',
      title: 'Evening Bedtime',
      description: 'Detected pattern',
      confidence: 0.85,
      status: 'confirmed',
      observations_count: 10,
      first_seen: '2026-02-01',
      last_seen: '2026-02-19',
      time_window: { start_hour: 22, end_hour: 23, avg_duration_minutes: 15 },
      days: ['monday', 'tuesday'],
      sequence: [{ entity_id: 'light.bedroom', domain: 'light', to_state: 'off', offset_minutes: 0 }],
    };
    queryFn.mockResolvedValueOnce({ rows: [fakeRoutine] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const result = await executeRoutinesList(pool, TEST_NS, { status: 'confirmed' });

    expect(result.routines).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.query_summary).toContain('Found 1');
  });
});

// ---------- executeRoutineUpdate ----------

describe('executeRoutineUpdate', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let pool: Pool;

  beforeEach(() => {
    queryFn = vi.fn();
    pool = mockPool(queryFn);
  });

  it('rejects invalid UUID', async () => {
    const result = await executeRoutineUpdate(pool, TEST_NS, {
      routine_id: 'not-a-uuid',
      status: 'confirmed',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid routine_id');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('rejects invalid status', async () => {
    const result = await executeRoutineUpdate(pool, TEST_NS, {
      routine_id: '00000000-0000-0000-0000-000000000001',
      status: 'invalid' as HaRoutineUpdateParams['status'],
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid status');
  });

  it('rejects empty update', async () => {
    const result = await executeRoutineUpdate(pool, TEST_NS, {
      routine_id: '00000000-0000-0000-0000-000000000001',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('at least one field');
  });

  it('rejects empty title', async () => {
    const result = await executeRoutineUpdate(pool, TEST_NS, {
      routine_id: '00000000-0000-0000-0000-000000000001',
      title: '   ',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Title must be a non-empty string');
  });

  it('updates status successfully', async () => {
    const fakeRoutine = {
      id: '00000000-0000-0000-0000-000000000001',
      key: 'bedtime:22:monday',
      title: 'Evening Bedtime',
      description: null,
      confidence: 0.85,
      status: 'confirmed',
      observations_count: 10,
      first_seen: '2026-02-01',
      last_seen: '2026-02-19',
      time_window: { start_hour: 22, end_hour: 23, avg_duration_minutes: 15 },
      days: ['monday'],
      sequence: [],
    };
    queryFn.mockResolvedValueOnce({ rows: [fakeRoutine] });

    const result = await executeRoutineUpdate(pool, TEST_NS, {
      routine_id: '00000000-0000-0000-0000-000000000001',
      status: 'confirmed',
    });

    expect(result.success).toBe(true);
    expect(result.routine).toBeDefined();
    expect(result.message).toContain('updated successfully');

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE ha_routines SET');
    expect(sql).toContain('status = $3');
    expect(sql).toContain('namespace = $2');
  });

  it('updates title and description', async () => {
    const fakeRoutine = {
      id: '00000000-0000-0000-0000-000000000001',
      key: 'bedtime:22:monday',
      title: 'New Title',
      description: 'New desc',
      confidence: 0.85,
      status: 'tentative',
      observations_count: 10,
      first_seen: '2026-02-01',
      last_seen: '2026-02-19',
      time_window: { start_hour: 22, end_hour: 23, avg_duration_minutes: 15 },
      days: ['monday'],
      sequence: [],
    };
    queryFn.mockResolvedValueOnce({ rows: [fakeRoutine] });

    const result = await executeRoutineUpdate(pool, TEST_NS, {
      routine_id: '00000000-0000-0000-0000-000000000001',
      title: 'New Title',
      description: 'New desc',
    });

    expect(result.success).toBe(true);

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('title = $3');
    expect(sql).toContain('description = $4');
  });

  it('returns not found for missing routine', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });

    const result = await executeRoutineUpdate(pool, TEST_NS, {
      routine_id: '00000000-0000-0000-0000-000000000001',
      status: 'confirmed',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});

// ---------- executeAnomaliesList ----------

describe('executeAnomaliesList', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let pool: Pool;

  beforeEach(() => {
    queryFn = vi.fn();
    pool = mockPool(queryFn);
  });

  it('queries with namespace only when no filters given', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const result = await executeAnomaliesList(pool, TEST_NS, {});

    expect(result.total).toBe(0);
    expect(result.anomalies).toEqual([]);
  });

  it('applies resolved filter', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeAnomaliesList(pool, TEST_NS, { resolved: false });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('resolved = $2');
    const params = queryFn.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(false);
  });

  it('applies min_score filter', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeAnomaliesList(pool, TEST_NS, { min_score: 5 });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('score >= $2');
  });

  it('rejects invalid anomaly type', async () => {
    const result = await executeAnomaliesList(pool, TEST_NS, { type: 'bogus' });

    expect(result.total).toBe(0);
    expect(result.query_summary).toContain('Invalid anomaly type');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('applies type filter via context JSONB', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '0' }] });

    await executeAnomaliesList(pool, TEST_NS, { type: 'escalation' });

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain("context->>'type'");
    const params = queryFn.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe('escalation');
  });

  it('returns anomalies with query summary', async () => {
    const fakeAnomaly = {
      id: '00000000-0000-0000-0000-000000000001',
      timestamp: '2026-02-19T22:00:00Z',
      routine_id: null,
      score: 8,
      reason: 'Critical entity alarm changed',
      entities: ['alarm_control_panel.home'],
      notified: true,
      resolved: false,
      context: { type: 'escalation' },
    };
    queryFn.mockResolvedValueOnce({ rows: [fakeAnomaly] });
    queryFn.mockResolvedValueOnce({ rows: [{ total: '1' }] });

    const result = await executeAnomaliesList(pool, TEST_NS, { resolved: false });

    expect(result.anomalies).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.query_summary).toContain('Found 1');
  });
});

// ---------- executeAnomalyResolve ----------

describe('executeAnomalyResolve', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let pool: Pool;

  beforeEach(() => {
    queryFn = vi.fn();
    pool = mockPool(queryFn);
  });

  it('rejects invalid UUID', async () => {
    const result = await executeAnomalyResolve(pool, TEST_NS, {
      anomaly_id: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid anomaly_id');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('resolves anomaly without notes', async () => {
    const fakeAnomaly = {
      id: '00000000-0000-0000-0000-000000000001',
      timestamp: '2026-02-19T22:00:00Z',
      routine_id: null,
      score: 8,
      reason: 'Critical entity alarm changed',
      entities: ['alarm_control_panel.home'],
      notified: true,
      resolved: true,
      context: {},
    };
    queryFn.mockResolvedValueOnce({ rows: [fakeAnomaly] });

    const result = await executeAnomalyResolve(pool, TEST_NS, {
      anomaly_id: '00000000-0000-0000-0000-000000000001',
    });

    expect(result.success).toBe(true);
    expect(result.anomaly).toBeDefined();

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('resolved = TRUE');
    expect(sql).toContain('namespace = $2');
  });

  it('resolves anomaly with notes', async () => {
    const fakeAnomaly = {
      id: '00000000-0000-0000-0000-000000000001',
      timestamp: '2026-02-19T22:00:00Z',
      routine_id: null,
      score: 8,
      reason: 'Critical entity alarm changed',
      entities: ['alarm_control_panel.home'],
      notified: true,
      resolved: true,
      context: { resolution_notes: 'Expected maintenance' },
    };
    queryFn.mockResolvedValueOnce({ rows: [fakeAnomaly] });

    const result = await executeAnomalyResolve(pool, TEST_NS, {
      anomaly_id: '00000000-0000-0000-0000-000000000001',
      notes: 'Expected maintenance',
    });

    expect(result.success).toBe(true);

    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('resolution_notes');
    expect(sql).toContain('jsonb_build_object');
  });

  it('returns not found for missing anomaly', async () => {
    queryFn.mockResolvedValueOnce({ rows: [] });

    const result = await executeAnomalyResolve(pool, TEST_NS, {
      anomaly_id: '00000000-0000-0000-0000-000000000001',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });
});
