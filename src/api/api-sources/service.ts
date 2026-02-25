/**
 * API source CRUD service.
 * Database operations for api_source and api_source_link tables.
 * Part of API Onboarding feature (#1772).
 */

import type { Pool, PoolClient } from 'pg';
import type {
  ApiSource,
  ApiSourceStatus,
  CreateApiSourceInput,
  UpdateApiSourceInput,
} from './types.ts';

/** Queryable database connection — either a Pool or a PoolClient (for transactions). */
type Queryable = Pool | PoolClient;

// ─── Row mapper ──────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToApiSource(row: any): ApiSource {
  return {
    id: row.id,
    namespace: row.namespace,
    name: row.name,
    description: row.description,
    spec_url: row.spec_url,
    servers: row.servers,
    spec_version: row.spec_version,
    spec_hash: row.spec_hash,
    tags: row.tags,
    refresh_interval_seconds: row.refresh_interval_seconds,
    last_fetched_at: row.last_fetched_at,
    status: row.status as ApiSourceStatus,
    error_message: row.error_message,
    created_by_agent: row.created_by_agent,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── CRUD operations ─────────────────────────────────────────────────────────

/**
 * Create a new API source.
 */
export async function createApiSource(
  pool: Queryable,
  input: CreateApiSourceInput,
): Promise<ApiSource> {
  const result = await pool.query(
    `INSERT INTO api_source (
      namespace, name, description, spec_url, servers, tags,
      refresh_interval_seconds, created_by_agent
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      input.namespace ?? 'default',
      input.name,
      input.description ?? null,
      input.spec_url ?? null,
      JSON.stringify(input.servers ?? []),
      input.tags ?? [],
      input.refresh_interval_seconds ?? null,
      input.created_by_agent ?? null,
    ],
  );
  return rowToApiSource(result.rows[0]);
}

/**
 * Get a single API source by ID. Returns null if not found or soft-deleted.
 */
export async function getApiSource(
  pool: Queryable,
  id: string,
  namespace: string,
): Promise<ApiSource | null> {
  const result = await pool.query(
    `SELECT * FROM api_source
     WHERE id = $1 AND namespace = $2 AND deleted_at IS NULL`,
    [id, namespace],
  );
  return result.rows.length > 0 ? rowToApiSource(result.rows[0]) : null;
}

/**
 * List API sources for a namespace, excluding soft-deleted.
 */
export async function listApiSources(
  pool: Queryable,
  namespace: string,
  options: { status?: ApiSourceStatus; limit?: number; offset?: number } = {},
): Promise<ApiSource[]> {
  const limit = Math.min(options.limit ?? 50, 500);
  const offset = options.offset ?? 0;

  if (options.status) {
    const result = await pool.query(
      `SELECT * FROM api_source
       WHERE namespace = $1 AND deleted_at IS NULL AND status = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [namespace, options.status, limit, offset],
    );
    return result.rows.map(rowToApiSource);
  }

  const result = await pool.query(
    `SELECT * FROM api_source
     WHERE namespace = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [namespace, limit, offset],
  );
  return result.rows.map(rowToApiSource);
}

/**
 * Update an API source. Only provided fields are updated.
 */
export async function updateApiSource(
  pool: Queryable,
  id: string,
  namespace: string,
  updates: UpdateApiSourceInput,
): Promise<ApiSource | null> {
  const FIELD_MAP: Record<string, string> = {
    name: 'name',
    description: 'description',
    spec_url: 'spec_url',
    servers: 'servers',
    spec_version: 'spec_version',
    spec_hash: 'spec_hash',
    tags: 'tags',
    refresh_interval_seconds: 'refresh_interval_seconds',
    last_fetched_at: 'last_fetched_at',
    status: 'status',
    error_message: 'error_message',
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const [key, dbCol] of Object.entries(FIELD_MAP)) {
    if (key in updates) {
      const val = (updates as Record<string, unknown>)[key];
      setClauses.push(`${dbCol} = $${paramIdx}`);
      values.push(key === 'servers' ? JSON.stringify(val) : val);
      paramIdx++;
    }
  }

  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = now()');
  values.push(id, namespace);

  const result = await pool.query(
    `UPDATE api_source SET ${setClauses.join(', ')}
     WHERE id = $${paramIdx} AND namespace = $${paramIdx + 1} AND deleted_at IS NULL
     RETURNING *`,
    values,
  );
  return result.rows.length > 0 ? rowToApiSource(result.rows[0]) : null;
}

/**
 * Soft delete an API source by setting deleted_at.
 */
export async function softDeleteApiSource(
  pool: Queryable,
  id: string,
  namespace: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE api_source
     SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND namespace = $2 AND deleted_at IS NULL
     RETURNING id`,
    [id, namespace],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Restore a soft-deleted API source by clearing deleted_at.
 */
export async function restoreApiSource(
  pool: Queryable,
  id: string,
  namespace: string,
): Promise<ApiSource | null> {
  const result = await pool.query(
    `UPDATE api_source
     SET deleted_at = NULL, updated_at = now()
     WHERE id = $1 AND namespace = $2 AND deleted_at IS NOT NULL
     RETURNING *`,
    [id, namespace],
  );
  return result.rows.length > 0 ? rowToApiSource(result.rows[0]) : null;
}
