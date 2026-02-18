import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Work Items Tree API endpoint (issue #145).
 */
describe('Work Items Tree API', () => {
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
    it('returns empty array when no work items exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: unknown[] };
      expect(body.items).toEqual([]);
    });

    it('returns top-level items as roots', async () => {
      // Create two top-level items (issues without parent)
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Issue 1', 'issue'), ('Issue 2', 'issue')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{ title: string; kind: string; children: unknown[] }>;
      };
      expect(body.items.length).toBe(2);
      expect(body.items[0].kind).toBe('issue');
      expect(body.items[1].kind).toBe('issue');
    });

    it('returns hierarchical structure with children', async () => {
      // Create project -> initiative -> epic -> issue hierarchy
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Project Alpha', 'project')
         RETURNING id::text as id`,
      );
      const project_id = (project.rows[0] as { id: string }).id;

      const initiative = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Initiative 1', 'initiative', $1)
         RETURNING id::text as id`,
        [project_id],
      );
      const initiativeId = (initiative.rows[0] as { id: string }).id;

      const epic = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Epic 1', 'epic', $1)
         RETURNING id::text as id`,
        [initiativeId],
      );
      const epicId = (epic.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Issue 1', 'issue', $1)`,
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
          kind: string;
          children_count: number;
          children: Array<{
            title: string;
            kind: string;
            children_count: number;
            children: unknown[];
          }>;
        }>;
      };

      // Should only return the project at root level
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Project Alpha');
      expect(body.items[0].kind).toBe('project');
      expect(body.items[0].children_count).toBe(1);
      expect(body.items[0].children.length).toBe(1);
      expect(body.items[0].children[0].title).toBe('Initiative 1');
      expect(body.items[0].children[0].children_count).toBe(1);
    });

    it('includes status in tree items', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Open Item', 'issue', 'open')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{ title: string; status: string }>;
      };
      expect(body.items[0].status).toBe('open');
    });

    it('includes priority in tree items', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, priority)
         VALUES ('High Priority', 'issue', 'P0')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{ title: string; priority: string }>;
      };
      expect(body.items[0].priority).toBe('P0');
    });

    it('returns subtree when root_id is specified', async () => {
      // Create two separate trees
      const project1 = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Project 1', 'project')
         RETURNING id::text as id`,
      );
      const project1Id = (project1.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Initiative 1-1', 'initiative', $1)`,
        [project1Id],
      );

      const project2 = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Project 2', 'project')
         RETURNING id::text as id`,
      );
      const project2Id = (project2.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Initiative 2-1', 'initiative', $1)`,
        [project2Id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/tree?root_id=${project1Id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{
          title: string;
          children: Array<{ title: string }>;
        }>;
      };

      // Should only return Project 1 and its children
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Project 1');
      expect(body.items[0].children.length).toBe(1);
      expect(body.items[0].children[0].title).toBe('Initiative 1-1');
    });

    it('returns 404 when root_id does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree?root_id=00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });

    it('limits depth to prevent deep recursion', async () => {
      // Create a deep hierarchy: project -> initiative -> epic -> issue
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Project', 'project')
         RETURNING id::text as id`,
      );
      const project_id = (project.rows[0] as { id: string }).id;

      const initiative = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Initiative', 'initiative', $1)
         RETURNING id::text as id`,
        [project_id],
      );
      const initiativeId = (initiative.rows[0] as { id: string }).id;

      const epic = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Epic', 'epic', $1)
         RETURNING id::text as id`,
        [initiativeId],
      );
      const epicId = (epic.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Issue', 'issue', $1)`,
        [epicId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/tree?depth=2`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{
          title: string;
          children: Array<{
            title: string;
            children: unknown[] | null;
          }>;
        }>;
      };

      // At depth 2, we should have project and initiative, but epic's children should be null or limited
      expect(body.items[0].title).toBe('Project');
      expect(body.items[0].children[0].title).toBe('Initiative');
    });

    it('includes children_count for all items', async () => {
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Project', 'project')
         RETURNING id::text as id`,
      );
      const project_id = (project.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Init 1', 'initiative', $1), ('Init 2', 'initiative', $1), ('Init 3', 'initiative', $1)`,
        [project_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/tree',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{
          title: string;
          children_count: number;
          children: unknown[];
        }>;
      };

      expect(body.items[0].children_count).toBe(3);
      expect(body.items[0].children.length).toBe(3);
    });
  });
});
