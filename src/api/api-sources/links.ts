/**
 * API source <-> work item linkage service.
 * CRUD for api_source_link junction table.
 * Part of API Onboarding feature (#1788).
 */

import type { Pool, PoolClient } from 'pg';

/** Queryable database connection. */
type Queryable = Pool | PoolClient;

/** A link between an API source and a work item. */
export interface ApiSourceLink {
  api_source_id: string;
  work_item_id: string;
  created_at: Date;
}

/**
 * Link an API source to a work item.
 * Idempotent — duplicate links are silently ignored (ON CONFLICT DO NOTHING).
 * Returns true if a new link was created, false if it already existed.
 */
export async function linkApiSourceToWorkItem(
  pool: Queryable,
  apiSourceId: string,
  workItemId: string,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO api_source_link (api_source_id, work_item_id)
     VALUES ($1, $2)
     ON CONFLICT (api_source_id, work_item_id) DO NOTHING
     RETURNING *`,
    [apiSourceId, workItemId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Unlink an API source from a work item.
 * Returns true if a link was removed, false if it didn't exist.
 */
export async function unlinkApiSourceFromWorkItem(
  pool: Queryable,
  apiSourceId: string,
  workItemId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM api_source_link
     WHERE api_source_id = $1 AND work_item_id = $2
     RETURNING *`,
    [apiSourceId, workItemId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Get all work item IDs linked to an API source.
 */
export async function getApiSourceLinks(
  pool: Queryable,
  apiSourceId: string,
): Promise<ApiSourceLink[]> {
  const result = await pool.query(
    `SELECT api_source_id::text, work_item_id::text, created_at
     FROM api_source_link
     WHERE api_source_id = $1
     ORDER BY created_at ASC`,
    [apiSourceId],
  );
  return result.rows as ApiSourceLink[];
}

/**
 * Get all API source IDs linked to a work item (reverse lookup).
 */
export async function getWorkItemApiSources(
  pool: Queryable,
  workItemId: string,
): Promise<ApiSourceLink[]> {
  const result = await pool.query(
    `SELECT api_source_id::text, work_item_id::text, created_at
     FROM api_source_link
     WHERE work_item_id = $1
     ORDER BY created_at ASC`,
    [workItemId],
  );
  return result.rows as ApiSourceLink[];
}
