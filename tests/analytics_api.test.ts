import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Analytics API endpoints (issue #183).
 */
describe('Analytics API', () => {
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

  describe('GET /api/analytics/project-health', () => {
    it('returns health metrics for all projects', async () => {
      // Create a project with work items
      const projectRes = await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind)
         VALUES ('Test Project', 'open', 'project')
         RETURNING id`,
      );
      const project_id = projectRes.rows[0].id;

      // Create issues under the project
      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind, parent_work_item_id)
         VALUES
           ('Issue 1', 'open', 'issue', $1),
           ('Issue 2', 'in_progress', 'issue', $1),
           ('Issue 3', 'closed', 'issue', $1)`,
        [project_id],
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/project-health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.projects).toBeDefined();
      expect(body.projects.length).toBeGreaterThan(0);

      const project = body.projects.find((p: { id: string }) => p.id === project_id);
      expect(project).toBeDefined();
      expect(project.open_count).toBeGreaterThanOrEqual(1);
      expect(project.in_progress_count).toBeGreaterThanOrEqual(1);
      expect(project.closed_count).toBeGreaterThanOrEqual(1);
    });

    it('filters by project_id', async () => {
      // Create two projects
      const project1Res = await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind)
         VALUES ('Project 1', 'open', 'project')
         RETURNING id`,
      );
      const project1Id = project1Res.rows[0].id;

      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind)
         VALUES ('Project 2', 'open', 'project')
         RETURNING id`,
      );

      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind, parent_work_item_id)
         VALUES ('Issue 1', 'open', 'issue', $1)`,
        [project1Id],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/analytics/project-health?project_id=${project1Id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0].id).toBe(project1Id);
    });
  });

  describe('GET /api/analytics/velocity', () => {
    it('returns velocity data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/velocity',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.weeks).toBeDefined();
      expect(Array.isArray(body.weeks)).toBe(true);
    });

    it('returns weekly completed counts', async () => {
      // Create a work item that was closed in the last week
      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind, updated_at)
         VALUES ('Completed Issue', 'closed', 'issue', now() - interval '2 days')`,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/velocity?weeks=4',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.weeks.length).toBeLessThanOrEqual(4);
    });
  });

  describe('GET /api/analytics/effort', () => {
    it('returns effort summary', async () => {
      // Create a work item with effort estimate
      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind, estimate_minutes)
         VALUES ('Issue with effort', 'closed', 'issue', 480)`,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/effort',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total_estimated).toBeDefined();
      expect(typeof body.total_estimated).toBe('number');
    });

    it('groups effort by status', async () => {
      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind, estimate_minutes)
         VALUES
           ('Open Issue', 'open', 'issue', 60),
           ('Closed Issue', 'closed', 'issue', 120)`,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/effort',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.by_status).toBeDefined();
    });
  });

  describe('GET /api/analytics/burndown/:id', () => {
    it('returns burndown data for an epic', async () => {
      // Create an epic with child issues
      const epicRes = await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind)
         VALUES ('Test Epic', 'open', 'epic')
         RETURNING id`,
      );
      const epicId = epicRes.rows[0].id;

      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind, parent_work_item_id, estimate_minutes)
         VALUES
           ('Issue 1', 'closed', 'issue', $1, 120),
           ('Issue 2', 'in_progress', 'issue', $1, 180),
           ('Issue 3', 'open', 'issue', $1, 300)`,
        [epicId],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/analytics/burndown/${epicId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total_scope).toBeDefined();
      expect(body.completed_scope).toBeDefined();
      expect(body.remaining_scope).toBeDefined();
    });

    it('returns 404 for non-existent work item', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/burndown/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/analytics/overdue', () => {
    it('returns overdue items', async () => {
      // Create an overdue work item (not_after in the past)
      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind, not_after)
         VALUES ('Overdue Issue', 'open', 'issue', now() - interval '5 days')`,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/overdue',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toBeDefined();
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items[0].title).toBe('Overdue Issue');
    });

    it('excludes closed items', async () => {
      // Create a closed overdue work item
      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind, not_after)
         VALUES ('Closed Overdue', 'closed', 'issue', now() - interval '5 days')`,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/overdue',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const closedOverdue = body.items.find((i: { title: string }) => i.title === 'Closed Overdue');
      expect(closedOverdue).toBeUndefined();
    });
  });

  describe('GET /api/analytics/blocked', () => {
    it('returns blocked items', async () => {
      // Create blocking relationship
      const blockingRes = await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind)
         VALUES ('Blocking Issue', 'open', 'issue')
         RETURNING id`,
      );
      const blockingId = blockingRes.rows[0].id;

      const blockedRes = await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind)
         VALUES ('Blocked Issue', 'open', 'issue')
         RETURNING id`,
      );
      const blockedId = blockedRes.rows[0].id;

      await pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $2, 'blocked_by')`,
        [blockedId, blockingId],
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/blocked',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toBeDefined();
      expect(body.items.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/analytics/activity-summary', () => {
    it('returns activity counts by day', async () => {
      // Create some activity by creating work items
      await pool.query(
        `INSERT INTO work_item (title, status, work_item_kind)
         VALUES ('New Issue', 'open', 'issue')`,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/analytics/activity-summary?days=7',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.days).toBeDefined();
      expect(Array.isArray(body.days)).toBe(true);
    });
  });
});
