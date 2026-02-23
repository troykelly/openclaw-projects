/**
 * Tests for HomeObserverProcessor — the batched event processor that scores
 * HA state changes and bulk-inserts observations into ha_observations.
 *
 * Issue #1449, Epic #1440.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomeObserverProcessor } from './home-observer-processor.ts';
import { matchesFilter } from '../ha-event-processor.ts';
import type { HaStateChange } from '../ha-event-processor.ts';
import { EntityTierResolver } from '../ha-entity-tiers.ts';
import type { ObservationScorer, BatchScoreResult } from '../ha-observation-scorer.ts';
import { buildObservationContext } from '../ha-observation-scorer.ts';
import { RuleBasedScorer } from '../scorers/rule-based-scorer.ts';

// ---------- helpers ----------

/** Create a mock pg Pool with a query spy. */
function createMockPool() {
  const querySpy = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  return {
    query: querySpy,
    // Include minimal Pool shape needed
  } as unknown as import('pg').Pool;
}

function makeStateChange(
  entityId: string,
  newState: string,
  oldState: string | null = null,
  attrs: Record<string, unknown> = {},
  overrides?: Partial<HaStateChange>,
): HaStateChange {
  const domain = entityId.split('.')[0];
  return {
    entity_id: entityId,
    domain,
    old_state: oldState,
    new_state: newState,
    old_attributes: {},
    new_attributes: attrs,
    last_changed: '2026-02-18T19:30:00Z',
    last_updated: '2026-02-18T19:30:00Z',
    context: { id: 'ctx-1', parent_id: null, user_id: null },
    ...overrides,
  };
}

