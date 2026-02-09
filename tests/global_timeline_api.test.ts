import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Global Timeline API endpoint (issue #137).
 */
describe('Global Timeline API', () => {
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

  describe('GET /api/timeline', () => {
    it('returns empty arrays when no work items exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: unknown[]; dependencies: unknown[] };
      expect(body.items).toEqual([]);
      expect(body.dependencies).toEqual([]);
    });

    it('returns items with date constraints', async () => {
      // Create an item with dates via SQL
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after)
         VALUES ('Dated Item', 'issue', '2024-03-01', '2024-03-15')`,
      );

      // Create an item without dates (should be excluded by default)
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Undated Item', 'issue')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string; not_before: string; not_after: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Dated Item');
      expect(body.items[0].not_before).toBeDefined();
      expect(body.items[0].not_after).toBeDefined();
    });

    it('returns item structure with all expected fields', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before, not_after, estimate_minutes)
         VALUES ('Test Item', 'issue', '2024-03-01', '2024-03-15', 120)`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{
          id: string;
          title: string;
          kind: string;
          status: string;
          priority: string;
          parent_id: string | null;
          level: number;
          not_before: string | null;
          not_after: string | null;
          estimate_minutes: number | null;
          actual_minutes: number | null;
        }>;
      };

      expect(body.items.length).toBe(1);
      const item = body.items[0];
      expect(item.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(item.title).toBe('Test Item');
      expect(item.kind).toBeDefined();
      expect(item.status).toBeDefined();
      expect(item.priority).toBeDefined();
      expect(item.level).toBe(0);
      expect(item.estimate_minutes).toBe(120);
    });

    it('filters by date range - from', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('March Item', 'issue', '2024-03-01')`,
      );

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_after)
         VALUES ('January Item', 'issue', '2024-01-31')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline?from=2024-02-01',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('March Item');
    });

    it('filters by date range - to', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('March Item', 'issue', '2024-03-01')`,
      );

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('January Item', 'issue', '2024-01-15')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline?to=2024-02-01',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('January Item');
    });

    it('filters by kind', async () => {
      // Create a project
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('Project', 'project', '2024-03-01')
         RETURNING id::text as id`,
      );
      const projectId = (project.rows[0] as { id: string }).id;

      // Create an initiative under project
      const initiative = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before)
         VALUES ('Initiative', 'initiative', $1, '2024-03-01')
         RETURNING id::text as id`,
        [projectId],
      );
      const initiativeId = (initiative.rows[0] as { id: string }).id;

      // Create an epic under initiative
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before)
         VALUES ('Epic', 'epic', $1, '2024-03-01')`,
        [initiativeId],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline?kind=epic',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string; kind: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Epic');
      expect(body.items[0].kind).toBe('epic');
    });

    it('filters by multiple kinds', async () => {
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('Project', 'project', '2024-03-01')
         RETURNING id::text as id`,
      );
      const projectId = (project.rows[0] as { id: string }).id;

      const initiative = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before)
         VALUES ('Initiative', 'initiative', $1, '2024-03-01')
         RETURNING id::text as id`,
        [projectId],
      );
      const initiativeId = (initiative.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before)
         VALUES ('Epic', 'epic', $1, '2024-03-01')`,
        [initiativeId],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline?kind=project,initiative',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string }> };
      expect(body.items.length).toBe(2);
    });

    it('filters by parent_id', async () => {
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('Project', 'project', '2024-03-01')
         RETURNING id::text as id`,
      );
      const projectId = (project.rows[0] as { id: string }).id;

      const initiative = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before)
         VALUES ('Initiative', 'initiative', $1, '2024-03-01')
         RETURNING id::text as id`,
        [projectId],
      );
      const initiativeId = (initiative.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before)
         VALUES ('Epic Under Initiative', 'epic', $1, '2024-03-01')`,
        [initiativeId],
      );

      // Another top-level project
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('Other Project', 'project', '2024-03-01')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/timeline?parent_id=${projectId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string }> };
      // Should include project, initiative, and epic under it
      expect(body.items.length).toBe(3);
      expect(body.items.map((i) => i.title)).toContain('Project');
      expect(body.items.map((i) => i.title)).toContain('Initiative');
      expect(body.items.map((i) => i.title)).toContain('Epic Under Initiative');
    });

    it('includes dependencies between items', async () => {
      // Create two items with dates
      const item1 = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('First Task', 'issue', '2024-03-01')
         RETURNING id::text as id`,
      );
      const id1 = (item1.rows[0] as { id: string }).id;

      const item2 = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('Second Task', 'issue', '2024-03-15')
         RETURNING id::text as id`,
      );
      const id2 = (item2.rows[0] as { id: string }).id;

      // Create dependency
      await pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $2, 'blocked_by')`,
        [id2, id1],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/timeline',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: unknown[];
        dependencies: Array<{
          id: string;
          from_id: string;
          to_id: string;
          kind: string;
        }>;
      };

      expect(body.dependencies.length).toBe(1);
      expect(body.dependencies[0].from_id).toBe(id2);
      expect(body.dependencies[0].to_id).toBe(id1);
      expect(body.dependencies[0].kind).toBe('blocked_by');
    });

    it('includes level in hierarchy for items under parent_id filter', async () => {
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, not_before)
         VALUES ('Project', 'project', '2024-03-01')
         RETURNING id::text as id`,
      );
      const projectId = (project.rows[0] as { id: string }).id;

      const initiative = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before)
         VALUES ('Initiative', 'initiative', $1, '2024-03-01')
         RETURNING id::text as id`,
        [projectId],
      );
      const initiativeId = (initiative.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id, not_before)
         VALUES ('Epic', 'epic', $1, '2024-03-01')`,
        [initiativeId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/timeline?parent_id=${projectId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string; level: number }> };

      const projectItem = body.items.find((i) => i.title === 'Project');
      const initiativeItem = body.items.find((i) => i.title === 'Initiative');
      const epicItem = body.items.find((i) => i.title === 'Epic');

      expect(projectItem?.level).toBe(0);
      expect(initiativeItem?.level).toBe(1);
      expect(epicItem?.level).toBe(2);
    });
  });
});
