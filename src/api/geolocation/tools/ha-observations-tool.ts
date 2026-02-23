// NOTE: Intentionally unwired — pending #1603 (HA Connector Container)

/**
 * OpenClaw agent tool for querying Home Assistant observations.
 *
 * Provides structured observation query capabilities for LLM agents
 * via the OpenClaw gateway plugin system.
 *
 * Issue #1462, Epic #1440.
 */

import type { Pool } from 'pg';

// ---------- types ----------

/** Parameters accepted by the ha_observations_query tool. */
export interface HaObservationsQueryParams {
  /** ISO-8601 start of time range (inclusive). */
  from?: string;
  /** ISO-8601 end of time range (inclusive). */
  to?: string;
  /** Filter by specific entity ID. */
  entity_id?: string;
  /** Filter by HA domain (e.g. 'light', 'switch', 'climate'). */
  domain?: string;
  /** Minimum observation score (0-10). */
  min_score?: number;
  /** Filter by scene label. */
  scene_label?: string;
  /** Maximum number of results (default 50, max 200). */
  limit?: number;
}

/** A single observation result formatted for LLM consumption. */
export interface ObservationResult {
  entity_id: string;
  domain: string;
  from_state: string | null;
  to_state: string;
  score: number;
  scene_label: string | null;
  timestamp: string;
  attributes: Record<string, unknown>;
}

/** Structured response from ha_observations_query. */
export interface HaObservationsQueryResponse {
  observations: ObservationResult[];
  total: number;
  query_summary: string;
}

// ---------- tool metadata ----------

export const HA_OBSERVATIONS_QUERY_TOOL = {
  name: 'ha_observations_query',
  description:
    'Query Home Assistant observation history. Returns entity state changes ' +
    'within a time range, optionally filtered by entity, domain, score, or scene. ' +
    'Useful for understanding what happened in the home and when.',
  parameters: {
    type: 'object' as const,
    properties: {
      from: {
        type: 'string',
        description: 'ISO-8601 start of time range (e.g. "2026-02-18T00:00:00Z")',
      },
      to: {
        type: 'string',
        description: 'ISO-8601 end of time range (e.g. "2026-02-20T23:59:59Z")',
      },
      entity_id: {
        type: 'string',
        description: 'Filter by specific HA entity ID (e.g. "light.bedroom")',
      },
      domain: {
        type: 'string',
        description: 'Filter by HA domain (e.g. "light", "switch", "climate", "lock")',
      },
      min_score: {
        type: 'number',
        description: 'Minimum observation score 0-10 (higher = more significant)',
      },
      scene_label: {
        type: 'string',
        description: 'Filter by scene label (e.g. "bedtime", "morning_routine")',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default 50, max 200)',
      },
    },
    required: [],
  },
} as const;

// ---------- constants ----------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ---------- executor ----------

/**
 * Execute the ha_observations_query tool.
 *
 * @param pool - PostgreSQL connection pool
 * @param namespace - Tenant namespace (TEXT, not UUID)
 * @param params - Query parameters from the agent
 * @returns Structured observation results suitable for LLM consumption
 */
export async function executeObservationsQuery(
  pool: Pool,
  namespace: string,
  params: HaObservationsQueryParams,
): Promise<HaObservationsQueryResponse> {
  const conditions: string[] = ['namespace = $1'];
  const values: unknown[] = [namespace];
  let paramIdx = 2;

  if (params.entity_id) {
    conditions.push(`entity_id = $${paramIdx}`);
    values.push(params.entity_id);
    paramIdx++;
  }

  if (params.domain) {
    conditions.push(`domain = $${paramIdx}`);
    values.push(params.domain);
    paramIdx++;
  }

  if (params.min_score !== undefined) {
    const score = Math.max(0, Math.min(10, Math.round(params.min_score)));
    conditions.push(`score >= $${paramIdx}`);
    values.push(score);
    paramIdx++;
  }

  if (params.scene_label) {
    conditions.push(`scene_label = $${paramIdx}`);
    values.push(params.scene_label);
    paramIdx++;
  }

  if (params.from) {
    const fromDate = new Date(params.from);
    if (isNaN(fromDate.getTime())) {
      return { observations: [], total: 0, query_summary: 'Invalid "from" date provided.' };
    }
    conditions.push(`timestamp >= $${paramIdx}`);
    values.push(fromDate);
    paramIdx++;
  }

  if (params.to) {
    const toDate = new Date(params.to);
    if (isNaN(toDate.getTime())) {
      return { observations: [], total: 0, query_summary: 'Invalid "to" date provided.' };
    }
    conditions.push(`timestamp <= $${paramIdx}`);
    values.push(toDate);
    paramIdx++;
  }

  const limit = Math.max(1, Math.min(MAX_LIMIT, params.limit ?? DEFAULT_LIMIT));
  const whereClause = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    pool.query<ObservationResult>(
      `SELECT entity_id, domain, from_state, to_state, score, scene_label,
              timestamp::text AS timestamp, COALESCE(attributes, '{}') AS attributes
       FROM ha_observations
       WHERE ${whereClause}
       ORDER BY timestamp DESC
       LIMIT $${paramIdx}`,
      [...values, limit],
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ha_observations WHERE ${whereClause}`,
      values,
    ),
  ]);

  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);
  const observations = dataResult.rows;

  // Build human-readable summary for the agent
  const filters: string[] = [];
  if (params.entity_id) filters.push(`entity=${params.entity_id}`);
  if (params.domain) filters.push(`domain=${params.domain}`);
  if (params.min_score !== undefined) filters.push(`score>=${params.min_score}`);
  if (params.scene_label) filters.push(`scene=${params.scene_label}`);
  if (params.from) filters.push(`from=${params.from}`);
  if (params.to) filters.push(`to=${params.to}`);

  const filterStr = filters.length > 0 ? ` (filters: ${filters.join(', ')})` : '';
  const query_summary =
    `Found ${total} observation(s)${filterStr}. ` +
    `Showing ${observations.length} most recent.`;

  return { observations, total, query_summary };
}
