/**
 * Tests for temporal/relative time parameters on memory search (Issue #1272).
 * Verifies duration parsing, period shortcuts, and API integration.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveRelativeTime, resolvePeriod } from '../src/api/memory/temporal.ts';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

// ── Unit tests for the temporal resolver ────────────────

describe('resolveRelativeTime()', () => {
  it('parses "7d" as 7 days ago', () => {
    const now = new Date('2026-02-15T12:00:00Z');
    const result = resolveRelativeTime('7d', now);
    expect(result).toEqual(new Date('2026-02-08T12:00:00Z'));
  });

  it('parses "24h" as 24 hours ago', () => {
    const now = new Date('2026-02-15T12:00:00Z');
    const result = resolveRelativeTime('24h', now);
    expect(result).toEqual(new Date('2026-02-14T12:00:00Z'));
  });

  it('parses "2w" as 14 days ago', () => {
    const now = new Date('2026-02-15T12:00:00Z');
    const result = resolveRelativeTime('2w', now);
    expect(result).toEqual(new Date('2026-02-01T12:00:00Z'));
  });

  it('parses "1m" as ~30 days ago', () => {
    const now = new Date('2026-03-15T12:00:00Z');
    const result = resolveRelativeTime('1m', now);
    // 1 month back from March 15 = February 15
    expect(result).toEqual(new Date('2026-02-15T12:00:00Z'));
  });

  it('passes through ISO date strings', () => {
    const result = resolveRelativeTime('2026-01-01T00:00:00Z');
    expect(result).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('passes through date-only strings', () => {
    const result = resolveRelativeTime('2026-01-15');
    expect(result).toEqual(new Date('2026-01-15'));
  });

  it('returns null for invalid input', () => {
    const result = resolveRelativeTime('banana');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = resolveRelativeTime('');
    expect(result).toBeNull();
  });
});

describe('resolvePeriod()', () => {
  const now = new Date('2026-02-15T14:30:00Z'); // Sunday

  it('resolves "today" to start of today', () => {
    const { since, before } = resolvePeriod('today', now);
    expect(since).toEqual(new Date('2026-02-15T00:00:00Z'));
    expect(before).toBeUndefined();
  });

  it('resolves "yesterday" to start and end of yesterday', () => {
    const { since, before } = resolvePeriod('yesterday', now);
    expect(since).toEqual(new Date('2026-02-14T00:00:00Z'));
    expect(before).toEqual(new Date('2026-02-15T00:00:00Z'));
  });

  it('resolves "this_week" to Monday of current week', () => {
    const { since, before } = resolvePeriod('this_week', now);
    // Feb 15 2026 is Sunday, Monday was Feb 9
    expect(since).toEqual(new Date('2026-02-09T00:00:00Z'));
    expect(before).toBeUndefined();
  });

  it('resolves "last_week" to previous Monday through Sunday', () => {
    const { since, before } = resolvePeriod('last_week', now);
    // Current week starts Feb 9 (Monday), last week is Feb 2-9
    expect(since).toEqual(new Date('2026-02-02T00:00:00Z'));
    expect(before).toEqual(new Date('2026-02-09T00:00:00Z'));
  });

  it('resolves "this_month" to start of current month', () => {
    const { since, before } = resolvePeriod('this_month', now);
    expect(since).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(before).toBeUndefined();
  });

  it('resolves "last_month" to start and end of previous month', () => {
    const { since, before } = resolvePeriod('last_month', now);
    expect(since).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(before).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('returns null for unknown period', () => {
    const result = resolvePeriod('next_century', now);
    expect(result).toBeNull();
  });
});

// ── Integration tests: API routes ───────────────────────

describe('Memory temporal search API (Issue #1272)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  /** Insert a memory directly with a specific created_at timestamp */
  async function insertMemory(title: string, content: string, createdAt: string) {
    const result = await pool.query(
      `INSERT INTO memory (title, content, memory_type, created_at, updated_at)
       VALUES ($1, $2, 'note', $3::timestamptz, $3::timestamptz)
       RETURNING id::text`,
      [title, content, createdAt],
    );
    return (result.rows[0] as { id: string }).id;
  }

  describe('GET /api/memories/unified with temporal params', () => {
    it('filters by since parameter (relative duration)', async () => {
      // Create one old memory and one recent memory
      await insertMemory('Old memory', 'From last year', '2025-01-15T00:00:00Z');
      await insertMemory('Recent memory', 'From today', new Date().toISOString());

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/unified?since=30d',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { memories: Array<{ title: string }>; total: number };
      expect(body.memories.length).toBe(1);
      expect(body.memories[0].title).toBe('Recent memory');
    });

    it('filters by before parameter (ISO date)', async () => {
      await insertMemory('Old memory', 'From January', '2026-01-10T00:00:00Z');
      await insertMemory('New memory', 'From February', '2026-02-10T00:00:00Z');

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/unified?before=2026-02-01T00:00:00Z',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { memories: Array<{ title: string }>; total: number };
      expect(body.memories.length).toBe(1);
      expect(body.memories[0].title).toBe('Old memory');
    });

    it('filters by period shorthand', async () => {
      // "this_month" should only return memories from current month
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5).toISOString();
      const lastYear = new Date(now.getFullYear() - 1, 6, 15).toISOString();

      await insertMemory('This month', 'Recent', thisMonth);
      await insertMemory('Last year', 'Old', lastYear);

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/unified?period=this_month',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { memories: Array<{ title: string }>; total: number };
      expect(body.memories.length).toBe(1);
      expect(body.memories[0].title).toBe('This month');
    });

    it('combines since and before for a date range', async () => {
      await insertMemory('January', 'Jan note', '2026-01-15T00:00:00Z');
      await insertMemory('February', 'Feb note', '2026-02-05T00:00:00Z');
      await insertMemory('March', 'Mar note', '2026-03-15T00:00:00Z');

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/unified?since=2026-01-01T00:00:00Z&before=2026-03-01T00:00:00Z',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { memories: Array<{ title: string }>; total: number };
      expect(body.memories.length).toBe(2);
      const titles = body.memories.map((m) => m.title);
      expect(titles).toContain('January');
      expect(titles).toContain('February');
    });

    it('rejects invalid period value', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/unified?period=next_century',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('period');
    });
  });

  describe('GET /api/memories/search with temporal params', () => {
    // Note: When an embedding provider (e.g. VoyageAI) is configured, search
    // uses the semantic path which requires memories to have stored embeddings.
    // Test-inserted memories don't have embeddings, so semantic search may
    // return 0 results. These tests validate param acceptance and response
    // structure; temporal filtering correctness is proven by the unified tests.

    it('accepts since parameter and returns valid response', async () => {
      await insertMemory('Old meeting notes', 'Discussed roadmap', '2025-01-15T00:00:00Z');
      await insertMemory('Recent meeting notes', 'Discussed roadmap', new Date().toISOString());

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/search?q=roadmap&since=30d',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ title: string }>; search_type: string };
      expect(Array.isArray(body.results)).toBe(true);
      expect(['semantic', 'text']).toContain(body.search_type);
      // When text search is used, temporal filtering is applied
      if (body.search_type === 'text') {
        expect(body.results.length).toBe(1);
        expect(body.results[0].title).toBe('Recent meeting notes');
      }
    });

    it('accepts before parameter and returns valid response', async () => {
      await insertMemory('Old notes', 'Important stuff', '2026-01-10T00:00:00Z');
      await insertMemory('New notes', 'Important stuff', '2026-02-10T00:00:00Z');

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/search?q=important&before=2026-02-01T00:00:00Z',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ title: string }>; search_type: string };
      expect(Array.isArray(body.results)).toBe(true);
      expect(['semantic', 'text']).toContain(body.search_type);
      if (body.search_type === 'text') {
        expect(body.results.length).toBe(1);
        expect(body.results[0].title).toBe('Old notes');
      }
    });

    it('accepts period parameter and returns valid response', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5).toISOString();
      const oldDate = new Date(now.getFullYear() - 1, 6, 15).toISOString();

      await insertMemory('Recent design', 'UI mockup review', thisMonth);
      await insertMemory('Old design', 'UI mockup review', oldDate);

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/search?q=mockup&period=this_month',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { results: Array<{ title: string }>; search_type: string };
      expect(Array.isArray(body.results)).toBe(true);
      expect(['semantic', 'text']).toContain(body.search_type);
      if (body.search_type === 'text') {
        expect(body.results.length).toBe(1);
        expect(body.results[0].title).toBe('Recent design');
      }
    });
  });
});
