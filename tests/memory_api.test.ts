import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Memory Items API endpoints (issue #138).
 */
describe('Memory Items API', () => {
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
    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/memories',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns empty array when no memories exist', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
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

    it('returns memories for work item', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'Memory Title', 'Memory content here', 'note')`,
        [itemId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}/memories`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        memories: Array<{
          id: string;
          title: string;
          content: string;
          type: string;
          created_at: string;
          updated_at: string;
        }>;
      };
      expect(body.memories.length).toBe(1);
      expect(body.memories[0].title).toBe('Memory Title');
      expect(body.memories[0].content).toBe('Memory content here');
      expect(body.memories[0].type).toBe('note');
      expect(body.memories[0].created_at).toBeDefined();
      expect(body.memories[0].updated_at).toBeDefined();
    });

    it('returns multiple memories sorted by created_at desc', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type, created_at)
         VALUES
           ($1, 'First Memory', 'First content', 'note', '2024-01-01'),
           ($1, 'Second Memory', 'Second content', 'decision', '2024-01-02'),
           ($1, 'Third Memory', 'Third content', 'context', '2024-01-03')`,
        [itemId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}/memories`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { memories: Array<{ title: string }> };
      expect(body.memories.length).toBe(3);
      expect(body.memories[0].title).toBe('Third Memory');
      expect(body.memories[1].title).toBe('Second Memory');
      expect(body.memories[2].title).toBe('First Memory');
    });
  });

  describe('POST /api/work-items/:id/memories', () => {
    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/memories',
        payload: { title: 'Test', content: 'Content', type: 'note' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('creates memory with default type', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/memories`,
        payload: { title: 'New Memory', content: 'Memory content' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        id: string;
        title: string;
        content: string;
        type: string;
      };
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(body.title).toBe('New Memory');
      expect(body.content).toBe('Memory content');
      expect(body.type).toBe('note');
    });

    it('creates memory with specified type', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/memories`,
        payload: { title: 'Decision', content: 'We decided to...', type: 'decision' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { type: string };
      expect(body.type).toBe('decision');
    });

    it('validates memory type', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/memories`,
        payload: { title: 'Test', content: 'Content', type: 'invalid_type' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('requires title', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/memories`,
        payload: { content: 'Content' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('requires content', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/memories`,
        payload: { title: 'Title' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/memories/:id', () => {
    it('returns 404 for non-existent memory', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/memories/00000000-0000-0000-0000-000000000000',
        payload: { title: 'Updated' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('updates memory title', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'Original Title', 'Original content', 'note')
         RETURNING id::text as id`,
        [itemId]
      );
      const memoryId = (memory.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/memories/${memoryId}`,
        payload: { title: 'Updated Title' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { title: string; content: string };
      expect(body.title).toBe('Updated Title');
      expect(body.content).toBe('Original content');
    });

    it('updates memory content', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'Title', 'Original content', 'note')
         RETURNING id::text as id`,
        [itemId]
      );
      const memoryId = (memory.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/memories/${memoryId}`,
        payload: { content: 'Updated content' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { content: string };
      expect(body.content).toBe('Updated content');
    });

    it('updates memory type', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'Title', 'Content', 'note')
         RETURNING id::text as id`,
        [itemId]
      );
      const memoryId = (memory.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/memories/${memoryId}`,
        payload: { type: 'decision' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { type: string };
      expect(body.type).toBe('decision');
    });

    it('updates updated_at timestamp', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type, updated_at)
         VALUES ($1, 'Title', 'Content', 'note', '2024-01-01')
         RETURNING id::text as id, updated_at`,
        [itemId]
      );
      const memoryId = (memory.rows[0] as { id: string }).id;
      const originalUpdatedAt = (memory.rows[0] as { updated_at: Date }).updated_at;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/memories/${memoryId}`,
        payload: { title: 'Updated' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { updated_at: string };
      expect(new Date(body.updated_at).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
    });
  });

  describe('DELETE /api/memories/:id', () => {
    it('returns 404 for non-existent memory', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/memories/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });

    it('deletes memory and returns 204', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'Title', 'Content', 'note')
         RETURNING id::text as id`,
        [itemId]
      );
      const memoryId = (memory.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/memories/${memoryId}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's deleted
      const check = await pool.query(
        `SELECT id FROM memory WHERE id = $1`,
        [memoryId]
      );
      expect(check.rows.length).toBe(0);
    });
  });

  describe('Cascade delete', () => {
    it('sets work_item_id to null when work item is deleted (memories persist)', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const memory = await pool.query(
        `INSERT INTO memory (work_item_id, title, content, memory_type)
         VALUES ($1, 'Title', 'Content', 'note')
         RETURNING id::text as id`,
        [itemId]
      );
      const memoryId = (memory.rows[0] as { id: string }).id;

      // Delete the work item
      await pool.query(`DELETE FROM work_item WHERE id = $1`, [itemId]);

      // Verify memory still exists but work_item_id is null (ON DELETE SET NULL)
      const check = await pool.query(
        `SELECT id, work_item_id FROM memory WHERE id = $1`,
        [memoryId]
      );
      expect(check.rows.length).toBe(1);
      expect(check.rows[0].work_item_id).toBeNull();
    });
  });
});
