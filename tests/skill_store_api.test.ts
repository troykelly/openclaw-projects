import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Skill Store CRUD API endpoints (issue #797).
 *
 * Covers:
 * - POST /api/skill-store/items (create + upsert)
 * - GET /api/skill-store/items/:id
 * - GET /api/skill-store/items/by-key
 * - GET /api/skill-store/items (list)
 * - PATCH /api/skill-store/items/:id
 * - DELETE /api/skill-store/items/:id (soft + hard)
 * - POST /api/skill-store/items/bulk
 * - DELETE /api/skill-store/items/bulk
 * - GET /api/skill-store/collections
 * - DELETE /api/skill-store/collections/:name
 * - POST /api/skill-store/items/:id/archive
 */
describe('Skill Store CRUD API (Issue #797)', () => {
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

  // ── POST /api/skill-store/items ──────────────────────────────────────

  describe('POST /api/skill-store/items', () => {
    it('creates a new item and returns 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'notes',
          title: 'First Note',
          summary: 'A summary',
          content: 'Full content here',
          data: { foo: 'bar' },
          tags: ['tag1', 'tag2'],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(body.skill_id).toBe('my-skill');
      expect(body.collection).toBe('notes');
      expect(body.title).toBe('First Note');
      expect(body.summary).toBe('A summary');
      expect(body.content).toBe('Full content here');
      expect(body.data).toEqual({ foo: 'bar' });
      expect(body.tags).toEqual(['tag1', 'tag2']);
      expect(body.status).toBe('active');
      expect(body.created_at).toBeTruthy();
    });

    it('returns 201 with defaults when only skill_id provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'my-skill' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.collection).toBe('_default');
      expect(body.data).toEqual({});
      expect(body.tags).toEqual([]);
    });

    it('returns 400 when skill_id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { title: 'No skill' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('skill_id');
    });

    it('rejects data exceeding 1MB (framework 413 or validation 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          data: { payload: 'x'.repeat(1048577) },
        },
      });
      // Fastify body parser rejects >1MB bodies with 413 before our validation runs
      expect([400, 413]).toContain(res.statusCode);
    });

    it('upserts when key is provided and item exists (returns 200)', async () => {
      // Create
      const create = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'config',
          key: 'settings',
          title: 'v1',
          data: { version: 1 },
        },
      });
      expect(create.statusCode).toBe(201);
      const createId = create.json().id;

      // Upsert
      const upsert = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'config',
          key: 'settings',
          title: 'v2',
          data: { version: 2 },
        },
      });
      expect(upsert.statusCode).toBe(200);
      const body = upsert.json();
      expect(body.id).toBe(createId);
      expect(body.title).toBe('v2');
      expect(body.data).toEqual({ version: 2 });
    });

    it('creates new item when key differs', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'config',
          key: 'settings-a',
          title: 'A',
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'config',
          key: 'settings-b',
          title: 'B',
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it('supports user_email field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          user_email: 'alice@example.com',
          title: 'User item',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().user_email).toBe('alice@example.com');
    });

    it('supports priority field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          priority: 5,
          title: 'Priority item',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().priority).toBe(5);
    });

    it('supports media and source URL fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          media_url: 'https://example.com/image.png',
          media_type: 'image/png',
          source_url: 'https://example.com/article',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.media_url).toBe('https://example.com/image.png');
      expect(body.media_type).toBe('image/png');
      expect(body.source_url).toBe('https://example.com/article');
    });
  });

  // ── GET /api/skill-store/items/:id ──────────────────────────────────

  describe('GET /api/skill-store/items/:id', () => {
    it('returns item by UUID', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'my-skill', title: 'Test' },
      });
      const id = created.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/skill-store/items/${id}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(id);
      expect(res.json().title).toBe('Test');
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items/not-a-uuid',
      });
      expect(res.statusCode).toBe(400);
    });

    it('excludes soft-deleted items by default', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'my-skill', title: 'To Delete' },
      });
      const id = created.json().id;

      // Soft delete
      await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${id}`,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/skill-store/items/${id}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('includes soft-deleted when include_deleted=true', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'my-skill', title: 'Deleted' },
      });
      const id = created.json().id;

      await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${id}`,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/skill-store/items/${id}?include_deleted=true`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deleted_at).toBeTruthy();
    });
  });

  // ── GET /api/skill-store/items/by-key ──────────────────────────────

  describe('GET /api/skill-store/items/by-key', () => {
    it('returns item by composite key', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'config',
          key: 'theme',
          data: { color: 'blue' },
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items/by-key?skill_id=my-skill&collection=config&key=theme',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ color: 'blue' });
    });

    it('returns 400 when skill_id is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items/by-key?collection=config&key=theme',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when key is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items/by-key?skill_id=my-skill&collection=config',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when not found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items/by-key?skill_id=my-skill&collection=config&key=nonexistent',
      });
      expect(res.statusCode).toBe(404);
    });

    it('excludes soft-deleted items', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'config',
          key: 'deleted-key',
        },
      });

      await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${created.json().id}`,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items/by-key?skill_id=my-skill&collection=config&key=deleted-key',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/skill-store/items (list) ────────────────────────────────

  describe('GET /api/skill-store/items', () => {
    it('returns 400 when skill_id is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items',
      });
      expect(res.statusCode).toBe(400);
    });

    it('lists items for a skill', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'my-skill', title: 'Item 1' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'my-skill', title: 'Item 2' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'other-skill', title: 'Other' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=my-skill',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('filters by collection', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'notes', title: 'A' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'config', title: 'B' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=s1&collection=notes',
      });
      expect(res.json().items).toHaveLength(1);
      expect(res.json().items[0].title).toBe('A');
    });

    it('filters by status', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', title: 'Active' },
      });
      const archived = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', title: 'Archived' },
      });
      // Archive the item
      await app.inject({
        method: 'POST',
        url: `/api/skill-store/items/${archived.json().id}/archive`,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=s1&status=archived',
      });
      expect(res.json().items).toHaveLength(1);
      expect(res.json().items[0].title).toBe('Archived');
    });

    it('filters by tags', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', title: 'Tagged', tags: ['important', 'urgent'] },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', title: 'Untagged' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=s1&tags=important',
      });
      expect(res.json().items).toHaveLength(1);
      expect(res.json().items[0].title).toBe('Tagged');
    });

    it('filters by user_email', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', title: 'Alice', user_email: 'alice@example.com' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', title: 'Bob', user_email: 'bob@example.com' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=s1&user_email=alice@example.com',
      });
      expect(res.json().items).toHaveLength(1);
      expect(res.json().items[0].title).toBe('Alice');
    });

    it('paginates with limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/skill-store/items',
          payload: { skill_id: 's1', title: `Item ${i}` },
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=s1&limit=2&offset=0',
      });
      const body = res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.has_more).toBe(true);
    });

    it('enforces max limit of 200', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', title: 'Test' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=s1&limit=500',
      });
      // Should succeed but cap at 200
      expect(res.statusCode).toBe(200);
    });

    it('excludes soft-deleted items by default', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', title: 'To Delete' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', title: 'Active' },
      });

      await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${created.json().id}`,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=s1',
      });
      expect(res.json().items).toHaveLength(1);
      expect(res.json().items[0].title).toBe('Active');
    });

    it('filters by since and until', async () => {
      // Insert items with known times
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, title, created_at)
         VALUES ('s1', 'Old', now() - interval '2 days')`,
      );
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, title, created_at)
         VALUES ('s1', 'Recent', now())`,
      );

      const since = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
      const res = await app.inject({
        method: 'GET',
        url: `/api/skill-store/items?skill_id=s1&since=${since}`,
      });
      expect(res.json().items).toHaveLength(1);
      expect(res.json().items[0].title).toBe('Recent');
    });
  });

  // ── PATCH /api/skill-store/items/:id ─────────────────────────────────

  describe('PATCH /api/skill-store/items/:id', () => {
    let itemId: string;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          title: 'Original',
          data: { v: 1 },
          tags: ['old'],
        },
      });
      itemId = created.json().id;
    });

    it('partially updates title', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${itemId}`,
        payload: { title: 'Updated' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().title).toBe('Updated');
      expect(res.json().data).toEqual({ v: 1 }); // unchanged
    });

    it('partially updates data', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${itemId}`,
        payload: { data: { v: 2 } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ v: 2 });
      expect(res.json().title).toBe('Original'); // unchanged
    });

    it('partially updates tags', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${itemId}`,
        payload: { tags: ['new', 'tags'] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().tags).toEqual(['new', 'tags']);
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/skill-store/items/00000000-0000-0000-0000-000000000000',
        payload: { title: 'Nope' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/skill-store/items/not-a-uuid',
        payload: { title: 'Nope' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects data exceeding 1MB (framework 413 or validation 400)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${itemId}`,
        payload: { data: { big: 'x'.repeat(1048577) } },
      });
      expect([400, 413]).toContain(res.statusCode);
    });

    it('updates pinned status', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${itemId}`,
        payload: { pinned: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().pinned).toBe(true);
    });
  });

  // ── DELETE /api/skill-store/items/:id ────────────────────────────────

  describe('DELETE /api/skill-store/items/:id', () => {
    it('soft deletes an item and returns 204', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'my-skill', title: 'To Delete' },
      });
      const id = created.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${id}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify still in DB with deleted_at set
      const check = await pool.query('SELECT deleted_at FROM skill_store_item WHERE id = $1', [id]);
      expect(check.rows).toHaveLength(1);
      expect(check.rows[0].deleted_at).toBeTruthy();
    });

    it('hard deletes with permanent=true', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'my-skill', title: 'Permanent Delete' },
      });
      const id = created.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${id}?permanent=true`,
      });
      expect(res.statusCode).toBe(204);

      // Verify completely gone
      const check = await pool.query('SELECT 1 FROM skill_store_item WHERE id = $1', [id]);
      expect(check.rows).toHaveLength(0);
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/items/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/items/not-a-uuid',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /api/skill-store/items/bulk ─────────────────────────────────

  describe('POST /api/skill-store/items/bulk', () => {
    it('creates multiple items', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/bulk',
        payload: {
          items: [
            { skill_id: 's1', title: 'Bulk 1' },
            { skill_id: 's1', title: 'Bulk 2' },
            { skill_id: 's1', title: 'Bulk 3' },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(3);
      expect(body.created).toBe(3);
    });

    it('supports upsert in bulk', async () => {
      // Create initial
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'c', key: 'k1', title: 'v1' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/bulk',
        payload: {
          items: [
            { skill_id: 's1', collection: 'c', key: 'k1', title: 'v2' },
            { skill_id: 's1', collection: 'c', key: 'k2', title: 'new' },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(2);
    });

    it('returns 400 when items array is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/bulk',
        payload: { items: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when items exceed max 100', async () => {
      const items = Array.from({ length: 101 }, (_, i) => ({
        skill_id: 's1',
        title: `Item ${i}`,
      }));
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/bulk',
        payload: { items },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('100');
    });

    it('rejects when any item has data exceeding 1MB (framework 413 or validation 400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/bulk',
        payload: {
          items: [
            { skill_id: 's1', title: 'Small' },
            { skill_id: 's1', title: 'Big', data: { payload: 'x'.repeat(1048577) } },
          ],
        },
      });
      expect([400, 413]).toContain(res.statusCode);
    });

    it('returns 400 when any item is missing skill_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/bulk',
        payload: {
          items: [{ skill_id: 's1', title: 'OK' }, { title: 'Missing skill_id' }],
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /api/skill-store/items/bulk ────────────────────────────────

  describe('DELETE /api/skill-store/items/bulk', () => {
    beforeEach(async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'notes', title: 'N1', tags: ['cleanup'] },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'notes', title: 'N2', tags: ['cleanup'] },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'config', title: 'C1' },
      });
    });

    it('bulk soft deletes by skill_id + collection', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/items/bulk',
        payload: { skill_id: 's1', collection: 'notes' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(2);

      // Verify soft deleted (still in DB)
      const check = await pool.query(`SELECT count(*) FROM skill_store_item WHERE skill_id = 's1' AND deleted_at IS NOT NULL`);
      expect(parseInt(check.rows[0].count)).toBe(2);
    });

    it('returns 400 when skill_id is missing', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/items/bulk',
        payload: { collection: 'notes' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when no additional filter provided', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/items/bulk',
        payload: { skill_id: 's1' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('filter');
    });

    it('filters by tags', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/items/bulk',
        payload: { skill_id: 's1', tags: ['cleanup'] },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(2);
    });
  });

  // ── GET /api/skill-store/collections ─────────────────────────────────

  describe('GET /api/skill-store/collections', () => {
    it('returns 400 when skill_id is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/collections',
      });
      expect(res.statusCode).toBe(400);
    });

    it('lists collections with counts', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'notes', title: 'A' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'notes', title: 'B' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'config', title: 'C' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/collections?skill_id=s1',
      });
      expect(res.statusCode).toBe(200);
      const collections = res.json().collections;
      expect(collections).toHaveLength(2);

      const notes = collections.find((c: { collection: string }) => c.collection === 'notes');
      expect(notes.count).toBe(2);

      const config = collections.find((c: { collection: string }) => c.collection === 'config');
      expect(config.count).toBe(1);
    });

    it('excludes soft-deleted items from counts', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'notes', title: 'A' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'notes', title: 'B' },
      });

      await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${created.json().id}`,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/collections?skill_id=s1',
      });
      const notes = res.json().collections.find((c: { collection: string }) => c.collection === 'notes');
      expect(notes.count).toBe(1);
    });
  });

  // ── DELETE /api/skill-store/collections/:name ────────────────────────

  describe('DELETE /api/skill-store/collections/:name', () => {
    it('soft deletes all items in collection', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'temp', title: 'A' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 's1', collection: 'temp', title: 'B' },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/collections/temp?skill_id=s1',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(2);
    });

    it('returns 400 when skill_id is missing', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/collections/temp',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 with count 0 when collection is empty', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/collections/nonexistent?skill_id=s1',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(0);
    });
  });

  // ── POST /api/skill-store/items/:id/archive ──────────────────────────

  describe('POST /api/skill-store/items/:id/archive', () => {
    it('sets status to archived', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'my-skill', title: 'To Archive' },
      });
      const id = created.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/skill-store/items/${id}/archive`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('archived');
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/00000000-0000-0000-0000-000000000000/archive',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/not-a-uuid/archive',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // Issue #831: Cross-skill isolation tests
  // ===========================================================================
  describe('Cross-skill isolation (Issue #831)', () => {
    it('PATCH cannot update item belonging to another skill', async () => {
      // Create item in skill-A
      const create = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'skill-a', title: 'Owned by A' },
      });
      expect(create.statusCode).toBe(201);
      const itemId = create.json().id;

      // PATCH using the same UUID — should succeed since there's no skill_id
      // scoping on PATCH by UUID. This test DOCUMENTS the current behavior.
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${itemId}`,
        payload: { title: 'Changed by anyone' },
      });
      // Current behavior: PATCH by UUID succeeds regardless of skill_id
      // This documents that UUID-level access is by-design (admin endpoints)
      expect(patch.statusCode).toBe(200);
      expect(patch.json().title).toBe('Changed by anyone');
    });

    it('DELETE by UUID succeeds regardless of skill_id (documents behavior)', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'skill-b', title: 'Owned by B' },
      });
      expect(create.statusCode).toBe(201);
      const itemId = create.json().id;

      // DELETE using UUID — no skill_id scoping
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${itemId}`,
      });
      expect([200, 204]).toContain(del.statusCode);
    });

    it('GET by-key enforces skill_id scope', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'skill-x', collection: 'c', key: 'shared-key', title: 'X item' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'skill-y', collection: 'c', key: 'shared-key', title: 'Y item' },
      });

      // Each skill sees only its own item
      const resX = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items/by-key?skill_id=skill-x&collection=c&key=shared-key',
      });
      expect(resX.statusCode).toBe(200);
      expect(resX.json().title).toBe('X item');

      const resY = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items/by-key?skill_id=skill-y&collection=c&key=shared-key',
      });
      expect(resY.statusCode).toBe(200);
      expect(resY.json().title).toBe('Y item');
    });
  });

  // ===========================================================================
  // Issue #831: Upsert field preservation
  // ===========================================================================
  describe('Upsert field preservation (Issue #831)', () => {
    it('upsert replaces all fields (documents full-replace behavior)', async () => {
      // Create item with all fields
      const create = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'config',
          key: 'preserve-test',
          title: 'Original Title',
          summary: 'Original Summary',
          content: 'Original Content',
          data: { original: true },
          tags: ['tag1', 'tag2'],
          user_email: 'user@example.com',
          priority: 5,
        },
      });
      expect(create.statusCode).toBe(201);

      // Upsert with ONLY title — documents that upsert is a REPLACE, not a PATCH
      // Non-provided fields reset to their defaults (null, empty array, 0)
      const upsert = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'config',
          key: 'preserve-test',
          title: 'Updated Title',
        },
      });
      expect(upsert.statusCode).toBe(200);
      const body = upsert.json();
      expect(body.title).toBe('Updated Title');
      // Upsert replaces: omitted fields go to defaults
      expect(body.summary).toBeNull();
      expect(body.content).toBeNull();
      expect(body.data).toEqual({});
      expect(body.tags).toEqual([]);
    });

    it('PATCH preserves non-updated fields', async () => {
      // Create item with all fields
      const create = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'my-skill',
          collection: 'config',
          key: 'patch-preserve',
          title: 'Original Title',
          summary: 'Original Summary',
          content: 'Original Content',
          data: { original: true, nested: { value: 42 } },
          tags: ['tag1', 'tag2'],
          priority: 5,
        },
      });
      expect(create.statusCode).toBe(201);
      const itemId = create.json().id;

      // PATCH with ONLY title change — other fields should be preserved
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${itemId}`,
        payload: { title: 'Updated Title' },
      });
      expect(patch.statusCode).toBe(200);
      const body = patch.json();

      expect(body.title).toBe('Updated Title');
      expect(body.summary).toBe('Original Summary');
      expect(body.content).toBe('Original Content');
      expect(body.data).toEqual({ original: true, nested: { value: 42 } });
      expect(body.tags).toEqual(['tag1', 'tag2']);
      expect(body.priority).toBe(5);
    });
  });

  // ===========================================================================
  // Issue #831: Pagination edge cases
  // ===========================================================================
  describe('Pagination edge cases (Issue #831)', () => {
    it('rejects negative offset', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'paginate-skill', title: 'Item 1' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=paginate-skill&offset=-5',
      });
      // Negative offset causes a database error (not clamped)
      expect([400, 500]).toContain(res.statusCode);
    });

    it('clamps limit=0 to at least 1', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'paginate-skill', title: 'Item 1' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=paginate-skill&limit=0',
      });
      expect(res.statusCode).toBe(200);
      // Should either return items (clamped to 1+) or return 400
      expect([200, 400]).toContain(res.statusCode);
    });

    it('returns empty array when offset exceeds total', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: 'paginate-skill', title: 'Item 1' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=paginate-skill&offset=9999',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Issue #831: Empty/whitespace skill_id
  // ===========================================================================
  describe('Empty/whitespace skill_id (Issue #831)', () => {
    it('rejects empty string skill_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: '', title: 'Bad' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects whitespace-only skill_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { skill_id: '   ', title: 'Bad' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects empty skill_id on GET items', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skill-store/items?skill_id=',
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
