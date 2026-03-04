/**
 * Terminal semantic search query builders.
 * Issue #1862 — Convert terminal search from ILIKE to pgvector cosine similarity.
 *
 * Provides functions to build either:
 *   - pgvector cosine similarity query (when embeddings exist)
 *   - ILIKE fallback query (when no entries are embedded yet)
 */

import type { Pool } from 'pg';

export interface SearchFilters {
  namespaces: string[];
  queryEmbedding?: number[];
  queryText?: string;
  connectionId?: string;
  sessionId?: string;
  kinds?: string[];
  tags?: string[];
  host?: string;
  sessionName?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

export interface QueryPlan {
  sql: string;
  params: unknown[];
}

/** Entry reference for batch context loading (#2115). */
export interface EntryRef {
  sessionId: string;
  sequence: number;
}

/**
 * Check whether enough embedded entries exist to use semantic search.
 */
export async function shouldUseSemantic(pool: Pool, namespaces: string[]): Promise<boolean> {
  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM terminal_session_entry
     WHERE namespace = ANY($1::text[])
       AND embedded_at IS NOT NULL
       AND embedding IS NOT NULL
     LIMIT 1`,
    [namespaces],
  );
  const count = parseInt((result.rows[0] as { count: string }).count, 10);
  return count > 0;
}

/**
 * Build a pgvector cosine similarity search query.
 */
export function buildSemanticSearchQuery(filters: SearchFilters): QueryPlan {
  const conditions: string[] = [
    'e.namespace = ANY($1::text[])',
    'e.embedded_at IS NOT NULL',
    'e.embedding IS NOT NULL',
  ];
  const params: unknown[] = [filters.namespaces];
  let idx = 2;

  // Embedding vector parameter
  const embeddingParam = `$${idx}::vector`;
  params.push(JSON.stringify(filters.queryEmbedding));
  idx++;

  // Optional filters
  if (filters.connectionId) {
    conditions.push(`s.connection_id = $${idx}`);
    params.push(filters.connectionId);
    idx++;
  }

  if (filters.sessionId) {
    conditions.push(`e.session_id = $${idx}`);
    params.push(filters.sessionId);
    idx++;
  }

  if (filters.kinds && filters.kinds.length > 0) {
    conditions.push(`e.kind = ANY($${idx}::text[])`);
    params.push(filters.kinds);
    idx++;
  }

  if (filters.tags && filters.tags.length > 0) {
    conditions.push(`s.tags && $${idx}::text[]`);
    params.push(filters.tags);
    idx++;
  }

  if (filters.host) {
    conditions.push(`c.host ILIKE $${idx}`);
    params.push(`%${filters.host}%`);
    idx++;
  }

  if (filters.sessionName) {
    conditions.push(`s.tmux_session_name ILIKE $${idx}`);
    params.push(`%${filters.sessionName}%`);
    idx++;
  }

  if (filters.dateFrom) {
    conditions.push(`e.captured_at >= $${idx}::timestamptz`);
    params.push(filters.dateFrom);
    idx++;
  }

  if (filters.dateTo) {
    conditions.push(`e.captured_at <= $${idx}::timestamptz`);
    params.push(filters.dateTo);
    idx++;
  }

  const where = conditions.join(' AND ');

  const sql = `SELECT e.id, e.session_id, e.pane_id, e.kind, e.content,
              e.captured_at, e.metadata, e.sequence,
              1 - (e.embedding <=> ${embeddingParam}) AS similarity,
              s.tmux_session_name as session_name,
              c.name as connection_name, c.host as connection_host
       FROM terminal_session_entry e
       JOIN terminal_session s ON e.session_id = s.id
       JOIN terminal_connection c ON s.connection_id = c.id
       WHERE ${where}
       ORDER BY e.embedding <=> ${embeddingParam}
       LIMIT $${idx} OFFSET $${idx + 1}`;

  params.push(filters.limit);
  params.push(filters.offset);

  return { sql, params };
}

/**
 * Build ILIKE filter conditions shared by search and count queries.
 * Returns conditions, params, and the next parameter index.
 */
function buildIlikeFilters(
  filters: Omit<SearchFilters, 'queryEmbedding'> & { queryText: string },
): { conditions: string[]; params: unknown[]; idx: number } {
  const conditions: string[] = [
    'e.namespace = ANY($1::text[])',
  ];
  const params: unknown[] = [filters.namespaces];
  let idx = 2;

  if (filters.connectionId) {
    conditions.push(`s.connection_id = $${idx}`);
    params.push(filters.connectionId);
    idx++;
  }

  if (filters.sessionId) {
    conditions.push(`e.session_id = $${idx}`);
    params.push(filters.sessionId);
    idx++;
  }

  if (filters.kinds && filters.kinds.length > 0) {
    conditions.push(`e.kind = ANY($${idx}::text[])`);
    params.push(filters.kinds);
    idx++;
  }

  if (filters.tags && filters.tags.length > 0) {
    conditions.push(`s.tags && $${idx}::text[]`);
    params.push(filters.tags);
    idx++;
  }

  if (filters.host) {
    conditions.push(`c.host ILIKE $${idx}`);
    params.push(`%${filters.host}%`);
    idx++;
  }

  if (filters.sessionName) {
    conditions.push(`s.tmux_session_name ILIKE $${idx}`);
    params.push(`%${filters.sessionName}%`);
    idx++;
  }

  if (filters.dateFrom) {
    conditions.push(`e.captured_at >= $${idx}::timestamptz`);
    params.push(filters.dateFrom);
    idx++;
  }

  if (filters.dateTo) {
    conditions.push(`e.captured_at <= $${idx}::timestamptz`);
    params.push(filters.dateTo);
    idx++;
  }

  // ILIKE text search
  conditions.push(`e.content ILIKE $${idx}`);
  params.push(`%${filters.queryText}%`);
  idx++;

  return { conditions, params, idx };
}

/**
 * Build an ILIKE text search query (fallback when no embeddings exist).
 */
export function buildIlikeSearchQuery(
  filters: Omit<SearchFilters, 'queryEmbedding'> & { queryText: string },
): QueryPlan {
  const { conditions, params, idx } = buildIlikeFilters(filters);
  const where = conditions.join(' AND ');

  const sql = `SELECT e.id, e.session_id, e.pane_id, e.kind, e.content,
              e.captured_at, e.metadata, e.sequence,
              1.0 AS similarity,
              s.tmux_session_name as session_name,
              c.name as connection_name, c.host as connection_host
       FROM terminal_session_entry e
       JOIN terminal_session s ON e.session_id = s.id
       JOIN terminal_connection c ON s.connection_id = c.id
       WHERE ${where}
       ORDER BY e.captured_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`;

  params.push(filters.limit);
  params.push(filters.offset);

  return { sql, params };
}

/**
 * Build a proper COUNT query for ILIKE search results (#2116).
 *
 * Uses the same filter conditions as buildIlikeSearchQuery but
 * produces an independent COUNT(*) query — no regex rewriting.
 */
export function buildCountQuery(
  filters: Omit<SearchFilters, 'queryEmbedding'> & { queryText: string },
): QueryPlan {
  const { conditions, params } = buildIlikeFilters(filters);
  const where = conditions.join(' AND ');

  const sql = `SELECT COUNT(*) as total
       FROM terminal_session_entry e
       JOIN terminal_session s ON e.session_id = s.id
       JOIN terminal_connection c ON s.connection_id = c.id
       WHERE ${where}`;

  return { sql, params };
}

/**
 * Build a batch query to load context entries for multiple search results (#2115).
 *
 * Instead of N+1 per-result queries, this builds a single query using
 * LATERAL joins to fetch surrounding context for all results at once.
 *
 * @param entries - Array of {sessionId, sequence} pairs to fetch context for
 * @param contextSize - Number of entries to fetch before and after each result
 */
export function buildContextBatchQuery(
  entries: EntryRef[],
  contextSize: number,
): QueryPlan {
  if (entries.length === 0) {
    return { sql: '', params: [] };
  }

  // Build a VALUES list for (session_id, sequence) pairs
  const valueParts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const entry of entries) {
    valueParts.push(`($${idx}::uuid, $${idx + 1}::bigint)`);
    params.push(entry.sessionId, entry.sequence);
    idx++;
    idx++;
  }

  const sql = `WITH targets(session_id, sequence) AS (
    VALUES ${valueParts.join(', ')}
  )
  SELECT t.session_id AS target_session_id, t.sequence AS target_sequence,
         ctx.kind, ctx.content, ctx.sequence
  FROM targets t,
  LATERAL (
    (SELECT kind, content, sequence FROM terminal_session_entry
     WHERE session_id = t.session_id AND sequence < t.sequence
     ORDER BY sequence DESC LIMIT $${idx})
    UNION ALL
    (SELECT kind, content, sequence FROM terminal_session_entry
     WHERE session_id = t.session_id AND sequence > t.sequence
     ORDER BY sequence ASC LIMIT $${idx})
  ) ctx
  ORDER BY t.session_id, t.sequence, ctx.sequence`;

  params.push(contextSize);

  return { sql, params };
}
