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

interface QueryPlan {
  sql: string;
  params: unknown[];
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
 * Build an ILIKE text search query (fallback when no embeddings exist).
 */
export function buildIlikeSearchQuery(
  filters: Omit<SearchFilters, 'queryEmbedding'> & { queryText: string },
): QueryPlan {
  const conditions: string[] = [
    'e.namespace = ANY($1::text[])',
  ];
  const params: unknown[] = [filters.namespaces];
  let idx = 2;

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

  // ILIKE text search
  conditions.push(`e.content ILIKE $${idx}`);
  params.push(`%${filters.queryText}%`);
  idx++;

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