// Suppress console output during tests
const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('HomeObserverProcessor', () => {
  let pool: ReturnType<typeof createMockPool>;
  let tierResolver: EntityTierResolver;
  let processor: HomeObserverProcessor;

  beforeEach(() => {
    pool = createMockPool();
    tierResolver = new EntityTierResolver();
    processor = new HomeObserverProcessor({
      pool,
      tierResolver,
      logger: silentLogger,
    });
  });

  // ---- getConfig ----

  describe('getConfig', () => {
    it('returns expected config with home observer domains', () => {
      const config = processor.getConfig();
      expect(config.id).toBe('home-observer');
      expect(config.name).toBe('Home Observer');
      expect(config.mode).toBe('batched');
      expect(config.batchWindowMs).toBe(15_000);
    });

    it('includes all expected domains', () => {
      const config = processor.getConfig();
      const expected = [
        'light', 'switch', 'binary_sensor', 'climate',
        'media_player', 'lock', 'cover', 'alarm_control_panel',
        'fan', 'vacuum', 'input_boolean',
      ];
      for (const domain of expected) {
        expect(config.filter.domains).toContain(domain);
      }
    });

    it('respects custom batchWindowMs', () => {
      const custom = new HomeObserverProcessor({
        pool,
        tierResolver,
        batchWindowMs: 30_000,
        logger: silentLogger,
      });
      expect(custom.getConfig().batchWindowMs).toBe(30_000);
    });
  });

  // ---- entity filter matching ----

  describe('entity filter matches expected domains', () => {
    it('matches light entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('light.kitchen', config.filter)).toBe(true);
    });

    it('matches lock entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('lock.front_door', config.filter)).toBe(true);
    });

    it('matches alarm_control_panel entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('alarm_control_panel.home', config.filter)).toBe(true);
    });

    it('matches binary_sensor entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('binary_sensor.motion_kitchen', config.filter)).toBe(true);
    });

    it('rejects device_tracker (geo domain)', () => {
      const config = processor.getConfig();
      expect(matchesFilter('device_tracker.phone', config.filter)).toBe(false);
    });

    it('rejects person (geo domain)', () => {
      const config = processor.getConfig();
      expect(matchesFilter('person.jane', config.filter)).toBe(false);
    });

    it('rejects sensor entities', () => {
      const config = processor.getConfig();
      expect(matchesFilter('sensor.temperature', config.filter)).toBe(false);
    });
  });

  // ---- onStateChangeBatch: batch processing ----

  describe('onStateChangeBatch — batch processing', () => {
    it('inserts observations for meaningful state changes', async () => {
      const changes: HaStateChange[] = [
        makeStateChange('light.kitchen', 'on', 'off'),
        makeStateChange('switch.living_room', 'on', 'off'),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      // Should have called pool.query with an INSERT
      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      expect(querySpy).toHaveBeenCalledOnce();
      const [sql, values] = querySpy.mock.calls[0];
      expect(sql).toContain('INSERT INTO ha_observations');
      expect(sql).toContain('namespace');
      expect(sql).toContain('batch_id');
      // 2 rows x 11 columns = 22 params
      expect(values).toHaveLength(22);
    });

    it('passes correct namespace to the insert', async () => {
      const changes = [makeStateChange('light.kitchen', 'on', 'off')];

      await processor.onStateChangeBatch(changes, 'my-namespace');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // First value is namespace
      expect(values[0]).toBe('my-namespace');
    });

    it('includes correct domain and entity_id in insert values', async () => {
      const changes = [makeStateChange('lock.front_door', 'locked', 'unlocked')];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // Values order: namespace, timestamp, batch_id, entity_id, domain,
      //   from_state, to_state, attributes, score, scene_label, context
      expect(values[3]).toBe('lock.front_door');  // entity_id
      expect(values[4]).toBe('lock');              // domain
      expect(values[5]).toBe('unlocked');          // from_state
      expect(values[6]).toBe('locked');            // to_state
    });

    it('handles null old_state (first-seen entity)', async () => {
      const changes = [makeStateChange('light.bedroom', 'on', null)];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      expect(values[5]).toBeNull(); // from_state
    });
  });

  // ---- attribute-only filtering ----

  describe('onStateChangeBatch — attribute-only filtering', () => {
    it('filters changes where old_state === new_state', async () => {
      const changes: HaStateChange[] = [
        makeStateChange('light.kitchen', 'on', 'on'), // attribute-only, filtered
        makeStateChange('switch.living_room', 'on', 'off'), // meaningful
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      expect(querySpy).toHaveBeenCalledOnce();
      const values = querySpy.mock.calls[0][1];
      // Only 1 row should be inserted (11 params)
      expect(values).toHaveLength(11);
      expect(values[3]).toBe('switch.living_room');
    });

    it('preserves changes with null old_state (not filtered)', async () => {
      const changes: HaStateChange[] = [
        makeStateChange('light.kitchen', 'on', null), // null old_state, keep
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      expect(querySpy).toHaveBeenCalledOnce();
    });
  });

  // ---- empty batch handling ----

  describe('onStateChangeBatch — empty batch handling', () => {
    it('does not insert when all changes are attribute-only', async () => {
      const changes: HaStateChange[] = [
        makeStateChange('light.kitchen', 'on', 'on'),
        makeStateChange('switch.living_room', 'off', 'off'),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('does not insert when changes array is empty', async () => {
      await processor.onStateChangeBatch([], 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('logs debug message when batch is fully filtered', async () => {
      const changes = [makeStateChange('light.kitchen', 'on', 'on')];

      await processor.onStateChangeBatch(changes, 'test-ns');

      expect(silentLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('fully filtered'),
        expect.objectContaining({ namespace: 'test-ns' }),
      );
    });
  });

  // ---- context enrichment ----

  describe('onStateChangeBatch — context enrichment', () => {
    it('builds correct temporal context for evening timestamp', async () => {
      const changes = [
        makeStateChange('light.kitchen', 'on', 'off', {}, {
          last_changed: '2026-02-18T19:30:00Z', // Wednesday evening
        }),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // context is the 11th value (index 10)
      const contextJson = JSON.parse(values[10] as string);
      expect(contextJson.time_bucket).toBe('evening');
      expect(contextJson.is_weekend).toBe(false);
    });

    it('builds correct temporal context for Saturday morning', async () => {
      const changes = [
        makeStateChange('light.kitchen', 'on', 'off', {}, {
          last_changed: '2026-02-21T08:00:00Z', // Saturday morning_early
        }),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      const contextJson = JSON.parse(values[10] as string);
      expect(contextJson.time_bucket).toBe('morning_early');
      expect(contextJson.day_of_week).toBe('saturday');
      expect(contextJson.is_weekend).toBe(true);
    });
  });

  // ---- score integration ----

  describe('onStateChangeBatch — score integration', () => {
    it('passes scored values to the insert', async () => {
      const changes = [
        makeStateChange('lock.front_door', 'unlocked', 'locked'),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // score is at index 8
      const score = values[8] as number;
      // Lock unlocking should score > 0 with RuleBasedScorer (base 7 + uncommon state +1 = 8)
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(10);
    });

    it('uses a custom scorer when provided', async () => {
      const customScorer: ObservationScorer = {
        id: 'test-scorer',
        score: vi.fn().mockReturnValue({
          change: {} as HaStateChange,
          score: 5,
          scene_label: null,
          score_breakdown: { base: 5, modifiers: [], final: 5 },
        }),
        scoreBatch: vi.fn().mockReturnValue({
          scored: [
            {
              change: makeStateChange('light.kitchen', 'on', 'off'),
              score: 5,
              scene_label: null,
              score_breakdown: { base: 5, modifiers: [], final: 5 },
            },
          ],
          triaged: [],
          scenes: [],
        } satisfies BatchScoreResult),
      };

      const customProcessor = new HomeObserverProcessor({
        pool,
        tierResolver,
        scorer: customScorer,
        logger: silentLogger,
      });

      const changes = [makeStateChange('light.kitchen', 'on', 'off')];
      await customProcessor.onStateChangeBatch(changes, 'test-ns');

      expect(customScorer.scoreBatch).toHaveBeenCalledOnce();
      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      expect(values[8]).toBe(5); // custom score
    });
  });

  // ---- escalate tier override ----

  describe('onStateChangeBatch — escalate tier override', () => {
    it('alarm_control_panel entities get score 10 via escalate tier', async () => {
      const changes = [
        makeStateChange('alarm_control_panel.home', 'triggered', 'armed_away'),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // score = 10 for escalate tier
      expect(values[8]).toBe(10);
    });

    it('binary_sensor with water_leak pattern gets score 10', async () => {
      // Create a tier resolver that will match water_leak as escalate
      const changes = [
        makeStateChange('binary_sensor.bathroom_water_leak', 'on', 'off'),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // The EntityTierResolver hardcoded defaults should match *water_leak* as escalate
      expect(values[8]).toBe(10);
    });
  });

  // ---- scene detection ----

  describe('onStateChangeBatch — scene detection', () => {
    it('detects bedtime scene and sets scene_label', async () => {
      // Evening timestamp + lights off + lock locked = bedtime scene
      const changes: HaStateChange[] = [
        makeStateChange('light.bedroom', 'off', 'on', {}, {
          last_changed: '2026-02-18T22:00:00Z', // night_late
        }),
        makeStateChange('lock.front_door', 'locked', 'unlocked', {}, {
          last_changed: '2026-02-18T22:00:00Z',
        }),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // scene_label for first row at index 9
      expect(values[9]).toBe('bedtime');
      // scene_label for second row at index 9 + 11 = 20
      expect(values[20]).toBe('bedtime');
    });

    it('sets null scene_label when no scene detected', async () => {
      // Single light on at afternoon — no scene match
      const changes = [
        makeStateChange('light.kitchen', 'on', 'off', {}, {
          last_changed: '2026-02-18T14:00:00Z', // afternoon
        }),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      expect(values[9]).toBeNull(); // scene_label
    });
  });

  // ---- batch_id generation ----

  describe('onStateChangeBatch — batch_id generation', () => {
    it('generates a valid UUID batch_id', async () => {
      const changes = [makeStateChange('light.kitchen', 'on', 'off')];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // batch_id is at index 2
      const batchId = values[2] as string;
      expect(batchId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('uses the same batch_id for all rows in a batch', async () => {
      const changes: HaStateChange[] = [
        makeStateChange('light.kitchen', 'on', 'off'),
        makeStateChange('switch.living_room', 'on', 'off'),
        makeStateChange('fan.bedroom', 'on', 'off'),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // batch_id at indices 2, 13, 24 (offset by 11 per row)
      const batchId0 = values[2];
      const batchId1 = values[13];
      const batchId2 = values[24];
      expect(batchId0).toBe(batchId1);
      expect(batchId1).toBe(batchId2);
    });

    it('generates different batch_ids for different batches', async () => {
      const changes1 = [makeStateChange('light.kitchen', 'on', 'off')];
      const changes2 = [makeStateChange('switch.living_room', 'on', 'off')];

      await processor.onStateChangeBatch(changes1, 'test-ns');
      await processor.onStateChangeBatch(changes2, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const batchId1 = querySpy.mock.calls[0][1][2];
      const batchId2 = querySpy.mock.calls[1][1][2];
      expect(batchId1).not.toBe(batchId2);
    });
  });

  // ---- SQL parameterization ----

  describe('onStateChangeBatch — SQL structure', () => {
    it('generates correct number of parameter placeholders', async () => {
      const changes: HaStateChange[] = [
        makeStateChange('light.kitchen', 'on', 'off'),
        makeStateChange('switch.living_room', 'on', 'off'),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const sql = querySpy.mock.calls[0][0] as string;
      // Should contain $1 through $22 (2 rows x 11 cols)
      expect(sql).toContain('$1');
      expect(sql).toContain('$22');
      expect(sql).not.toContain('$23');
    });

    it('includes correct column names in INSERT', async () => {
      const changes = [makeStateChange('light.kitchen', 'on', 'off')];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const sql = querySpy.mock.calls[0][0] as string;
      expect(sql).toContain('namespace');
      expect(sql).toContain('timestamp');
      expect(sql).toContain('batch_id');
      expect(sql).toContain('entity_id');
      expect(sql).toContain('domain');
      expect(sql).toContain('from_state');
      expect(sql).toContain('to_state');
      expect(sql).toContain('attributes');
      expect(sql).toContain('score');
      expect(sql).toContain('scene_label');
      expect(sql).toContain('context');
    });

    it('serialises attributes as JSON string', async () => {
      const changes = [
        makeStateChange('light.kitchen', 'on', 'off', {
          brightness: 255,
          color_temp: 4000,
        }),
      ];

      await processor.onStateChangeBatch(changes, 'test-ns');

      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      const values = querySpy.mock.calls[0][1];
      // attributes at index 7
      const attrs = JSON.parse(values[7] as string);
      expect(attrs.brightness).toBe(255);
      expect(attrs.color_temp).toBe(4000);
    });
  });

  // ---- lifecycle ----

  describe('lifecycle', () => {
    it('healthCheck returns true when pool query succeeds', async () => {
      expect(await processor.healthCheck()).toBe(true);
    });

    it('healthCheck returns false when pool query fails', async () => {
      (pool.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('connection refused'),
      );
      expect(await processor.healthCheck()).toBe(false);
    });

    it('shutdown completes without error', async () => {
      await expect(processor.shutdown()).resolves.toBeUndefined();
    });

    it('onConnect logs without error', async () => {
      await expect(processor.onConnect('http://ha.local:8123')).resolves.toBeUndefined();
    });

    it('onDisconnect logs without error', async () => {
      await expect(processor.onDisconnect('test reason')).resolves.toBeUndefined();
    });
  });

  // ---- buildObservationContext correctness ----

  describe('buildObservationContext integration', () => {
    it('produces correct context used in the insert', () => {
      // Verify the utility directly to ensure it matches what the processor uses
      const date = new Date('2026-02-18T03:00:00Z');
      const ctx = buildObservationContext(date);
      expect(ctx.time_bucket).toBe('night');
      expect(ctx.is_weekend).toBe(false);
    });
  });

  // ---- dispatch integration (Issue #1610) ----

  describe('onStateChangeBatch — dispatch integration (#1610)', () => {
    it('calls dispatchHaObservations after bulk insert', async () => {
      const dispatchMock = vi.fn().mockResolvedValue({
        dispatched: true,
        webhookId: 'wh-1',
        filteredCount: 1,
        totalCount: 1,
      });

      vi.doMock('../../ha-dispatch/service.ts', () => ({
        dispatchHaObservations: dispatchMock,
      }));

      // Re-import processor to pick up mocked dispatch
      const { HomeObserverProcessor: FreshProcessor } = await import(
        './home-observer-processor.ts'
      );

      const freshProcessor = new FreshProcessor({
        pool,
        tierResolver,
        logger: silentLogger,
      });

      const changes = [makeStateChange('lock.front_door', 'unlocked', 'locked')];
      await freshProcessor.onStateChangeBatch(changes, 'test-ns');

      // Bulk insert should have happened
      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      expect(querySpy).toHaveBeenCalled();
      const sql = querySpy.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO ha_observations');

      // Dispatch should have been called
      expect(dispatchMock).toHaveBeenCalledOnce();
      const dispatchArgs = dispatchMock.mock.calls[0];
      expect(dispatchArgs[0]).toBe(pool); // pool passed through
      const input = dispatchArgs[1];
      expect(input.namespace).toBe('test-ns');
      expect(input.observations).toHaveLength(1);
      expect(input.observations[0].entity_id).toBe('lock.front_door');
      expect(input.observations[0].state).toBe('unlocked');
      expect(input.observations[0].old_state).toBe('locked');
      expect(input.observations[0].score).toBeGreaterThan(0);

      vi.doUnmock('../../ha-dispatch/service.ts');
    });

    it('does not fail batch insert when dispatch throws', async () => {
      const dispatchMock = vi.fn().mockRejectedValue(new Error('webhook down'));

      vi.doMock('../../ha-dispatch/service.ts', () => ({
        dispatchHaObservations: dispatchMock,
      }));

      const { HomeObserverProcessor: FreshProcessor } = await import(
        './home-observer-processor.ts'
      );

      const freshProcessor = new FreshProcessor({
        pool,
        tierResolver,
        logger: silentLogger,
      });

      const changes = [makeStateChange('light.kitchen', 'on', 'off')];

      // Should not throw despite dispatch failure
      await expect(
        freshProcessor.onStateChangeBatch(changes, 'test-ns'),
      ).resolves.toBeUndefined();

      // Bulk insert should still have happened
      const querySpy = pool.query as ReturnType<typeof vi.fn>;
      expect(querySpy).toHaveBeenCalled();

      // Dispatch was attempted
      expect(dispatchMock).toHaveBeenCalledOnce();

      // Warn should have been logged
      expect(silentLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Dispatch failed'),
        expect.objectContaining({ error: 'webhook down' }),
      );

      vi.doUnmock('../../ha-dispatch/service.ts');
    });

    it('maps scored observations correctly to dispatch format', async () => {
      const dispatchMock = vi.fn().mockResolvedValue({
        dispatched: false,
        filteredCount: 0,
        totalCount: 2,
      });

      vi.doMock('../../ha-dispatch/service.ts', () => ({
        dispatchHaObservations: dispatchMock,
      }));

      const { HomeObserverProcessor: FreshProcessor } = await import(
        './home-observer-processor.ts'
      );

      const freshProcessor = new FreshProcessor({
        pool,
        tierResolver,
        logger: silentLogger,
      });

      const changes: HaStateChange[] = [
        makeStateChange('light.kitchen', 'on', 'off', { brightness: 255 }),
        makeStateChange('switch.living_room', 'on', null),
      ];

      await freshProcessor.onStateChangeBatch(changes, 'my-ns');

      expect(dispatchMock).toHaveBeenCalledOnce();
      const input = dispatchMock.mock.calls[0][1];

      // Check first observation
      expect(input.observations[0]).toMatchObject({
        entity_id: 'light.kitchen',
        state: 'on',
        old_state: 'off',
        attributes: { brightness: 255 },
      });
      expect(typeof input.observations[0].score).toBe('number');

      // Check second observation — null old_state becomes undefined
      expect(input.observations[1]).toMatchObject({
        entity_id: 'switch.living_room',
        state: 'on',
      });
      expect(input.observations[1].old_state).toBeUndefined();

      expect(input.namespace).toBe('my-ns');

      vi.doUnmock('../../ha-dispatch/service.ts');
    });

    it('does not call dispatch when batch is fully filtered', async () => {
      const dispatchMock = vi.fn();

      vi.doMock('../../ha-dispatch/service.ts', () => ({
        dispatchHaObservations: dispatchMock,
      }));

      const { HomeObserverProcessor: FreshProcessor } = await import(
        './home-observer-processor.ts'
      );

      const freshProcessor = new FreshProcessor({
        pool,
        tierResolver,
        logger: silentLogger,
      });

      // Attribute-only changes — all filtered
      const changes = [makeStateChange('light.kitchen', 'on', 'on')];
      await freshProcessor.onStateChangeBatch(changes, 'test-ns');

      // Dispatch should NOT be called since no meaningful changes
      expect(dispatchMock).not.toHaveBeenCalled();

      vi.doUnmock('../../ha-dispatch/service.ts');
    });
  });
});
