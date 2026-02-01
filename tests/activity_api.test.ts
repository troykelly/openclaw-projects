import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Tests for Activity Feed API endpoints (issue #130, #100).
 * Issue #100 adds: query params verification, response format matching UI types.
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

  /**
   * Issue #100: Verify query params work correctly
   */
  describe('Issue #100 - Query Parameters', () => {
    it('filters by actionType', async () => {
      // Create work items to generate 'created' activity
      const created = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Item' },
      });
      const { id } = created.json() as { id: string };

      // Update to generate 'updated' activity
      await app.inject({
        method: 'PUT',
        url: `/api/work-items/${id}`,
        payload: { title: 'Updated Item' },
      });

      // Filter for only 'created' actions
      const res = await app.inject({
        method: 'GET',
        url: '/api/activity?actionType=created',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ type: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].type).toBe('created');
    });

    it('filters by entityType', async () => {
      // Create project
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Project', kind: 'project' },
      });

      // Create issue
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Issue', kind: 'issue' },
      });

      // Filter for only 'project' entity type
      const res = await app.inject({
        method: 'GET',
        url: '/api/activity?entityType=project',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ entity_type: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].entity_type).toBe('project');
    });

    it('filters by projectId', async () => {
      // Create project
      const project = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Project', kind: 'project' },
      });
      const projectId = (project.json() as { id: string }).id;

      // Create initiative under project (hierarchy: project -> initiative -> epic -> issue)
      const init = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Initiative', kind: 'initiative', parentId: projectId },
      });
      const initId = (init.json() as { id: string }).id;

      // Create epic under initiative
      const epic = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Epic', kind: 'epic', parentId: initId },
      });
      const epicId = (epic.json() as { id: string }).id;

      // Create issue under epic
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Issue', kind: 'issue', parentId: epicId },
      });

      // Create separate standalone issue (not under the project)
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Standalone Issue', kind: 'issue' },
      });

      // Filter by projectId (should get project + all descendants)
      const res = await app.inject({
        method: 'GET',
        url: `/api/activity?projectId=${projectId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ work_item_title: string }> };
      // Should have project + initiative + epic + issue creations
      expect(body.items.length).toBe(4);
      const titles = body.items.map(i => i.work_item_title);
      expect(titles).toContain('Test Project');
      expect(titles).toContain('Test Initiative');
      expect(titles).toContain('Test Epic');
      expect(titles).toContain('Test Issue');
      expect(titles).not.toContain('Standalone Issue');
    });

    it('filters by since timestamp', async () => {
      // Create first item
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Older Item' },
      });

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));
      const sinceTime = new Date().toISOString();

      // Wait again and create second item
      await new Promise(resolve => setTimeout(resolve, 50));
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Newer Item' },
      });

      // Filter for items since middle timestamp
      const res = await app.inject({
        method: 'GET',
        url: `/api/activity?since=${encodeURIComponent(sinceTime)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ work_item_title: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].work_item_title).toBe('Newer Item');
    });

    it('supports page-based pagination', async () => {
      // Create 5 work items
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: `Item ${i}` },
        });
      }

      // Get page 1 with limit 2
      const page1 = await app.inject({
        method: 'GET',
        url: '/api/activity?page=1&limit=2',
      });

      expect(page1.statusCode).toBe(200);
      const body1 = page1.json() as {
        items: unknown[];
        pagination: { page: number; limit: number; total: number; hasMore: boolean };
      };
      expect(body1.items.length).toBe(2);
      expect(body1.pagination.page).toBe(1);
      expect(body1.pagination.limit).toBe(2);
      expect(body1.pagination.total).toBe(5);
      expect(body1.pagination.hasMore).toBe(true);

      // Get page 2
      const page2 = await app.inject({
        method: 'GET',
        url: '/api/activity?page=2&limit=2',
      });

      expect(page2.statusCode).toBe(200);
      const body2 = page2.json() as {
        items: unknown[];
        pagination: { page: number; hasMore: boolean };
      };
      expect(body2.items.length).toBe(2);
      expect(body2.pagination.page).toBe(2);
      expect(body2.pagination.hasMore).toBe(true);

      // Get page 3 (last page)
      const page3 = await app.inject({
        method: 'GET',
        url: '/api/activity?page=3&limit=2',
      });

      expect(page3.statusCode).toBe(200);
      const body3 = page3.json() as {
        items: unknown[];
        pagination: { hasMore: boolean };
      };
      expect(body3.items.length).toBe(1);
      expect(body3.pagination.hasMore).toBe(false);
    });

    it('includes entity_type in response', async () => {
      // Create project first
      const project = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Project', kind: 'project' },
      });
      const projectId = (project.json() as { id: string }).id;

      // Create initiative under project
      const init = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Initiative', kind: 'initiative', parentId: projectId },
      });
      const initId = (init.json() as { id: string }).id;

      // Create epic under initiative
      await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Epic', kind: 'epic', parentId: initId },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/activity',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ entity_type: string; work_item_title: string }> };
      // Find the epic activity
      const epicActivity = body.items.find(i => i.work_item_title === 'Test Epic');
      expect(epicActivity).toBeDefined();
      expect(epicActivity?.entity_type).toBe('epic');
    });
  });

  /**
   * Issue #102: Mark as Read endpoints
   */
  describe('Issue #102 - Mark as Read', () => {
    describe('POST /api/activity/:id/read', () => {
      it('marks a single activity item as read', async () => {
        // Create activity by creating a work item
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Test Item' },
        });

        // Get activity items
        const activityRes = await app.inject({
          method: 'GET',
          url: '/api/activity',
        });
        const activities = activityRes.json() as { items: Array<{ id: string; read_at: string | null }> };
        const activityId = activities.items[0].id;

        // Initially unread
        expect(activities.items[0].read_at).toBeNull();

        // Mark as read
        const res = await app.inject({
          method: 'POST',
          url: `/api/activity/${activityId}/read`,
        });

        expect(res.statusCode).toBe(204);

        // Verify it's now read
        const checkRes = await app.inject({
          method: 'GET',
          url: '/api/activity',
        });
        const checkBody = checkRes.json() as { items: Array<{ id: string; read_at: string | null }> };
        const markedItem = checkBody.items.find(i => i.id === activityId);
        expect(markedItem?.read_at).not.toBeNull();
      });

      it('returns 404 for non-existent activity', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/activity/00000000-0000-0000-0000-000000000000/read',
        });

        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'activity not found' });
      });

      it('is idempotent - can mark already read item', async () => {
        // Create activity
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Test Item' },
        });

        const activityRes = await app.inject({
          method: 'GET',
          url: '/api/activity',
        });
        const activities = activityRes.json() as { items: Array<{ id: string }> };
        const activityId = activities.items[0].id;

        // Mark as read twice
        await app.inject({
          method: 'POST',
          url: `/api/activity/${activityId}/read`,
        });

        const res = await app.inject({
          method: 'POST',
          url: `/api/activity/${activityId}/read`,
        });

        expect(res.statusCode).toBe(204);
      });
    });

    describe('POST /api/activity/read-all', () => {
      it('marks all activity items as read', async () => {
        // Create multiple activities
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Item 1' },
        });
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Item 2' },
        });
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Item 3' },
        });

        // Mark all as read
        const res = await app.inject({
          method: 'POST',
          url: '/api/activity/read-all',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { marked: number };
        expect(body.marked).toBe(3);

        // Verify all are read
        const checkRes = await app.inject({
          method: 'GET',
          url: '/api/activity',
        });
        const checkBody = checkRes.json() as { items: Array<{ read_at: string | null }> };
        checkBody.items.forEach(item => {
          expect(item.read_at).not.toBeNull();
        });
      });

      it('returns 0 when no unread items exist', async () => {
        // No activity created
        const res = await app.inject({
          method: 'POST',
          url: '/api/activity/read-all',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { marked: number };
        expect(body.marked).toBe(0);
      });

      it('only marks unread items', async () => {
        // Create activity
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Item 1' },
        });

        // Mark all as read
        await app.inject({
          method: 'POST',
          url: '/api/activity/read-all',
        });

        // Create more activity
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Item 2' },
        });

        // Mark all as read again - should only mark the new one
        const res = await app.inject({
          method: 'POST',
          url: '/api/activity/read-all',
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as { marked: number };
        expect(body.marked).toBe(1);
      });
    });
  });

  /**
   * Issue #101: SSE Real-time Stream endpoint
   */
  describe('Issue #101 - SSE Stream', () => {
    describe('GET /api/activity/stream', () => {
      it('returns SSE headers', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/activity/stream',
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.headers['connection']).toBe('keep-alive');
      });

      it('sends initial heartbeat event', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/api/activity/stream',
        });

        expect(res.statusCode).toBe(200);
        // Response should contain a heartbeat event
        expect(res.payload).toContain('event: heartbeat');
        expect(res.payload).toContain('data:');
      });

      it('accepts projectId filter parameter', async () => {
        // Create a project first
        const project = await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Test Project', kind: 'project' },
        });
        const projectId = (project.json() as { id: string }).id;

        const res = await app.inject({
          method: 'GET',
          url: `/api/activity/stream?projectId=${projectId}`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
      });

      it('sends recent activity events on connect', async () => {
        // Create some activity first
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'SSE Test Item' },
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/activity/stream',
        });

        expect(res.statusCode).toBe(200);
        // Should contain activity event for the work item
        expect(res.payload).toContain('event: activity');
        expect(res.payload).toContain('SSE Test Item');
      });

      it('filters activity by projectId', async () => {
        // Create a project with a child
        const project = await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Project A', kind: 'project' },
        });
        const projectId = (project.json() as { id: string }).id;

        // Create initiative under project
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Initiative Under A', kind: 'initiative', parentId: projectId },
        });

        // Create separate standalone item
        await app.inject({
          method: 'POST',
          url: '/api/work-items',
          payload: { title: 'Standalone Item' },
        });

        const res = await app.inject({
          method: 'GET',
          url: `/api/activity/stream?projectId=${projectId}`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.payload).toContain('Project A');
        expect(res.payload).toContain('Initiative Under A');
        expect(res.payload).not.toContain('Standalone Item');
      });
    });
  });
});
