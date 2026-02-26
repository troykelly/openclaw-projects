/**
 * Unit tests for terminal semantic search (pgvector conversion).
 * Issue #1862 — Convert terminal search from ILIKE to pgvector cosine similarity.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import {
  buildSemanticSearchQuery,
  buildIlikeSearchQuery,
  shouldUseSemantic,
  type SearchFilters,
} from './semantic-search.ts';

function createMockPool(): Pool {
  return {
    query: vi.fn(),
  } as unknown as Pool;
}

describe('shouldUseSemantic', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createMockPool();
  });

  it('returns true when embedded entries exist', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ count: '42' }],
    } as QueryResult);

    const result = await shouldUseSemantic(pool, ['default']);
    expect(result).toBe(true);

    const sql = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('embedded_at IS NOT NULL');
    expect(sql).toContain('namespace');
  });

  it('returns false when no embedded entries exist', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ count: '0' }],
    } as QueryResult);

    const result = await shouldUseSemantic(pool, ['default']);
    expect(result).toBe(false);
  });
});

describe('buildSemanticSearchQuery', () => {
  const baseFilters: SearchFilters = {
    namespaces: ['default'],
    queryEmbedding: new Array(1024).fill(0.1),
    limit: 20,
    offset: 0,
  };

  it('builds a cosine similarity query', () => {
    const { sql, params } = buildSemanticSearchQuery(baseFilters);

    // Must use pgvector cosine distance operator
    expect(sql).toContain('<=>');
    // Must compute similarity as 1 - distance
    expect(sql).toContain('1 - (');
    // Must filter for embedded entries
    expect(sql).toContain('embedded_at IS NOT NULL');
    // Must order by vector distance
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('<=>');
    // Must include namespace filter
    expect(params).toContainEqual(['default']);
  });

  it('includes connection_id filter', () => {
    const filters = { ...baseFilters, connectionId: '00000000-0000-0000-0000-000000000001' };
    const { sql, params } = buildSemanticSearchQuery(filters);

    expect(sql).toContain('connection_id');
    expect(params).toContain('00000000-0000-0000-0000-000000000001');
  });

  it('includes session_id filter', () => {
    const filters = { ...baseFilters, sessionId: '00000000-0000-0000-0000-000000000002' };
    const { sql, params } = buildSemanticSearchQuery(filters);

    expect(sql).toContain('session_id');
    expect(params).toContain('00000000-0000-0000-0000-000000000002');
  });

  it('includes kind filter', () => {
    const filters = { ...baseFilters, kinds: ['command', 'output'] };
    const { sql, params } = buildSemanticSearchQuery(filters);

    expect(sql).toContain('kind');
    expect(params).toContainEqual(['command', 'output']);
  });

  it('includes tags filter', () => {
    const filters = { ...baseFilters, tags: ['production', 'debug'] };
    const { sql, params } = buildSemanticSearchQuery(filters);

    expect(sql).toContain('tags');
    expect(params).toContainEqual(['production', 'debug']);
  });

  it('includes host filter', () => {
    const filters = { ...baseFilters, host: 'prod-server' };
    const { sql, params } = buildSemanticSearchQuery(filters);

    expect(sql).toContain('ILIKE');
    expect(params).toContain('%prod-server%');
  });

  it('includes session_name filter', () => {
    const filters = { ...baseFilters, sessionName: 'deploy' };
    const { sql, params } = buildSemanticSearchQuery(filters);

    expect(sql).toContain('ILIKE');
    expect(params).toContain('%deploy%');
  });

  it('includes date range filters', () => {
    const filters = { ...baseFilters, dateFrom: '2026-01-01', dateTo: '2026-02-01' };
    const { sql, params } = buildSemanticSearchQuery(filters);

    expect(sql).toContain('captured_at >=');
    expect(sql).toContain('captured_at <=');
    expect(params).toContain('2026-01-01');
    expect(params).toContain('2026-02-01');
  });

  it('passes query embedding as parameter', () => {
    const { params } = buildSemanticSearchQuery(baseFilters);
    // The embedding vector should be in the params as a JSON string
    const hasEmbedding = params.some(
      (p) => typeof p === 'string' && p.startsWith('[0.1,'),
    );
    expect(hasEmbedding).toBe(true);
  });

  it('includes LIMIT and OFFSET', () => {
    const { sql, params } = buildSemanticSearchQuery(baseFilters);
    expect(sql).toContain('LIMIT');
    expect(sql).toContain('OFFSET');
    expect(params).toContain(20);
    expect(params).toContain(0);
  });
});

describe('buildIlikeSearchQuery', () => {
  const baseFilters: Omit<SearchFilters, 'queryEmbedding'> & { queryText: string } = {
    namespaces: ['default'],
    queryText: 'find this text',
    limit: 20,
    offset: 0,
  };

  it('builds an ILIKE text search query', () => {
    const { sql, params } = buildIlikeSearchQuery(baseFilters);

    expect(sql).toContain('ILIKE');
    expect(params).toContain('%find this text%');
  });

  it('returns hardcoded similarity of 1.0 in select', () => {
    const { sql } = buildIlikeSearchQuery(baseFilters);
    expect(sql).toContain('1.0');
  });

  it('orders by captured_at DESC (not similarity)', () => {
    const { sql } = buildIlikeSearchQuery(baseFilters);
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('captured_at DESC');
  });
});
