import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

/**
 * Integration tests for Skill Store Activity Feed (Issue #808).
 *
 * Covers:
 * - Activity events on item create/update/delete
 * - Activity events on schedule trigger
 * - Activity events on bulk operations (summary events)
 * - Events appear in /api/activity endpoint
 * - Events include skill_id, collection, operation type
 */
describe('Skill Store Activity Feed (Issue #808)', () => {
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

  describe('Migration', () => {
    it('creates skill_store_activity table', async () => {
      const result = await pool.query(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename = 'skill_store_activity'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('has all required columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'skill_store_activity'
         ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('activity_type');
      expect(columns).toContain('skill_id');
      expect(columns).toContain('collection');
      expect(columns).toContain('description');
      expect(columns).toContain('metadata');
      expect(columns).toContain('read_at');
      expect(columns).toContain('created_at');
    });

    it('has required indexes', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'skill_store_activity'
         ORDER BY indexname`,
      );
      const indexNames = result.rows.map((r) => r.indexname);
      expect(indexNames).toContain('idx_skill_store_activity_skill_id');
      expect(indexNames).toContain('idx_skill_store_activity_created_at');
      expect(indexNames).toContain('idx_skill_store_activity_type');
    });
  });

  describe('Item create activity', () => {
    it('emits activity event when item is created', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'test-skill',
          collection: 'articles',
          title: 'Test Article',
          content: 'Some content',
        },
      });
      expect(res.statusCode).toBe(201);

      const activity = await pool.query(
        `SELECT activity_type::text, skill_id, collection, description, metadata
         FROM skill_store_activity
         WHERE activity_type = 'item_created'`,
      );
      expect(activity.rows).toHaveLength(1);
      expect(activity.rows[0].skill_id).toBe('test-skill');
      expect(activity.rows[0].collection).toBe('articles');
      expect(activity.rows[0].description).toContain('Test Article');
    });
  });

  describe('Item update activity', () => {
    it('emits activity event when item is updated', async () => {
      // Create item
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'test-skill',
          collection: 'articles',
          title: 'Original Title',
        },
      });
      const itemId = createRes.json().id;

      // Update item
      const updateRes = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${itemId}`,
        payload: { title: 'Updated Title' },
      });
      expect(updateRes.statusCode).toBe(200);

      const activity = await pool.query(
        `SELECT activity_type::text, skill_id, description
         FROM skill_store_activity
         WHERE activity_type = 'item_updated'`,
      );
      expect(activity.rows).toHaveLength(1);
      expect(activity.rows[0].skill_id).toBe('test-skill');
    });
  });

  describe('Item delete activity', () => {
    it('emits activity event when item is deleted', async () => {
      // Create item
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'test-skill',
          collection: 'articles',
          title: 'To Delete',
        },
      });
      const itemId = createRes.json().id;

      // Delete item
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${itemId}`,
      });
      expect(deleteRes.statusCode).toBe(204);

      const activity = await pool.query(
        `SELECT activity_type::text, skill_id, description
         FROM skill_store_activity
         WHERE activity_type = 'item_deleted'`,
      );
      expect(activity.rows).toHaveLength(1);
      expect(activity.rows[0].skill_id).toBe('test-skill');
    });
  });

  describe('Bulk operations activity', () => {
    it('emits summary event for bulk create (not N individual events)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/bulk',
        payload: {
          items: [
            { skill_id: 'test-skill', collection: 'articles', title: 'Item 1' },
            { skill_id: 'test-skill', collection: 'articles', title: 'Item 2' },
            { skill_id: 'test-skill', collection: 'articles', title: 'Item 3' },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const activity = await pool.query(
        `SELECT activity_type::text, skill_id, description, metadata
         FROM skill_store_activity
         WHERE activity_type = 'items_bulk_created'`,
      );
      // Should be 1 summary event, not 3 individual events
      expect(activity.rows).toHaveLength(1);
      expect(activity.rows[0].skill_id).toBe('test-skill');
      expect(activity.rows[0].metadata.count).toBe(3);
    });

    it('emits summary event for bulk delete', async () => {
      // Create items first
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items/bulk',
        payload: {
          items: [
            { skill_id: 'test-skill', collection: 'articles', title: 'Item 1' },
            { skill_id: 'test-skill', collection: 'articles', title: 'Item 2' },
          ],
        },
      });

      // Clear activity from create
      await pool.query(`DELETE FROM skill_store_activity`);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/skill-store/items/bulk',
        payload: {
          skill_id: 'test-skill',
          collection: 'articles',
        },
      });
      expect(res.statusCode).toBe(200);

      const activity = await pool.query(
        `SELECT activity_type::text, skill_id, description, metadata
         FROM skill_store_activity
         WHERE activity_type = 'items_bulk_deleted'`,
      );
      expect(activity.rows).toHaveLength(1);
      expect(activity.rows[0].skill_id).toBe('test-skill');
    });
  });

  describe('Schedule trigger activity', () => {
    it('emits activity event when schedule is manually triggered', async () => {
      // Create a schedule
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules',
        payload: {
          skill_id: 'test-skill',
          collection: 'articles',
          cron_expression: '0 9 * * *',
          webhook_url: 'https://example.com/hook',
        },
      });
      const scheduleId = createRes.json().id;

      // Trigger it
      const triggerRes = await app.inject({
        method: 'POST',
        url: `/api/skill-store/schedules/${scheduleId}/trigger`,
      });
      expect(triggerRes.statusCode).toBe(202);

      const activity = await pool.query(
        `SELECT activity_type::text, skill_id, collection, description
         FROM skill_store_activity
         WHERE activity_type = 'schedule_triggered'`,
      );
      expect(activity.rows).toHaveLength(1);
      expect(activity.rows[0].skill_id).toBe('test-skill');
      expect(activity.rows[0].collection).toBe('articles');
    });
  });

  describe('Activity feed API includes skill store events', () => {
    it('includes skill store events in /api/activity', async () => {
      // Create a skill store item to generate activity
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'test-skill',
          collection: 'articles',
          title: 'Activity Test Item',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Should include at least the skill store item_created event
      const skillStoreEvents = body.items.filter((item: Record<string, unknown>) => item.entity_type === 'skill_store');
      expect(skillStoreEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('supports filtering by entity type for skill store events', async () => {
      // Create activity
      await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: {
          skill_id: 'test-skill',
          collection: 'articles',
          title: 'Filter Test',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity?entityType=skill_store',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      for (const item of body.items) {
        expect(item.entity_type).toBe('skill_store');
      }
    });
  });

  describe('Pause/Resume activity', () => {
    it('emits activity on pause', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules',
        payload: {
          skill_id: 'test-skill',
          cron_expression: '0 9 * * *',
          webhook_url: 'https://example.com/hook',
        },
      });
      const scheduleId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/skill-store/schedules/${scheduleId}/pause`,
      });

      const activity = await pool.query(
        `SELECT activity_type::text, skill_id
         FROM skill_store_activity
         WHERE activity_type = 'schedule_paused'`,
      );
      expect(activity.rows).toHaveLength(1);
    });

    it('emits activity on resume', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/skill-store/schedules',
        payload: {
          skill_id: 'test-skill',
          cron_expression: '0 9 * * *',
          webhook_url: 'https://example.com/hook',
          enabled: false,
        },
      });
      const scheduleId = createRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/skill-store/schedules/${scheduleId}/resume`,
      });

      const activity = await pool.query(
        `SELECT activity_type::text, skill_id
         FROM skill_store_activity
         WHERE activity_type = 'schedule_resumed'`,
      );
      expect(activity.rows).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Issue #831: Activity non-emission on failed operations
  // ===========================================================================
  describe('Activity non-emission on failure (Issue #831)', () => {
    it('does NOT emit activity when item creation fails (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/skill-store/items',
        payload: { title: 'Missing skill_id' },
      });
      expect(res.statusCode).toBe(400);

      const activity = await pool.query(`SELECT count(*)::int AS cnt FROM skill_store_activity`);
      expect(activity.rows[0].cnt).toBe(0);
    });

    it('does NOT emit activity when PATCH targets non-existent item', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/skill-store/items/${fakeId}`,
        payload: { title: 'Nope' },
      });
      expect(res.statusCode).toBe(404);

      const activity = await pool.query(`SELECT count(*)::int AS cnt FROM skill_store_activity`);
      expect(activity.rows[0].cnt).toBe(0);
    });

    it('does NOT emit activity when DELETE targets non-existent item', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000001';
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/skill-store/items/${fakeId}`,
      });
      expect(res.statusCode).toBe(404);

      const activity = await pool.query(`SELECT count(*)::int AS cnt FROM skill_store_activity`);
      expect(activity.rows[0].cnt).toBe(0);
    });
  });
});
