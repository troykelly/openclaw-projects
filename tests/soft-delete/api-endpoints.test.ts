/**
 * Tests for soft delete API endpoints.
 * Part of Issue #225.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';

describe('Soft Delete API Endpoints', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

    pool = createTestPool();
    await truncateAllTables(pool);
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
    await app.close();
  });

  describe('DELETE /api/work-items/:id', () => {
    it('soft deletes by default', async () => {
      // Create a work item
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Task' },
      });
      const work_item_id = createResponse.json().id;

      // Delete (soft)
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${work_item_id}`,
      });
      expect(deleteResponse.statusCode).toBe(204);

      // Verify it's not in normal list
      const listResponse = await app.inject({
        method: 'GET',
        url: '/api/work-items',
      });
      const items = listResponse.json().items;
      expect(items.find((i: { id: string }) => i.id === work_item_id)).toBeUndefined();

      // Verify it's still in database
      const check = await pool.query(`SELECT deleted_at FROM work_item WHERE id = $1`, [work_item_id]);
      expect(check.rows[0].deleted_at).not.toBeNull();
    });

    it('hard deletes with permanent=true', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Task' },
      });
      const work_item_id = createResponse.json().id;

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${work_item_id}?permanent=true`,
      });
      expect(deleteResponse.statusCode).toBe(204);

      // Verify it's completely gone
      const check = await pool.query(`SELECT * FROM work_item WHERE id = $1`, [work_item_id]);
      expect(check.rows.length).toBe(0);
    });
  });

  describe('POST /api/work-items/:id/restore', () => {
    it('restores a soft-deleted work item', async () => {
      // Create and soft delete
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Task' },
      });
      const work_item_id = createResponse.json().id;

      await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${work_item_id}`,
      });

      // Restore
      const restoreResponse = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/restore`,
      });
      expect(restoreResponse.statusCode).toBe(200);
      expect(restoreResponse.json().restored).toBe(true);
      expect(restoreResponse.json().id).toBe(work_item_id);

      // Verify it's back in list
      const listResponse = await app.inject({
        method: 'GET',
        url: '/api/work-items',
      });
      const items = listResponse.json().items;
      expect(items.find((i: { id: string }) => i.id === work_item_id)).toBeDefined();
    });

    it('returns 404 for non-deleted work item', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Active Task' },
      });
      const work_item_id = createResponse.json().id;

      const restoreResponse = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/restore`,
      });
      expect(restoreResponse.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/contacts/:id', () => {
    it('soft deletes by default', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'John Doe' },
      });
      const contact_id = createResponse.json().id;

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${contact_id}`,
      });
      expect(deleteResponse.statusCode).toBe(204);

      // Verify soft deleted
      const check = await pool.query(`SELECT deleted_at FROM contact WHERE id = $1`, [contact_id]);
      expect(check.rows[0].deleted_at).not.toBeNull();
    });

    it('hard deletes with permanent=true', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Jane Doe' },
      });
      const contact_id = createResponse.json().id;

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${contact_id}?permanent=true`,
      });
      expect(deleteResponse.statusCode).toBe(204);

      const check = await pool.query(`SELECT * FROM contact WHERE id = $1`, [contact_id]);
      expect(check.rows.length).toBe(0);
    });
  });

  describe('POST /api/contacts/:id/restore', () => {
    it('restores a soft-deleted contact', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'John Doe' },
      });
      const contact_id = createResponse.json().id;

      await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${contact_id}`,
      });

      const restoreResponse = await app.inject({
        method: 'POST',
        url: `/api/contacts/${contact_id}/restore`,
      });
      expect(restoreResponse.statusCode).toBe(200);
      expect(restoreResponse.json().restored).toBe(true);
    });
  });

  describe('GET /api/trash', () => {
    it('lists all soft-deleted items', async () => {
      // Create and delete items
      const wi1 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Task 1' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${wi1.json().id}`,
      });

      const c1 = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Contact 1' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${c1.json().id}`,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/trash',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.length).toBe(2);
      expect(body.total).toBe(2);
      expect(body.retention_days).toBe(30);
    });

    it('filters by entity_type', async () => {
      const wi = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Task' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${wi.json().id}`,
      });

      const c = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Contact' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${c.json().id}`,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/trash?entity_type=work_item',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items.every((i: { entity_type: string }) => i.entity_type === 'work_item')).toBe(true);
    });
  });

  describe('POST /api/trash/purge', () => {
    it('purges old deleted items', async () => {
      // Create item deleted 40 days ago directly in DB
      await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Old Task', now() - INTERVAL '40 days')`);

      const response = await app.inject({
        method: 'POST',
        url: '/api/trash/purge',
        payload: { retention_days: 30 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.work_items_purged).toBe(1);
    });

    it('uses default retention days', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/trash/purge',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().retention_days).toBe(30);
    });

    it('rejects invalid retention days', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/trash/purge',
        payload: { retention_days: 500 },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/work-items excludes deleted', () => {
    it('excludes soft-deleted items by default', async () => {
      const wi1 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Active Task' },
      });

      const wi2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'To Delete Task' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${wi2.json().id}`,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/work-items',
      });

      const items = response.json().items;
      expect(items.length).toBe(1);
      expect(items[0].id).toBe(wi1.json().id);
    });

    it('includes deleted items with include_deleted=true', async () => {
      const wi1 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Active Task' },
      });

      const wi2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Deleted Task' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${wi2.json().id}`,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/work-items?include_deleted=true',
      });

      const items = response.json().items;
      expect(items.length).toBe(2);
    });
  });

  describe('GET /api/contacts excludes deleted', () => {
    it('excludes soft-deleted contacts by default', async () => {
      const c1 = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Active Contact' },
      });

      const c2 = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { display_name: 'Deleted Contact' },
      });
      await app.inject({
        method: 'DELETE',
        url: `/api/contacts/${c2.json().id}`,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/contacts',
      });

      const contacts = response.json().contacts;
      expect(contacts.length).toBe(1);
      expect(contacts[0].id).toBe(c1.json().id);
    });
  });
});
