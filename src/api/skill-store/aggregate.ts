/**
 * Skill Store aggregation service.
 *
 * Provides count, count_by_tag, count_by_status, latest, oldest operations
 * for skill_store_item records.
 *
 * Part of Epic #794, Issue #801.
 */

import type { Pool } from 'pg';

/** Aggregate operation parameters. */
export interface AggregateParams {
  skill_id: string;
  operation: 'count' | 'count_by_tag' | 'count_by_status' | 'latest' | 'oldest';
  collection?: string;
  since?: string;
  until?: string;
  user_email?: string;
}

/**
 * Build WHERE conditions and parameter list for aggregate queries.
 * Always includes: skill_id filter and soft-delete exclusion.
 */
function buildAggregateFilters(
  params: AggregateParams
): { conditions: string[]; values: (string | number)[]; paramIndex: number } {
  const conditions: string[] = [
    's.skill_id = $1',
    's.deleted_at IS NULL',
  ];
  const values: (string | number)[] = [params.skill_id];
  let paramIndex = 2;

  if (params.collection) {
    conditions.push(`s.collection = $${paramIndex}`);
    values.push(params.collection);
    paramIndex++;
  }

  if (params.user_email) {
    conditions.push(`s.user_email = $${paramIndex}`);
    values.push(params.user_email);
    paramIndex++;
  }

  if (params.since) {
    conditions.push(`s.created_at >= $${paramIndex}::timestamptz`);
    values.push(params.since);
    paramIndex++;
  }

  if (params.until) {
    conditions.push(`s.created_at < $${paramIndex}::timestamptz`);
    values.push(params.until);
    paramIndex++;
  }

  return { conditions, values, paramIndex };
}

/** Item summary returned by latest/oldest. */
const ITEM_COLUMNS = `
  s.id::text as id,
  s.skill_id,
  s.collection,
  s.key,
  s.title,
  s.status::text as status,
  s.created_at,
  s.updated_at
`;

/**
 * Run an aggregation on skill store items.
 */
export async function aggregateSkillStoreItems(
  pool: Pool,
  params: AggregateParams
): Promise<Record<string, unknown>> {
  if (!params.skill_id || params.skill_id.trim().length === 0) {
    throw new Error('skill_id is required');
  }

  const { conditions, values, paramIndex } = buildAggregateFilters(params);
  const whereClause = conditions.join(' AND ');

  switch (params.operation) {
    case 'count': {
      const result = await pool.query(
        `SELECT COUNT(*)::int as count
         FROM skill_store_item s
         WHERE ${whereClause}`,
        values
      );
      return { count: result.rows[0].count };
    }

    case 'count_by_tag': {
      const result = await pool.query(
        `SELECT tag, COUNT(*)::int as count
         FROM skill_store_item s, unnest(s.tags) as tag
         WHERE ${whereClause}
         GROUP BY tag
         ORDER BY count DESC, tag`,
        values
      );
      return { tags: result.rows };
    }

    case 'count_by_status': {
      const result = await pool.query(
        `SELECT s.status::text as status, COUNT(*)::int as count
         FROM skill_store_item s
         WHERE ${whereClause}
         GROUP BY s.status
         ORDER BY count DESC, s.status`,
        values
      );
      return { statuses: result.rows };
    }

    case 'latest': {
      const result = await pool.query(
        `SELECT ${ITEM_COLUMNS}
         FROM skill_store_item s
         WHERE ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT 1`,
        values
      );
      return { item: result.rows[0] ?? null };
    }

    case 'oldest': {
      const result = await pool.query(
        `SELECT ${ITEM_COLUMNS}
         FROM skill_store_item s
         WHERE ${whereClause}
         ORDER BY s.created_at ASC
         LIMIT 1`,
        values
      );
      return { item: result.rows[0] ?? null };
    }

    default:
      throw new Error(`Unknown operation: ${params.operation}`);
  }
}
