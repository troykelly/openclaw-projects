import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Memory Items in Work Item detail (issue #139).
 * These tests verify the memories API endpoints work for the detail view.
 */
describe('Memory Items in Work Item Detail', () => {
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

  describe('GET /api/work-items/:id/memories', () => {
    it('returns memories for a work item', async () => {
      // Create a work item
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      // Create some memories
      await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'Decision Note', 'We decided to use TypeScript', 'decision'),
                ($1, 'Context Info', 'This is background information', 'context')`,
        [itemId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}/memories`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { memories: Array<{ title: string; type: string }> };
      expect(body.memories.length).toBe(2);
      const titles = body.memories.map((m) => m.title);
      expect(titles).toContain('Decision Note');
      expect(titles).toContain('Context Info');
    });

    it('returns empty array for work item with no memories', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Empty Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}/memories`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { memories: unknown[] };
      expect(body.memories).toEqual([]);
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/memories',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/work-items/:id/memories', () => {
    it('creates a new memory for a work item', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/memories`,
        payload: {
          title: 'New Memory',
          content: 'Memory content here',
          type: 'note',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; title: string; type: string };
      expect(body.title).toBe('New Memory');
      expect(body.type).toBe('note');
      expect(body.id).toBeDefined();
    });

    it('requires title and content', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/memories`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/memories/:id', () => {
    it('updates an existing memory', async () => {
      // Create work item and memory
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'Original Title', 'Original content', 'note')
         RETURNING id::text as id`,
        [itemId],
      );
      const memoryId = (memory.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/memories/${memoryId}`,
        payload: {
          title: 'Updated Title',
          content: 'Updated content',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { title: string; content: string };
      expect(body.title).toBe('Updated Title');
      expect(body.content).toBe('Updated content');
    });

    it('returns 404 for non-existent memory', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/memories/00000000-0000-0000-0000-000000000000',
        payload: { title: 'Test' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/memories/:id', () => {
    it('deletes a memory', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'To Delete', 'Delete me', 'note')
         RETURNING id::text as id`,
        [itemId],
      );
      const memoryId = (memory.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/memories/${memoryId}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify deleted
      const checkRes = await app.inject({
        method: 'PATCH',
        url: `/api/memories/${memoryId}`,
        payload: { title: 'Test' },
      });
      expect(checkRes.statusCode).toBe(404);
    });
  });
});
