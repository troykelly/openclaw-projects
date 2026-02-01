import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Tests for Enhanced Work Item Detail API (issue #143).
 */
describe('Enhanced Work Item Detail API', () => {
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

  describe('GET /api/work-items/:id', () => {
    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns full work item details', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, description, work_item_kind, not_before, not_after, estimate_minutes)
         VALUES ('Test Item', 'Test description', 'issue', '2024-03-01', '2024-03-15', 120)
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        id: string;
        title: string;
        description: string;
        kind: string;
        status: string;
        priority: string;
        parent_id: string | null;
        not_before: string | null;
        not_after: string | null;
        estimate_minutes: number | null;
        actual_minutes: number | null;
        created_at: string;
        updated_at: string;
      };

      expect(body.id).toBe(itemId);
      expect(body.title).toBe('Test Item');
      expect(body.description).toBe('Test description');
      expect(body.kind).toBeDefined();
      expect(body.status).toBeDefined();
      expect(body.priority).toBeDefined();
      expect(body.not_before).toBeDefined();
      expect(body.not_after).toBeDefined();
      expect(body.estimate_minutes).toBe(120);
      expect(body.created_at).toBeDefined();
      expect(body.updated_at).toBeDefined();
    });

    it('includes parent information', async () => {
      // Create parent (project)
      const parent = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Parent Project', 'project')
         RETURNING id::text as id`
      );
      const parentId = (parent.rows[0] as { id: string }).id;

      // Create child
      const child = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Child Item', 'issue', $1)
         RETURNING id::text as id`,
        [parentId]
      );
      const childId = (child.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${childId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        parent: { id: string; title: string; kind: string } | null;
      };

      expect(body.parent).toBeDefined();
      expect(body.parent?.id).toBe(parentId);
      expect(body.parent?.title).toBe('Parent Project');
      expect(body.parent?.kind).toBe('project');
    });

    it('includes null parent for top-level items', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Top Level Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { parent: null };
      expect(body.parent).toBeNull();
    });

    it('includes children count', async () => {
      // Create parent
      const parent = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Parent', 'project')
         RETURNING id::text as id`
      );
      const parentId = (parent.rows[0] as { id: string }).id;

      // Create children
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Child 1', 'issue', $1), ('Child 2', 'issue', $1), ('Child 3', 'issue', $1)`,
        [parentId]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${parentId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { children_count: number };
      expect(body.children_count).toBe(3);
    });

    it('includes zero children count for leaf items', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Leaf Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { children_count: number };
      expect(body.children_count).toBe(0);
    });

    it('includes dependencies (blocks and blocked_by)', async () => {
      // Create work items
      const item1 = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Item 1', 'issue')
         RETURNING id::text as id`
      );
      const id1 = (item1.rows[0] as { id: string }).id;

      const item2 = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Item 2', 'issue')
         RETURNING id::text as id`
      );
      const id2 = (item2.rows[0] as { id: string }).id;

      const item3 = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Item 3', 'issue')
         RETURNING id::text as id`
      );
      const id3 = (item3.rows[0] as { id: string }).id;

      // Item 2 is blocked by Item 1, and Item 3 is blocked by Item 2
      await pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $2, 'blocked_by')`,
        [id2, id1]
      );
      await pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $2, 'blocked_by')`,
        [id3, id2]
      );

      // Check Item 2
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${id2}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        dependencies: {
          blocks: Array<{ id: string; title: string }>;
          blocked_by: Array<{ id: string; title: string }>;
        };
      };

      expect(body.dependencies).toBeDefined();
      expect(body.dependencies.blocked_by.length).toBe(1);
      expect(body.dependencies.blocked_by[0].id).toBe(id1);
      expect(body.dependencies.blocked_by[0].title).toBe('Item 1');
      expect(body.dependencies.blocks.length).toBe(1);
      expect(body.dependencies.blocks[0].id).toBe(id3);
      expect(body.dependencies.blocks[0].title).toBe('Item 3');
    });

    it('includes empty dependencies for items with none', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('No Deps Item', 'issue')
         RETURNING id::text as id`
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        dependencies: {
          blocks: unknown[];
          blocked_by: unknown[];
        };
      };

      expect(body.dependencies).toBeDefined();
      expect(body.dependencies.blocks).toEqual([]);
      expect(body.dependencies.blocked_by).toEqual([]);
    });
  });
});
