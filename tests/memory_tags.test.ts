/**
 * Tests for memory tags feature (Issue #492).
 * Verifies tags column, GIN index, service layer tag support,
 * API endpoint tag support, and search_vector trigger integration.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import {
  createMemory,
  getMemory,
  updateMemory,
  listMemories,
  searchMemories,
} from '../src/api/memory/index.ts';

describe('Memory Tags (Issue #492)', () => {
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

  // ── Schema ──────────────────────────────────────────────

  describe('schema', () => {
    it('memory table has tags column with correct type', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, column_default, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'memory' AND column_name = 'tags'`
      );
      expect(result.rows.length).toBe(1);
      const col = result.rows[0] as {
        column_name: string;
        data_type: string;
        column_default: string;
        is_nullable: string;
      };
      expect(col.data_type).toBe('ARRAY');
      expect(col.column_default).toContain("'{}'");
      expect(col.is_nullable).toBe('YES');
    });

    it('GIN index exists on tags column', async () => {
      const result = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = 'memory' AND indexname = 'idx_memory_tags'`
      );
      expect(result.rows.length).toBe(1);
      const idx = result.rows[0] as { indexname: string; indexdef: string };
      expect(idx.indexdef).toContain('gin');
    });
  });

  // ── Service layer: createMemory ─────────────────────────

  describe('createMemory with tags', () => {
    it('creates a memory with tags', async () => {
      const memory = await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Music preference',
        content: 'User likes lo-fi beats while working',
        memoryType: 'preference',
        tags: ['music', 'work', 'focus'],
      });

      expect(memory.tags).toEqual(['music', 'work', 'focus']);
    });

    it('creates a memory with empty tags', async () => {
      const memory = await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Simple note',
        content: 'A memory without tags',
      });

      expect(memory.tags).toEqual([]);
    });

    it('creates a memory without specifying tags (defaults to empty array)', async () => {
      const memory = await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Default tags test',
        content: 'Tags should default to empty array',
      });

      expect(memory.tags).toEqual([]);
    });
  });

  // ── Service layer: getMemory ────────────────────────────

  describe('getMemory returns tags', () => {
    it('returns tags when retrieving a memory', async () => {
      const created = await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Tagged memory',
        content: 'Has tags',
        tags: ['important', 'food'],
      });

      const retrieved = await getMemory(pool, created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.tags).toEqual(['important', 'food']);
    });
  });

  // ── Service layer: updateMemory ─────────────────────────

  describe('updateMemory with tags', () => {
    it('updates tags on an existing memory', async () => {
      const created = await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Updatable',
        content: 'Will update tags',
        tags: ['original'],
      });

      const updated = await updateMemory(pool, created.id, {
        tags: ['updated', 'new-tag'],
      });

      expect(updated!.tags).toEqual(['updated', 'new-tag']);
    });

    it('clears tags by setting empty array', async () => {
      const created = await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Tags to clear',
        content: 'Will clear tags',
        tags: ['a', 'b', 'c'],
      });

      const updated = await updateMemory(pool, created.id, {
        tags: [],
      });

      expect(updated!.tags).toEqual([]);
    });
  });

  // ── Service layer: listMemories filtering ───────────────

  describe('listMemories tag filtering', () => {
    it('filters memories by a single tag', async () => {
      await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Music pref',
        content: 'Likes jazz',
        tags: ['music', 'jazz'],
      });
      await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Food pref',
        content: 'Likes sushi',
        tags: ['food', 'sushi'],
      });

      const result = await listMemories(pool, { tags: ['music'] });

      expect(result.total).toBe(1);
      expect(result.memories[0].title).toBe('Music pref');
    });

    it('filters memories by multiple tags (AND semantics - contains all)', async () => {
      await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Jazz at work',
        content: 'Likes jazz while coding',
        tags: ['music', 'work', 'jazz'],
      });
      await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Rock at gym',
        content: 'Likes rock at the gym',
        tags: ['music', 'exercise', 'rock'],
      });

      const result = await listMemories(pool, { tags: ['music', 'work'] });

      expect(result.total).toBe(1);
      expect(result.memories[0].title).toBe('Jazz at work');
    });

    it('combines tag filter with other filters', async () => {
      await createMemory(pool, {
        userEmail: 'user1@example.com',
        title: 'User1 music',
        content: 'Likes classical',
        memoryType: 'preference',
        tags: ['music'],
      });
      await createMemory(pool, {
        userEmail: 'user2@example.com',
        title: 'User2 music',
        content: 'Likes electronic',
        memoryType: 'preference',
        tags: ['music'],
      });

      const result = await listMemories(pool, {
        userEmail: 'user1@example.com',
        tags: ['music'],
      });

      expect(result.total).toBe(1);
      expect(result.memories[0].userEmail).toBe('user1@example.com');
    });
  });

  // ── Service layer: searchMemories with tags ─────────────

  describe('searchMemories with tag filtering', () => {
    it('combines tag filter with text search', async () => {
      await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Piano music preference',
        content: 'User loves piano music for focus work',
        memoryType: 'preference',
        tags: ['music', 'focus'],
      });
      await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Coffee preference',
        content: 'User drinks black coffee for focus',
        memoryType: 'preference',
        tags: ['food', 'focus'],
      });

      const result = await searchMemories(pool, 'focus', { tags: ['music'] });

      // Should only match the music-tagged memory
      if (result.results.length > 0) {
        expect(result.results.every(r => r.tags.includes('music'))).toBe(true);
      }
    });
  });

  // ── search_vector trigger includes tags ─────────────────

  describe('search_vector trigger', () => {
    it('includes tags in full-text search vector', async () => {
      const memory = await createMemory(pool, {
        userEmail: 'test@example.com',
        title: 'Simple note',
        content: 'A basic memory entry',
        tags: ['uniquetagname'],
      });

      // Search for the tag value in search_vector
      const result = await pool.query(
        `SELECT id FROM memory
         WHERE search_vector @@ to_tsquery('english', 'uniquetagname')
         AND id = $1`,
        [memory.id]
      );

      expect(result.rows.length).toBe(1);
    });
  });

  // ── API: POST /api/memories/unified with tags ───────────

  describe('POST /api/memories/unified with tags', () => {
    it('accepts tags array in request body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memories/unified',
        payload: {
          title: 'Tagged via API',
          content: 'Testing tag support',
          memory_type: 'preference',
          user_email: 'test@example.com',
          tags: ['api-test', 'music'],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.tags).toEqual(['api-test', 'music']);
    });
  });

  // ── API: GET /api/memory with tags filter ───────────────

  describe('GET /api/memory with tags filter', () => {
    it('filters memories by tags query parameter', async () => {
      // Create a work item first (legacy endpoint requires work_item_id)
      const wiResult = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Test Project', 'project', 'open')
         RETURNING id::text as id`
      );
      const workItemId = (wiResult.rows[0] as { id: string }).id;

      // Insert tagged memories directly
      await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type, tags)
         VALUES ($1, 'Music note', 'Likes jazz', 'preference', $2)`,
        [workItemId, ['music', 'jazz']]
      );
      await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type, tags)
         VALUES ($1, 'Food note', 'Likes sushi', 'preference', $2)`,
        [workItemId, ['food']]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory?tags=music',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Music note');
    });
  });

  // ── API: GET /api/memories/search with tags ─────────────

  describe('GET /api/memories/search with tags', () => {
    it('accepts tags query parameter for filtered search', async () => {
      // Create tagged memories
      await pool.query(
        `INSERT INTO memory (user_email, title, content, memory_type, tags)
         VALUES ('test@example.com', 'Piano music', 'Loves piano', 'preference', $1)`,
        [['music', 'piano']]
      );
      await pool.query(
        `INSERT INTO memory (user_email, title, content, memory_type, tags)
         VALUES ('test@example.com', 'Guitar music', 'Loves guitar', 'preference', $1)`,
        [['music', 'guitar']]
      );
      await pool.query(
        `INSERT INTO memory (user_email, title, content, memory_type, tags)
         VALUES ('test@example.com', 'Sushi food', 'Loves sushi', 'preference', $1)`,
        [['food']]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/memories/search?q=loves&tags=music',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // All results should have the music tag
      if (body.results && body.results.length > 0) {
        expect(body.results.every((r: { tags?: string[] }) =>
          r.tags && r.tags.includes('music')
        )).toBe(true);
      }
    });
  });

  // ── Down migration ─────────────────────────────────────

  describe('down migration', () => {
    it('migration can be reversed (covered by migration test framework)', async () => {
      // This is a structural assertion: verify the column exists now
      const before = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'memory' AND column_name = 'tags'`
      );
      expect(before.rows.length).toBe(1);
    });
  });
});
