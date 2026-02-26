import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Memory CRUD API (issue #121)', () => {
  const app = buildServer();
  let pool: Pool;
  let work_item_id: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Create work item for memory attachment
    const wi = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Test Project', kind: 'project' },
    });
    work_item_id = (wi.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /api/memory', () => {
    it('creates a new memory linked to a work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'New Memory',
          content: 'Memory content',
          linked_item_id: work_item_id,
        },
      });
      expect(res.statusCode).toBe(201);

      const body = res.json() as {
        id: string;
        title: string;
        content: string;
        type: string;
        linked_item_id: string;
        linked_item_title: string;
        created_at: string;
      };
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(body.title).toBe('New Memory');
      expect(body.content).toBe('Memory content');
      expect(body.type).toBe('note'); // default type
      expect(body.linked_item_id).toBe(work_item_id);
      expect(body.linked_item_title).toBe('Test Project');
    });

    it('creates memory with specified type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Decision',
          content: 'We decided to...',
          linked_item_id: work_item_id,
          type: 'decision',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().type).toBe('decision');
    });

    it('auto-generates title when title is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          content: 'Some content that should auto-generate a title',
          linked_item_id: work_item_id,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { title: string };
      expect(body.title).toBeTruthy();
    });

    it('returns 400 when content is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Title',
          linked_item_id: work_item_id,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'content is required' });
    });

    it('creates memory without linked_item_id (global memory)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Global Memory',
          content: 'Content without work item',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; linked_item_id: string | null };
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(body.linked_item_id).toBeNull();
    });

    it('returns 400 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Title',
          content: 'Content',
          linked_item_id: '00000000-0000-0000-0000-000000000000',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'linked item not found' });
    });

    it('returns 400 for invalid type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Title',
          content: 'Content',
          linked_item_id: work_item_id,
          type: 'invalid',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Invalid memory type');
    });
  });

  describe('PUT /api/memory/:id', () => {
    let memory_id: string;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Original Title',
          content: 'Original Content',
          linked_item_id: work_item_id,
        },
      });
      memory_id = (created.json() as { id: string }).id;
    });

    it('updates memory title and content', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/memory/${memory_id}`,
        payload: {
          title: 'Updated Title',
          content: 'Updated Content',
        },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { title: string; content: string };
      expect(body.title).toBe('Updated Title');
      expect(body.content).toBe('Updated Content');
    });

    it('updates memory type', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/memory/${memory_id}`,
        payload: {
          title: 'Title',
          content: 'Content',
          type: 'decision',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().type).toBe('decision');
    });

    it('returns 404 for non-existent memory', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/memory/00000000-0000-0000-0000-000000000000',
        payload: {
          title: 'Title',
          content: 'Content',
        },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 400 when title is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/memory/${memory_id}`,
        payload: {
          content: 'Content',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'title is required' });
    });

    it('returns 400 when content is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/memory/${memory_id}`,
        payload: {
          title: 'Title',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'content is required' });
    });
  });

  describe('DELETE /api/memory/:id', () => {
    let memory_id: string;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'To Delete',
          content: 'Content',
          linked_item_id: work_item_id,
        },
      });
      memory_id = (created.json() as { id: string }).id;
    });

    it('deletes a memory', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/memory/${memory_id}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify deletion
      const check = await pool.query('SELECT 1 FROM memory WHERE id = $1', [memory_id]);
      expect(check.rows.length).toBe(0);
    });

    it('returns 404 for non-existent memory', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/memory/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });
  });
});
