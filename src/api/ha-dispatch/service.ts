/**
 * HA observation dispatch service.
 * Bridges scored HA observations (Issues #1453, #1468) to the inbound
 * routing system (Issue #1502) for webhook dispatch.
 *
 * Called by the HA observation scorer output handler when scored
 * observations exceed the configured threshold.
 */

import type { Pool } from 'pg';

export interface ScoredObservation {
  entity_id: string;
  state: string;
  old_state?: string;
  score: number;
  reason?: string;
  attributes?: Record<string, unknown>;
}

export interface HaDispatchInput {
  observations: ScoredObservation[];
  batchScene?: string;
  threshold?: number;
  namespace?: string;
}

export interface HaDispatchResult {
  dispatched: boolean;
  webhookId?: string;
  filteredCount: number;
  totalCount: number;
}

const DEFAULT_THRESHOLD = 6;

/**
 * Filter and dispatch high-scoring HA observations.
 *
 * 1. Filter observations above threshold
 * 2. Resolve route via channel_default for ha_observation
 * 3. Enqueue webhook if route configured
 */
export async function dispatchHaObservations(
  pool: Pool,
  input: HaDispatchInput,
): Promise<HaDispatchResult> {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const namespace = input.namespace ?? 'default';

  const highScore = input.observations.filter((o) => o.score >= threshold);

  if (highScore.length === 0) {
    return {
      dispatched: false,
      filteredCount: 0,
      totalCount: input.observations.length,
    };
  }

  const { resolveRoute } = await import('../route-resolver/service.ts');
  const route = await resolveRoute(pool, 'ha_observer', 'ha_observation', namespace);

  if (!route) {
    return {
      dispatched: false,
      filteredCount: highScore.length,
      totalCount: input.observations.length,
    };
  }

  const { enqueueWebhook } = await import('../webhooks/dispatcher.ts');

  const webhookId = await enqueueWebhook(pool, 'ha_observation_alert', '/hooks/agent', {
    event_type: 'ha_observation_alert',
    agent_id: route.agentId,
    prompt_content: route.promptContent,
    context_id: route.contextId,
    route_source: route.source,
    threshold,
    batch_scene: input.batchScene ?? null,
    observations: highScore.map((o) => ({
      entity_id: o.entity_id,
      state: o.state,
      old_state: o.old_state ?? null,
      score: o.score,
      reason: o.reason ?? null,
    })),
    observation_count: highScore.length,
    total_batch_count: input.observations.length,
  });

  return {
    dispatched: true,
    webhookId,
    filteredCount: highScore.length,
    totalCount: input.observations.length,
  };
}
