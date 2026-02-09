import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Project Tree navigation component (issue #144).
 * These tests verify the tree API endpoint returns hierarchical work items.
 */
describe('Project Tree', () => {
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

  describe('GET /api/work-items/tree', () => {
    it('returns empty tree when no work items exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: unknown[] };
      expect(body.items).toEqual([]);
    });

    it('returns top-level work items with children counts', async () => {
      // Create a project
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Project Alpha', 'project', 'in_progress')
         RETURNING id::text as id`,
      );
      const projectId = (project.rows[0] as { id: string }).id;

      // Create child issues
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Issue 1', 'issue', $1), ('Issue 2', 'issue', $1)`,
        [projectId],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{
          id: string;
          title: string;
          kind: string;
          status: string;
          children_count: number;
          children: unknown[];
        }>;
      };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Project Alpha');
      expect(body.items[0].kind).toBe('project');
      expect(body.items[0].children_count).toBe(2);
      // Children are populated in the tree structure
      expect(body.items[0].children.length).toBe(2);
    });

    it('returns hierarchical structure with nested children', async () => {
      // Create hierarchy: Project > Epic > Issues
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Project Beta', 'project')
         RETURNING id::text as id`,
      );
      const projectId = (project.rows[0] as { id: string }).id;

      const epic = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Epic 1', 'epic', $1)
         RETURNING id::text as id`,
        [projectId],
      );
      const epicId = (epic.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Issue A', 'issue', $1), ('Issue B', 'issue', $1)`,
        [epicId],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{
          id: string;
          title: string;
          children: Array<{
            id: string;
            title: string;
            children_count: number;
            children: unknown[];
          }>;
        }>;
      };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Project Beta');
      expect(body.items[0].children.length).toBe(1);
      expect(body.items[0].children[0].title).toBe('Epic 1');
      expect(body.items[0].children[0].children_count).toBe(2);
    });

    it('includes status in tree items', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Done Project', 'project', 'done'),
                ('In Progress Project', 'project', 'in_progress')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{ title: string; status: string }>;
      };
      expect(body.items.length).toBe(2);
      const statuses = body.items.map((i) => i.status);
      expect(statuses).toContain('done');
      expect(statuses).toContain('in_progress');
    });

    it('filters by root_id to get subtree', async () => {
      // Create hierarchy
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Project 1', 'project')
         RETURNING id::text as id`,
      );
      const projectId = (project.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Epic 1', 'epic', $1)`,
        [projectId],
      );

      // Another standalone project
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Project 2', 'project')`,
      );

      // Get tree from specific root
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/tree?root_id=${projectId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string }> };
      // Should only return the specified project's subtree
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Project 1');
    });
  });

  describe('Tree in Sidebar', () => {
    it('renders sidebar with tree in app shell', async () => {
      // Create session for authenticated access
      const session = await pool.query(
        `INSERT INTO auth_session (email, expires_at)
         VALUES ('test@example.com', now() + interval '1 hour')
         RETURNING id::text as id`,
      );
      const sessionId = (session.rows[0] as { id: string }).id;

      // Create some work items for the tree
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Project', 'project')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/app/work-items',
        cookies: {
          projects_session: sessionId,
        },
      });

      expect(res.statusCode).toBe(200);
      // The app shell should include project tree data
      expect(res.payload).toContain('app-bootstrap');
    });
  });
});
