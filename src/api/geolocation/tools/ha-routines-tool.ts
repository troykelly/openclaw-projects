/**
 * OpenClaw agent tools for listing and updating Home Assistant routines.
 *
 * Provides routine query and update capabilities for LLM agents
 * via the OpenClaw gateway plugin system.
 *
 * Issue #1462, Epic #1440.
 */

import type { Pool } from 'pg';

// ---------- types ----------

/** Parameters for the ha_routines_list tool. */
export interface HaRoutinesListParams {
  /** Filter by routine status: 'tentative', 'confirmed', 'rejected', 'archived'. */
  status?: string;
  /** Minimum confidence score (0.0-1.0). */
  min_confidence?: number;
  /** Maximum number of results (default 50, max 200). */
  limit?: number;
}

/** Parameters for the ha_routine_update tool. */
export interface HaRoutineUpdateParams {
  /** UUID of the routine to update. */
  routine_id: string;
  /** New status for the routine. */
  status?: 'tentative' | 'confirmed' | 'rejected' | 'archived';
  /** New title for the routine. */
  title?: string;
  /** New description for the routine. */
  description?: string;
}

/** A routine result formatted for LLM consumption. */
export interface RoutineResult {
  id: string;
  key: string;
  title: string;
  description: string | null;
  confidence: number;
  status: string;
  observations_count: number;
  first_seen: string;
  last_seen: string;
  time_window: { start_hour: number; end_hour: number; avg_duration_minutes: number };
  days: string[];
  sequence: Array<{
    entity_id: string;
    domain: string;
    to_state: string;
    offset_minutes: number;
  }>;
}

/** Structured response from ha_routines_list. */
export interface HaRoutinesListResponse {
  routines: RoutineResult[];
  total: number;
  query_summary: string;
}

/** Structured response from ha_routine_update. */
export interface HaRoutineUpdateResponse {
  success: boolean;
  routine: RoutineResult | null;
  message: string;
}

// ---------- tool metadata ----------

const VALID_STATUSES = ['tentative', 'confirmed', 'rejected', 'archived'];

export const HA_ROUTINES_LIST_TOOL = {
  name: 'ha_routines_list',
  description:
    'List detected Home Assistant routines. Routines are recurring patterns ' +
    'of entity state changes (e.g. bedtime routine, morning routine). ' +
    'Filter by status (tentative/confirmed/rejected/archived) and confidence level.',
  parameters: {
    type: 'object' as const,
    properties: {
      status: {
        type: 'string',
        enum: VALID_STATUSES,
        description: 'Filter by routine status',
      },
      min_confidence: {
        type: 'number',
        description: 'Minimum confidence score 0.0-1.0',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default 50, max 200)',
      },
    },
    required: [],
  },
} as const;

export const HA_ROUTINE_UPDATE_TOOL = {
  name: 'ha_routine_update',
  description:
    'Update a Home Assistant routine. Can change status (confirm, reject, archive), ' +
    'title, or description. Use this to confirm a detected routine or reject false positives.',
  parameters: {
    type: 'object' as const,
    properties: {
      routine_id: {
        type: 'string',
        description: 'UUID of the routine to update',
      },
      status: {
        type: 'string',
        enum: VALID_STATUSES,
        description: 'New status for the routine',
      },
      title: {
        type: 'string',
        description: 'New title for the routine',
      },
      description: {
        type: 'string',
        description: 'New description for the routine',
      },
    },
    required: ['routine_id'],
  },
} as const;

// ---------- constants ----------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- executors ----------

/**
 * Execute the ha_routines_list tool.
 *
 * @param pool - PostgreSQL connection pool
 * @param namespace - Tenant namespace (TEXT, not UUID)
 * @param params - Query parameters from the agent
 * @returns Structured routine results suitable for LLM consumption
 */
