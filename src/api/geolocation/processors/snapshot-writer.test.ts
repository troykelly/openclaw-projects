/**
 * Tests for the daily state snapshot writer.
 * Issue #1470.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import {
  compressStates,
  detectNotableStates,
  fetchHaStates,
  upsertSnapshot,
  SnapshotWriter,
} from './snapshot-writer.ts';
import type { HaEntityState, StateSnapshot } from './snapshot-writer.ts';

// ---------- helpers ----------

function mockPool(queryResults?: Array<{ rows: unknown[]; rowCount: number }>): Pool {
  const queryFn = vi.fn();
  if (queryResults) {
    for (const r of queryResults) {
      queryFn.mockResolvedValueOnce(r);
    }
  } else {
    queryFn.mockResolvedValue({ rows: [], rowCount: 0 });
  }
  return { query: queryFn } as unknown as Pool;
}

function makeEntity(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
  lastChanged?: string,
): HaEntityState {
  return {
    entity_id: entityId,
    state,
    attributes,
    last_changed: lastChanged ?? new Date().toISOString(),
    last_updated: lastChanged ?? new Date().toISOString(),
  };
}

describe('snapshot-writer', () => {
  describe('compressStates', () => {
    it('counts total entities', () => {
      const entities = [
        makeEntity('light.kitchen', 'on'),
        makeEntity('light.bedroom', 'off'),
        makeEntity('sensor.temperature_outside', '22.5'),
      ];

      const snapshot = compressStates(entities);

      expect(snapshot.entity_count).toBe(3);
    });

    it('builds domain summary with on/off/unavailable counts', () => {
      const entities = [
        makeEntity('light.kitchen', 'on'),
        makeEntity('light.bedroom', 'off'),
        makeEntity('light.garage', 'unavailable'),
        makeEntity('light.porch', 'on'),
      ];

      const snapshot = compressStates(entities);

      expect(snapshot.domain_summary.light).toEqual({
        total: 4,
        on: 2,
        off: 1,
        unavailable: 1,
      });
    });

    it('handles empty entity list', () => {
      const snapshot = compressStates([]);

      expect(snapshot.entity_count).toBe(0);
      expect(snapshot.active_count).toBe(0);
      expect(snapshot.domain_summary).toEqual({});
      expect(snapshot.notable_states).toEqual([]);
      expect(snapshot.people_home).toEqual([]);
      expect(snapshot.climate).toEqual({});
    });

    it('counts recently active entities', () => {
      const recentTime = new Date().toISOString();
      const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const entities = [
        makeEntity('light.kitchen', 'on', {}, recentTime),
        makeEntity('light.bedroom', 'off', {}, oldTime),
        makeEntity('sensor.temp', '22.5', {}, recentTime),
      ];

      const snapshot = compressStates(entities);

      expect(snapshot.active_count).toBe(2);
    });

    it('extracts people who are home', () => {
      const entities = [
        makeEntity('person.jane', 'home', { friendly_name: 'Jane' }),
        makeEntity('person.john', 'not_home', { friendly_name: 'John' }),
        makeEntity('person.bob', 'home', { friendly_name: 'Bob' }),
      ];

      const snapshot = compressStates(entities);

      expect(snapshot.people_home).toEqual(['Jane', 'Bob']);
    });

    it('uses entity_id as fallback for people without friendly_name', () => {
      const entities = [
        makeEntity('person.jane', 'home', {}),
      ];

      const snapshot = compressStates(entities);

      expect(snapshot.people_home).toEqual(['person.jane']);
    });

    it('extracts climate information', () => {
      const entities = [
        makeEntity('climate.living_room', 'heat', {
          current_temperature: 21.5,
          temperature: 23.0,
        }),
        makeEntity('climate.bedroom', 'cool', {
          current_temperature: 25.0,
          temperature: 22.0,
        }),
      ];

      const snapshot = compressStates(entities);

      expect(snapshot.climate['climate.living_room']).toEqual({
        current_temp: 21.5,
        target_temp: 23.0,
        mode: 'heat',
      });
      expect(snapshot.climate['climate.bedroom']).toEqual({
        current_temp: 25.0,
        target_temp: 22.0,
        mode: 'cool',
      });
    });

    it('defaults climate temps to 0 when missing', () => {
      const entities = [
        makeEntity('climate.spare', 'off', {}),
      ];

      const snapshot = compressStates(entities);

      expect(snapshot.climate['climate.spare']).toEqual({
        current_temp: 0,
        target_temp: 0,
        mode: 'off',
      });
    });

    it('handles multiple domains', () => {
      const entities = [
        makeEntity('light.kitchen', 'on'),
        makeEntity('switch.pump', 'on'),
        makeEntity('sensor.humidity', '65'),
        makeEntity('binary_sensor.door', 'off'),
      ];

      const snapshot = compressStates(entities);

      expect(Object.keys(snapshot.domain_summary)).toHaveLength(4);
      expect(snapshot.domain_summary.light.total).toBe(1);
      expect(snapshot.domain_summary.switch.total).toBe(1);
      expect(snapshot.domain_summary.sensor.total).toBe(1);
      expect(snapshot.domain_summary.binary_sensor.total).toBe(1);
    });

    it('counts numeric state entities as total only (not on/off/unavailable)', () => {
      const entities = [
        makeEntity('sensor.temperature', '22.5'),
      ];

      const snapshot = compressStates(entities);

      expect(snapshot.domain_summary.sensor).toEqual({
        total: 1,
        on: 0,
        off: 0,
        unavailable: 0,
      });
    });
  });

  describe('detectNotableStates', () => {
    it('detects low battery sensors', () => {
      const entities = [
        makeEntity('sensor.phone_battery', '15'),
        makeEntity('sensor.tablet_battery', '85'),
      ];

      const notable = detectNotableStates(entities);

      expect(notable).toHaveLength(1);
      expect(notable[0].entity_id).toBe('sensor.phone_battery');
      expect(notable[0].reason).toContain('Battery low');
      expect(notable[0].reason).toContain('15');
    });

    it('detects high temperature sensors', () => {
      const entities = [
        makeEntity('sensor.temperature_attic', '42'),
      ];

      const notable = detectNotableStates(entities);

      expect(notable).toHaveLength(1);
      expect(notable[0].reason).toContain('High temperature');
    });

    it('detects low temperature sensors', () => {
      const entities = [
        makeEntity('sensor.temperature_freezer', '2'),
      ];

      const notable = detectNotableStates(entities);

      expect(notable).toHaveLength(1);
      expect(notable[0].reason).toContain('Low temperature');
    });

    it('detects unavailable non-sensor entities', () => {
      const entities = [
        makeEntity('light.kitchen', 'unavailable'),
      ];

      const notable = detectNotableStates(entities);

      expect(notable).toHaveLength(1);
      expect(notable[0].reason).toBe('Entity unavailable');
    });

    it('does not flag unavailable sensors (too noisy)', () => {
      const entities = [
        makeEntity('sensor.some_sensor', 'unavailable'),
      ];

      const notable = detectNotableStates(entities);

      expect(notable).toHaveLength(0);
    });

    it('ignores battery sensors with valid levels', () => {
      const entities = [
        makeEntity('sensor.phone_battery', '85'),
      ];

      const notable = detectNotableStates(entities);

      expect(notable).toHaveLength(0);
    });

    it('ignores temperature sensors in normal range', () => {
      const entities = [
        makeEntity('sensor.temperature_living', '22'),
      ];

      const notable = detectNotableStates(entities);

      expect(notable).toHaveLength(0);
    });

    it('handles non-numeric battery state gracefully', () => {
      const entities = [
        makeEntity('sensor.phone_battery', 'unknown'),
      ];

      const notable = detectNotableStates(entities);

      expect(notable).toHaveLength(0);
    });

    it('returns empty array for no notable states', () => {
      const entities = [
        makeEntity('light.kitchen', 'on'),
        makeEntity('light.bedroom', 'off'),
      ];

      const notable = detectNotableStates(entities);

      expect(notable).toHaveLength(0);
    });
  });

  describe('fetchHaStates', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('fetches states from HA REST API with correct URL and headers', async () => {
      const mockResponse = [
        { entity_id: 'light.kitchen', state: 'on', attributes: {}, last_changed: '', last_updated: '' },
      ];
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchHaStates('http://ha.local:8123', 'test-token');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://ha.local:8123/api/states');
      expect(options.headers.Authorization).toBe('Bearer test-token');
      expect(result).toEqual(mockResponse);
    });

    it('strips trailing slash from HA URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });
      vi.stubGlobal('fetch', mockFetch);

      await fetchHaStates('http://ha.local:8123/', 'test-token');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://ha.local:8123/api/states');
    });

    it('returns null when HA returns non-OK status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchHaStates('http://ha.local:8123', 'test-token');

      expect(result).toBeNull();
    });

    it('returns null when HA returns non-array response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: 'unexpected' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchHaStates('http://ha.local:8123', 'test-token');

      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchHaStates('http://ha.local:8123', 'test-token');

      expect(result).toBeNull();
    });

    it('returns null on timeout', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchHaStates('http://ha.local:8123', 'test-token');

      expect(result).toBeNull();
    });
  });

  describe('upsertSnapshot', () => {
    it('inserts snapshot with correct SQL parameters', async () => {
      const pool = mockPool();
      const snapshot: StateSnapshot = {
        entity_count: 42,
        active_count: 15,
        domain_summary: { light: { total: 10, on: 5, off: 3, unavailable: 2 } },
        notable_states: [{ entity_id: 'light.broken', state: 'unavailable', reason: 'Entity unavailable' }],
        people_home: ['Jane'],
        climate: { 'climate.lr': { current_temp: 22, target_temp: 23, mode: 'heat' } },
      };

      const today = new Date('2026-02-20T00:00:00.000Z');
      await upsertSnapshot(pool, 'default', today, snapshot);

      const queryFn = pool.query as ReturnType<typeof vi.fn>;
      expect(queryFn).toHaveBeenCalledOnce();

      const [sql, params] = queryFn.mock.calls[0];
      expect(sql).toContain('INSERT INTO ha_state_snapshots');
      expect(sql).toContain('ON CONFLICT (namespace, snapshot_date) DO UPDATE');
      expect(params[0]).toBe('default');
      expect(params[1]).toEqual(today);
      expect(params[2]).toBe(42);
      expect(params[3]).toBe(15);

      // domain_summary is JSON-stringified
      const domainSummary = JSON.parse(params[4] as string);
      expect(domainSummary.light.total).toBe(10);

      // notable_states includes people_home and climate
      const notableData = JSON.parse(params[5] as string);
      expect(notableData.notable_states).toHaveLength(1);
      expect(notableData.people_home).toEqual(['Jane']);
      expect(notableData.climate['climate.lr'].mode).toBe('heat');
    });

    it('propagates database errors', async () => {
      const pool = {
        query: vi.fn().mockRejectedValue(new Error('connection refused')),
      } as unknown as Pool;

      const snapshot: StateSnapshot = {
        entity_count: 0,
        active_count: 0,
        domain_summary: {},
        notable_states: [],
        people_home: [],
        climate: {},
      };

      await expect(
        upsertSnapshot(pool, 'default', new Date(), snapshot),
      ).rejects.toThrow('connection refused');
    });
  });

  describe('SnapshotWriter', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('captures daily snapshot from HA states', async () => {
      const pool = mockPool();
      const writer = new SnapshotWriter(pool);

      const mockStates = [
        makeEntity('light.kitchen', 'on'),
        makeEntity('person.jane', 'home', { friendly_name: 'Jane' }),
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStates),
      });
      vi.stubGlobal('fetch', mockFetch);

      await writer.captureDaily('test-ns', 'http://ha.local:8123', 'token');

      const queryFn = pool.query as ReturnType<typeof vi.fn>;
      expect(queryFn).toHaveBeenCalledOnce();

      const [sql, params] = queryFn.mock.calls[0];
      expect(sql).toContain('INSERT INTO ha_state_snapshots');
      expect(params[0]).toBe('test-ns');
      expect(params[2]).toBe(2); // entity_count
    });

    it('skips gracefully when HA is unavailable', async () => {
      const pool = mockPool();
      const writer = new SnapshotWriter(pool);

      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', mockFetch);

      // Should not throw
      await writer.captureDaily('test-ns', 'http://ha.local:8123', 'token');

      const queryFn = pool.query as ReturnType<typeof vi.fn>;
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('skips gracefully when HA returns error status', async () => {
      const pool = mockPool();
      const writer = new SnapshotWriter(pool);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });
      vi.stubGlobal('fetch', mockFetch);

      await writer.captureDaily('test-ns', 'http://ha.local:8123', 'bad-token');

      const queryFn = pool.query as ReturnType<typeof vi.fn>;
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('uses todays date (UTC midnight) for the snapshot', async () => {
      const pool = mockPool();
      const writer = new SnapshotWriter(pool);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([makeEntity('light.test', 'on')]),
      });
      vi.stubGlobal('fetch', mockFetch);

      await writer.captureDaily('ns', 'http://ha.local:8123', 'token');

      const queryFn = pool.query as ReturnType<typeof vi.fn>;
      const snapshotDate = queryFn.mock.calls[0][1][1] as Date;
      expect(snapshotDate.getUTCHours()).toBe(0);
      expect(snapshotDate.getUTCMinutes()).toBe(0);
      expect(snapshotDate.getUTCSeconds()).toBe(0);
    });
  });
});
