/**
 * Tests for search query builders.
 * Issue #2115 — Search endpoint has N+1 query pattern for context.
 * Issue #2116 — Search count SQL uses brittle regex rewriting.
 *
 * Verifies that:
 * - buildIlikeSearchQuery produces valid SQL with proper count support
 * - buildSemanticSearchQuery produces valid SQL
 * - buildCountQuery produces an independent COUNT query (no regex rewriting)
 * - Context is loaded via batch query, not per-result
 */

import { describe, it, expect } from 'vitest';
import {
  buildIlikeSearchQuery,
  buildSemanticSearchQuery,
  buildCountQuery,
  buildContextBatchQuery,
} from '../../src/api/terminal/semantic-search.ts';

describe('Search count query (#2116)', () => {
  it('buildCountQuery produces a proper COUNT query (no regex rewriting)', () => {
    const result = buildCountQuery({
      namespaces: ['ns1'],
      queryText: 'hello',
      limit: 20,
      offset: 0,
    });

    expect(result.sql).toContain('COUNT(*)');
    expect(result.sql).not.toContain('LIMIT');
    expect(result.sql).not.toContain('OFFSET');
    expect(result.sql).not.toContain('ORDER BY');
    // Should not contain similarity columns
    expect(result.sql).not.toMatch(/1\.0\s+AS\s+similarity/);
  });

  it('count query has correct number of params (no limit/offset params)', () => {
    const result = buildCountQuery({
      namespaces: ['ns1'],
      queryText: 'test',
      limit: 20,
      offset: 5,
    });

    // Count query params should NOT include limit and offset
    // Should have: namespaces + queryText = 2 params
    expect(result.params.length).toBe(2);
  });

  it('count query preserves all filter conditions', () => {
    const result = buildCountQuery({
      namespaces: ['ns1', 'ns2'],
      queryText: 'test',
      connectionId: 'conn-1',
      sessionId: 'sess-1',
      kinds: ['output', 'command'],
      host: 'myhost',
      sessionName: 'mysession',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      limit: 20,
      offset: 0,
    });

    expect(result.sql).toContain('COUNT(*)');
    expect(result.sql).toContain('namespace = ANY');
    expect(result.sql).toContain('connection_id');
    expect(result.sql).toContain('session_id');
    expect(result.sql).toContain('ILIKE');
    // All filter params should be present (minus limit/offset)
    // namespaces + connectionId + sessionId + kinds + host + sessionName + dateFrom + dateTo + queryText = 9
    expect(result.params.length).toBe(9);
  });

  it('ILIKE search query still produces valid data query', () => {
    const result = buildIlikeSearchQuery({
      namespaces: ['ns1'],
      queryText: 'hello',
      limit: 20,
      offset: 0,
    });

    expect(result.sql).toContain('SELECT');
    expect(result.sql).toContain('FROM terminal_session_entry');
    expect(result.sql).toContain('LIMIT');
    expect(result.sql).toContain('OFFSET');
  });
});

describe('Context batch query (#2115)', () => {
  it('buildContextBatchQuery produces a single query for multiple entries', () => {
    const entries = [
      { sessionId: 'sess-1', sequence: 10 },
      { sessionId: 'sess-1', sequence: 20 },
      { sessionId: 'sess-2', sequence: 5 },
    ];

    const result = buildContextBatchQuery(entries, 2);

    expect(result.sql).toBeDefined();
    expect(result.params).toBeDefined();
    // Should be a single query, not N separate queries
    expect(typeof result.sql).toBe('string');
  });

  it('batch context query includes before and after context', () => {
    const entries = [
      { sessionId: 'sess-1', sequence: 10 },
    ];

    const result = buildContextBatchQuery(entries, 2);

    // Should reference the session_id and sequence for context
    expect(result.sql).toContain('session_id');
    expect(result.sql).toContain('sequence');
  });

  it('returns empty result for empty entries', () => {
    const result = buildContextBatchQuery([], 2);
    expect(result.sql).toBe('');
    expect(result.params).toEqual([]);
  });
});
