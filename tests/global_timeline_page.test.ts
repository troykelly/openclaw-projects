import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Tests for Global Timeline Page integration (issue #134).
 * These tests verify that the /app/timeline route works and
 * the API returns data in the correct format for the Gantt view.
 */
describe('Global Timeline Page', () => {
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

  describe('GET /app/timeline', () => {
    it('renders the timeline page (returns HTML)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/app/timeline',
        headers: {
          accept: 'text/html',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('returns bootstrap data with timeline route', async () => {
      // Create a session cookie for authentication
      const pool2 = createTestPool();
      const session = await pool2.query(
        `INSERT INTO auth_session (email, expires_at)
         VALUES ('test@example.com', now() + interval '1 hour')
         RETURNING id::text as id`
      );
      const sessionId = (session.rows[0] as { id: string }).id;
      await pool2.end();

      const res = await app.inject({
        method: 'GET',
        url: '/app/timeline',
        cookies: {
          projects_session: sessionId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.payload).toContain('app-bootstrap');
      expect(res.payload).toContain('"timeline"');
    });
  });

  describe('Timeline API for Page', () => {
    it('returns items with dates for timeline display', async () => {
      // Create work items with dates
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
         VALUES ('Scheduled Task', 'issue', $1, $2)`,
        [now.toISOString(), nextWeek.toISOString()]
      );

      // Create item without dates (should not appear)
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Unscheduled Task', 'issue')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string }>; dependencies: unknown[] };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Scheduled Task');
    });

    it('filters by kind', async () => {
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
         VALUES ('Project Alpha', 'project', $1, $2),
                ('Epic 1', 'epic', $1, $2),
                ('Issue 1', 'issue', $1, $2)`,
        [now.toISOString(), nextWeek.toISOString()]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline?kind=project,epic',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string; kind: string }> };
      expect(body.items.length).toBe(2);
      expect(body.items.every((i) => i.kind === 'project' || i.kind === 'epic')).toBe(true);
    });

    it('filters by date range', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
         VALUES ('Past Task', 'issue', $1, $1),
                ('Current Task', 'issue', $2, $3),
                ('Future Task', 'issue', $3, $3)`,
        [past.toISOString(), now.toISOString(), future.toISOString()]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/timeline?from=${now.toISOString()}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string }> };
      // Should include Current and Future tasks
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      const titles = body.items.map((i) => i.title);
      expect(titles).toContain('Current Task');
      expect(titles).toContain('Future Task');
    });

    it('returns dependencies between items', async () => {
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Create two items with dates
      const item1 = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
         VALUES ('Task A', 'issue', $1, $2)
         RETURNING id::text as id`,
        [now.toISOString(), nextWeek.toISOString()]
      );
      const item1Id = (item1.rows[0] as { id: string }).id;

      const item2 = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
         VALUES ('Task B', 'issue', $1, $2)
         RETURNING id::text as id`,
        [now.toISOString(), nextWeek.toISOString()]
      );
      const item2Id = (item2.rows[0] as { id: string }).id;

      // Create dependency: Task B depends on Task A
      await pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $2, 'blocks')`,
        [item2Id, item1Id]
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: unknown[];
        dependencies: Array<{ from_id: string; to_id: string }>;
      };
      expect(body.dependencies.length).toBe(1);
      expect(body.dependencies[0].from_id).toBe(item2Id);
      expect(body.dependencies[0].to_id).toBe(item1Id);
    });

    it('filters by parent_id to get subtree', async () => {
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Create project with children
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
         VALUES ('Project 1', 'project', $1, $2)
         RETURNING id::text as id`,
        [now.toISOString(), nextWeek.toISOString()]
      );
      const projectId = (project.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after, parent_work_item_id)
         VALUES ('Epic 1-1', 'epic', $1, $2, $3)`,
        [now.toISOString(), nextWeek.toISOString(), projectId]
      );

      // Create another project (should not appear)
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
         VALUES ('Project 2', 'project', $1, $2)`,
        [now.toISOString(), nextWeek.toISOString()]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/timeline?parent_id=${projectId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string }> };
      // Should only include Project 1 and its children
      expect(body.items.length).toBe(2);
      const titles = body.items.map((i) => i.title);
      expect(titles).toContain('Project 1');
      expect(titles).toContain('Epic 1-1');
      expect(titles).not.toContain('Project 2');
    });
  });
});
