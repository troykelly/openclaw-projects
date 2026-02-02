import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

describe('Memory CRUD API (issue #121)', () => {
  const app = buildServer();
  let pool: Pool;
  let workItemId: string;

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
    workItemId = (wi.json() as { id: string }).id;
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
          linkedItemId: workItemId,
        },
      });
      expect(res.statusCode).toBe(201);

      const body = res.json() as {
        id: string;
        title: string;
        content: string;
        type: string;
        linkedItemId: string;
        linkedItemTitle: string;
        createdAt: string;
      };
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(body.title).toBe('New Memory');
      expect(body.content).toBe('Memory content');
      expect(body.type).toBe('note'); // default type
      expect(body.linkedItemId).toBe(workItemId);
      expect(body.linkedItemTitle).toBe('Test Project');
    });

    it('creates memory with specified type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Decision',
          content: 'We decided to...',
          linkedItemId: workItemId,
          type: 'decision',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().type).toBe('decision');
    });

    it('returns 400 when title is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          content: 'Content',
          linkedItemId: workItemId,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'title is required' });
    });

    it('returns 400 when content is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Title',
          linkedItemId: workItemId,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'content is required' });
    });

    it('returns 400 when linkedItemId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Title',
          content: 'Content',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'linkedItemId is required' });
    });

    it('returns 400 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Title',
          content: 'Content',
          linkedItemId: '00000000-0000-0000-0000-000000000000',
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
          linkedItemId: workItemId,
          type: 'invalid',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('type must be one of');
    });
  });

  describe('PUT /api/memory/:id', () => {
    let memoryId: string;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'Original Title',
          content: 'Original Content',
          linkedItemId: workItemId,
        },
      });
      memoryId = (created.json() as { id: string }).id;
    });

    it('updates memory title and content', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/memory/${memoryId}`,
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
        url: `/api/memory/${memoryId}`,
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
        url: `/api/memory/${memoryId}`,
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
        url: `/api/memory/${memoryId}`,
        payload: {
          title: 'Title',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'content is required' });
    });
  });

  describe('DELETE /api/memory/:id', () => {
    let memoryId: string;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/memory',
        payload: {
          title: 'To Delete',
          content: 'Content',
          linkedItemId: workItemId,
        },
      });
      memoryId = (created.json() as { id: string }).id;
    });

    it('deletes a memory', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/memory/${memoryId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify deletion
      const check = await pool.query(
        'SELECT 1 FROM memory WHERE id = $1',
        [memoryId]
      );
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
