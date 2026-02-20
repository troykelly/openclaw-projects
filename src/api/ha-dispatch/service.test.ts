import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables, ensureTestNamespace } from '../../../tests/helpers/db.ts';
import { dispatchHaObservations } from './service.ts';
import { setChannelDefault } from '../channel-default/service.ts';
import type { ScoredObservation } from './service.ts';

const TEST_EMAIL = 'test@example.com';
const TEST_NAMESPACE = 'default';

const lowScoreObs: ScoredObservation = {
  entity_id: 'sensor.temp',
  state: '22',
  old_state: '21',
  score: 2,
  reason: 'Minor change',
};

const highScoreObs: ScoredObservation = {
  entity_id: 'binary_sensor.front_door',
  state: 'on',
  old_state: 'off',
  score: 8,
  reason: 'Front door opened while away',
};

const mediumScoreObs: ScoredObservation = {
  entity_id: 'sensor.humidity',
  state: '85',
  old_state: '60',
  score: 6,
  reason: 'Humidity spike',
};

describe('ha-dispatch service', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, TEST_EMAIL, TEST_NAMESPACE);
  });

  it('returns not dispatched when no observations above threshold', async () => {
    const result = await dispatchHaObservations(pool, {
      observations: [lowScoreObs],
    });

    expect(result.dispatched).toBe(false);
    expect(result.filteredCount).toBe(0);
    expect(result.totalCount).toBe(1);
  });

  it('returns not dispatched when no ha_observation route configured', async () => {
    const result = await dispatchHaObservations(pool, {
      observations: [highScoreObs],
    });

    expect(result.dispatched).toBe(false);
    expect(result.filteredCount).toBe(1);
    expect(result.totalCount).toBe(1);
  });

  it('dispatches when observations above threshold and route configured', async () => {
    await setChannelDefault(pool, {
      namespace: TEST_NAMESPACE,
      channel_type: 'ha_observation',
      agent_id: 'agent-ha',
    });

    const result = await dispatchHaObservations(pool, {
      observations: [highScoreObs, lowScoreObs],
    });

    expect(result.dispatched).toBe(true);
    expect(result.webhookId).toBeDefined();
    expect(result.filteredCount).toBe(1);
    expect(result.totalCount).toBe(2);
  });

  it('uses custom threshold', async () => {
    await setChannelDefault(pool, {
      namespace: TEST_NAMESPACE,
      channel_type: 'ha_observation',
      agent_id: 'agent-ha',
    });

    // With threshold 3, lowScoreObs (score 2) is still excluded
    const result = await dispatchHaObservations(pool, {
      observations: [lowScoreObs],
      threshold: 3,
    });

    expect(result.dispatched).toBe(false);
    expect(result.filteredCount).toBe(0);
  });

  it('includes observations at exactly the threshold', async () => {
    await setChannelDefault(pool, {
      namespace: TEST_NAMESPACE,
      channel_type: 'ha_observation',
      agent_id: 'agent-ha',
    });

    const result = await dispatchHaObservations(pool, {
      observations: [mediumScoreObs],
      threshold: 6,
    });

    expect(result.dispatched).toBe(true);
    expect(result.filteredCount).toBe(1);
  });

  it('enqueues webhook with correct payload', async () => {
    await setChannelDefault(pool, {
      namespace: TEST_NAMESPACE,
      channel_type: 'ha_observation',
      agent_id: 'agent-ha',
    });

    const result = await dispatchHaObservations(pool, {
      observations: [highScoreObs, lowScoreObs],
      batchScene: 'Evening routine',
    });

    expect(result.dispatched).toBe(true);

    // Verify the webhook was enqueued
    const webhookResult = await pool.query(
      `SELECT body FROM webhook_outbox WHERE id = $1`,
      [result.webhookId],
    );
    const body = webhookResult.rows[0]?.body as Record<string, unknown>;

    expect(body.event_type).toBe('ha_observation_alert');
    expect(body.agent_id).toBe('agent-ha');
    expect(body.batch_scene).toBe('Evening routine');
    expect(body.observation_count).toBe(1);
    expect(body.total_batch_count).toBe(2);
    expect((body.observations as Array<Record<string, unknown>>)[0].entity_id).toBe('binary_sensor.front_door');
  });

  it('dispatches multiple high-score observations', async () => {
    await setChannelDefault(pool, {
      namespace: TEST_NAMESPACE,
      channel_type: 'ha_observation',
      agent_id: 'agent-ha',
    });

    const result = await dispatchHaObservations(pool, {
      observations: [highScoreObs, mediumScoreObs, lowScoreObs],
    });

    expect(result.dispatched).toBe(true);
    expect(result.filteredCount).toBe(2); // score 8 and 6
    expect(result.totalCount).toBe(3);
  });
});
