/**
 * OpenClaw agent tools for listing and resolving Home Assistant anomalies.
 *
 * Provides anomaly query and resolution capabilities for LLM agents
 * via the OpenClaw gateway plugin system.
 *
 * Issue #1462, Epic #1440.
 */

import type { Pool } from 'pg';

// ---------- types ----------

/** Parameters for the ha_anomalies_list tool. */
export interface HaAnomaliesListParams {
  /** Filter by anomaly type stored in context JSONB. */
  type?: string;
  /** Filter by resolved status. */
  resolved?: boolean;
  /** Minimum anomaly score (0-10). */
  min_score?: number;
  /** Maximum number of results (default 50, max 200). */
  limit?: number;
}

/** Parameters for the ha_anomaly_resolve tool. */
export interface HaAnomalyResolveParams {
  /** UUID of the anomaly to resolve. */
  anomaly_id: string;
  /** Optional resolution notes. */
  notes?: string;
}

/** An anomaly result formatted for LLM consumption. */
export interface AnomalyResult {
  id: string;
  timestamp: string;
  routine_id: string | null;
  score: number;
  reason: string;
  entities: string[];
  notified: boolean;
  resolved: boolean;
  context: Record<string, unknown>;
}

/** Structured response from ha_anomalies_list. */
export interface HaAnomaliesListResponse {
  anomalies: AnomalyResult[];
  total: number;
  query_summary: string;
}

/** Structured response from ha_anomaly_resolve. */
export interface HaAnomalyResolveResponse {
  success: boolean;
  anomaly: AnomalyResult | null;
  message: string;
}

// ---------- tool metadata ----------

export const HA_ANOMALIES_LIST_TOOL = {
  name: 'ha_anomalies_list',
  description:
    'List detected Home Assistant anomalies. Anomalies are unusual events such as ' +
    'missing routines, unexpected activity, routine deviations, or security escalations. ' +
    'Filter by type, resolved status, and minimum severity score (0-10).',
  parameters: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        description:
          'Filter by anomaly type: "missing_routine", "unexpected_activity", ' +
          '"routine_deviation", "escalation"',
      },
      resolved: {
        type: 'boolean',
        description: 'Filter by resolved status (true = resolved, false = unresolved)',
      },
      min_score: {
        type: 'number',
        description: 'Minimum anomaly score 0-10 (higher = more severe)',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default 50, max 200)',
      },
    },
    required: [],
  },
} as const;

export const HA_ANOMALY_RESOLVE_TOOL = {
  name: 'ha_anomaly_resolve',
  description:
    'Mark a Home Assistant anomaly as resolved. Optionally include resolution notes ' +
    'explaining why the anomaly was expected or how it was addressed.',
  parameters: {
    type: 'object' as const,
    properties: {
      anomaly_id: {
        type: 'string',
        description: 'UUID of the anomaly to resolve',
      },
      notes: {
        type: 'string',
        description: 'Optional resolution notes',
      },
    },
    required: ['anomaly_id'],
  },
} as const;

// ---------- constants ----------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ANOMALY_TYPES = [
  'missing_routine',
  'unexpected_activity',
  'routine_deviation',
  'escalation',
];

// ---------- executors ----------

/**
 * Execute the ha_anomalies_list tool.
 *
 * @param pool - PostgreSQL connection pool
 * @param namespace - Tenant namespace (TEXT, not UUID)
 * @param params - Query parameters from the agent
 * @returns Structured anomaly results suitable for LLM consumption
 */
export async function executeAnomaliesList(
  pool: Pool,
  namespace: string,
  params: HaAnomaliesListParams,
): Promise<HaAnomaliesListResponse> {
  const conditions: string[] = ['namespace = $1'];
  const values: unknown[] = [namespace];
  let paramIdx = 2;

  if (params.type) {
    if (!VALID_ANOMALY_TYPES.includes(params.type)) {
      return {
        anomalies: [],
        total: 0,
        query_summary: `Invalid anomaly type "${params.type}". Must be one of: ${VALID_ANOMALY_TYPES.join(', ')}`,
      };
    }
    // The anomaly type is stored in the context JSONB or can be inferred from reason.
    // We search the context->type field or fall back to reason pattern matching.
    conditions.push(`(context->>'type' = $${paramIdx} OR reason ILIKE '%' || $${paramIdx} || '%')`);
    values.push(params.type);
    paramIdx++;
  }

  if (params.resolved !== undefined) {
    conditions.push(`resolved = $${paramIdx}`);
    values.push(params.resolved);
    paramIdx++;
  }

  if (params.min_score !== undefined) {
    const score = Math.max(0, Math.min(10, Math.round(params.min_score)));
    conditions.push(`score >= $${paramIdx}`);
    values.push(score);
    paramIdx++;
  }

  const limit = Math.max(1, Math.min(MAX_LIMIT, params.limit ?? DEFAULT_LIMIT));
  const whereClause = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    pool.query<AnomalyResult>(
      `SELECT id, timestamp::text, routine_id, score, reason,
              entities, notified, resolved, COALESCE(context, '{}') AS context
       FROM ha_anomalies
       WHERE ${whereClause}
       ORDER BY timestamp DESC
       LIMIT $${paramIdx}`,
      [...values, limit],
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ha_anomalies WHERE ${whereClause}`,
      values,
    ),
  ]);

  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);
  const anomalies = dataResult.rows;

  const filters: string[] = [];
  if (params.type) filters.push(`type=${params.type}`);
  if (params.resolved !== undefined) filters.push(`resolved=${params.resolved}`);
  if (params.min_score !== undefined) filters.push(`score>=${params.min_score}`);

  const filterStr = filters.length > 0 ? ` (filters: ${filters.join(', ')})` : '';
  const query_summary =
    `Found ${total} anomaly/anomalies${filterStr}. Showing ${anomalies.length}.`;

  return { anomalies, total, query_summary };
}

/**
 * Execute the ha_anomaly_resolve tool.
 *
 * @param pool - PostgreSQL connection pool
 * @param namespace - Tenant namespace (TEXT, not UUID)
 * @param params - Resolution parameters from the agent
 * @returns Result indicating success and the resolved anomaly
 */
export async function executeAnomalyResolve(
  pool: Pool,
  namespace: string,
  params: HaAnomalyResolveParams,
): Promise<HaAnomalyResolveResponse> {
  if (!UUID_REGEX.test(params.anomaly_id)) {
    return { success: false, anomaly: null, message: 'Invalid anomaly_id: must be a valid UUID.' };
  }

  const sets: string[] = ['resolved = TRUE'];
  const values: unknown[] = [params.anomaly_id, namespace];
  let paramIdx = 3;

  if (params.notes) {
    sets.push(`context = context || jsonb_build_object('resolution_notes', $${paramIdx}::text)`);
    values.push(params.notes);
    paramIdx++;
  }

  const result = await pool.query<AnomalyResult>(
    `UPDATE ha_anomalies SET ${sets.join(', ')}
     WHERE id = $1 AND namespace = $2
     RETURNING id, timestamp::text, routine_id, score, reason,
               entities, notified, resolved, COALESCE(context, '{}') AS context`,
    values,
  );

  if (result.rows.length === 0) {
    return { success: false, anomaly: null, message: 'Anomaly not found in this namespace.' };
  }

  return {
    success: true,
    anomaly: result.rows[0],
    message: `Anomaly resolved: "${result.rows[0].reason}"`,
  };
}