export async function executeRoutinesList(
  pool: Pool,
  namespace: string,
  params: HaRoutinesListParams,
): Promise<HaRoutinesListResponse> {
  const conditions: string[] = ['namespace = $1'];
  const values: unknown[] = [namespace];
  let paramIdx = 2;

  if (params.status) {
    if (!VALID_STATUSES.includes(params.status)) {
      return {
        routines: [],
        total: 0,
        query_summary: `Invalid status "${params.status}". Must be one of: ${VALID_STATUSES.join(', ')}`,
      };
    }
    conditions.push(`status = $${paramIdx}`);
    values.push(params.status);
    paramIdx++;
  }

  if (params.min_confidence !== undefined) {
    const conf = Math.max(0, Math.min(1, params.min_confidence));
    conditions.push(`confidence >= $${paramIdx}`);
    values.push(conf);
    paramIdx++;
  }

  const limit = Math.max(1, Math.min(MAX_LIMIT, params.limit ?? DEFAULT_LIMIT));
  const whereClause = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    pool.query<RoutineResult>(
      `SELECT id, key, title, description, confidence, status,
              observations_count, first_seen::text, last_seen::text,
              time_window, days, sequence
       FROM ha_routines
       WHERE ${whereClause}
       ORDER BY confidence DESC, updated_at DESC
       LIMIT $${paramIdx}`,
      [...values, limit],
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ha_routines WHERE ${whereClause}`,
      values,
    ),
  ]);

  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);
  const routines = dataResult.rows;

  const filters: string[] = [];
  if (params.status) filters.push(`status=${params.status}`);
  if (params.min_confidence !== undefined) filters.push(`confidence>=${params.min_confidence}`);

  const filterStr = filters.length > 0 ? ` (filters: ${filters.join(', ')})` : '';
  const query_summary =
    `Found ${total} routine(s)${filterStr}. Showing ${routines.length}.`;

  return { routines, total, query_summary };
}

/**
 * Execute the ha_routine_update tool.
 *
 * @param pool - PostgreSQL connection pool
 * @param namespace - Tenant namespace (TEXT, not UUID)
 * @param params - Update parameters from the agent
 * @returns Result indicating success and the updated routine
 */
export async function executeRoutineUpdate(
  pool: Pool,
  namespace: string,
  params: HaRoutineUpdateParams,
): Promise<HaRoutineUpdateResponse> {
  if (!UUID_REGEX.test(params.routine_id)) {
    return { success: false, routine: null, message: 'Invalid routine_id: must be a valid UUID.' };
  }

  if (params.status && !VALID_STATUSES.includes(params.status)) {
    return {
      success: false,
      routine: null,
      message: `Invalid status "${params.status}". Must be one of: ${VALID_STATUSES.join(', ')}`,
    };
  }

  if (
    params.status === undefined &&
    params.title === undefined &&
    params.description === undefined
  ) {
    return {
      success: false,
      routine: null,
      message: 'Must provide at least one field to update (status, title, or description).',
    };
  }

  const sets: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [params.routine_id, namespace];
  let paramIdx = 3;

  if (params.status !== undefined) {
    sets.push(`status = $${paramIdx}`);
    values.push(params.status);
    paramIdx++;
  }

  if (params.title !== undefined) {
    if (params.title.trim().length === 0) {
      return { success: false, routine: null, message: 'Title must be a non-empty string.' };
    }
    sets.push(`title = $${paramIdx}`);
    values.push(params.title.trim());
    paramIdx++;
  }

  if (params.description !== undefined) {
    sets.push(`description = $${paramIdx}`);
    values.push(params.description);
    paramIdx++;
  }

  const result = await pool.query<RoutineResult>(
    `UPDATE ha_routines SET ${sets.join(', ')}
     WHERE id = $1 AND namespace = $2
     RETURNING id, key, title, description, confidence, status,
               observations_count, first_seen::text, last_seen::text,
               time_window, days, sequence`,
    values,
  );

  if (result.rows.length === 0) {
    return { success: false, routine: null, message: 'Routine not found in this namespace.' };
  }

  // TODO: When #1466 feedback loop is integrated, record feedback here
  // for status changes (confirmed/rejected).

  return {
    success: true,
    routine: result.rows[0],
    message: `Routine "${result.rows[0].title}" updated successfully.`,
  };
}
