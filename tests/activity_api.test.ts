import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Tests for Activity Feed API endpoints (issue #130).
 */
describe('Activity Feed API', () => {
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

  describe('GET /api/activity', () => {
    it('returns empty array when no activity exists', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/activity',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: unknown[] };
      expect(body.items).toEqual([]);
    });

    it('returns activity when work items are created', async () => {
      // Create a work item
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Item' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ type: string; work_item_title: string }> };
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items[0].type).toBe('created');
      expect(body.items[0].work_item_title).toBe('Test Item');
    });

    it('returns activity when work items are updated', async () => {
      // Create a work item
      const created = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Item' },
      });
      const { id } = created.json() as { id: string };

      // Update the work item
      await app.inject({
        method: 'PUT',
        url: `/api/work-items/${id}`,
        payload: { title: 'Updated Item' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ type: string; work_item_title: string }> };

      // Should have both create and update activity
      expect(body.items.length).toBe(2);

      // Most recent first
      expect(body.items[0].type).toBe('updated');
      expect(body.items[1].type).toBe('created');
    });

    it('returns activity when status changes', async () => {
      // Create a work item
      const created = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Item' },
      });
      const { id } = created.json() as { id: string };

      // Change status
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/status`,
        payload: { status: 'closed' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ type: string; description: string }> };

      // Should have status_change activity
      const statusActivity = body.items.find(i => i.type === 'status_change');
      expect(statusActivity).toBeDefined();
      expect(statusActivity?.description).toContain('closed');
    });

    it('limits results to 50 by default', async () => {
      // Create 60 work items
      for (let i = 0; i < 60; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: `Item ${i}` },
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: unknown[] };
      expect(body.items.length).toBe(50);
    });

    it('supports pagination with limit and offset', async () => {
      // Create 10 work items
      for (let i = 0; i < 10; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: `Item ${i}` },
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity?limit=5&offset=5',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: unknown[] };
      expect(body.items.length).toBe(5);
    });
  });

  describe('GET /api/work-items/:id/activity', () => {
    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/activity',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns activity for a specific work item', async () => {
      // Create two work items
      const created1 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Item 1' },
      });
      const { id: id1 } = created1.json() as { id: string };

      const created2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Item 2' },
      });
      const { id: id2 } = created2.json() as { id: string };

      // Update item 1
      await app.inject({
        method: 'PUT',
        url: `/api/work-items/${id1}`,
        payload: { title: 'Item 1 Updated' },
      });

      // Get activity for item 1 only
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id1}/activity`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ work_item_id: string }> };

      // All activity should be for item 1
      expect(body.items.length).toBe(2);
      body.items.forEach(item => {
        expect(item.work_item_id).toBe(id1);
      });
    });
  });

  describe('Activity structure', () => {
    it('returns activity with correct structure', async () => {
      // Create a work item
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Item' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{
        id: string;
        type: string;
        work_item_id: string;
        work_item_title: string;
        description: string;
        created_at: string;
      }> };

      expect(body.items.length).toBe(1);
      const activity = body.items[0];

      expect(activity.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(activity.type).toBe('created');
      expect(activity.work_item_id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(activity.work_item_title).toBe('Test Item');
      expect(activity.description).toBeTruthy();
      expect(activity.created_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });
});
