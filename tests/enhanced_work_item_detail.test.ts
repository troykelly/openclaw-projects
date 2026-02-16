import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Enhanced Work Item Detail page (issue #142).
 * These tests verify the work item detail API returns full metadata
 * and supports update operations.
 */
describe('Enhanced Work Item Detail', () => {
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
    it('returns full work item metadata', async () => {
      // Create a work item with all metadata
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Priority enum uses P0-P4 (not high/low/etc)
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, description, status, priority, not_before, not_after, estimate_minutes)
         VALUES ('Test Item', 'issue', 'Item description', 'in_progress', 'P1', $1, $2, 120)
         RETURNING id::text as id`,
        [now.toISOString(), nextWeek.toISOString()],
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
        status: string;
        priority: string;
        not_before: string;
        not_after: string;
        estimate_minutes: number;
      };
      expect(body.id).toBe(itemId);
      expect(body.title).toBe('Test Item');
      expect(body.description).toBe('Item description');
      expect(body.status).toBe('in_progress');
      expect(body.priority).toBe('P1');
      expect(body.not_before).toBeDefined();
      expect(body.not_after).toBeDefined();
      expect(body.estimate_minutes).toBe(120);
    });

    it('returns dependencies with work item', async () => {
      // Create main item and dependency
      const mainItem = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Main Task', 'issue')
         RETURNING id::text as id`,
      );
      const mainId = (mainItem.rows[0] as { id: string }).id;

      const blockingItem = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Blocking Task', 'issue')
         RETURNING id::text as id`,
      );
      const blockingId = (blockingItem.rows[0] as { id: string }).id;

      const blockedByItem = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Prerequisite Task', 'issue')
         RETURNING id::text as id`,
      );
      const blockedById = (blockedByItem.rows[0] as { id: string }).id;

      // Create dependencies: main blocks blocking, main is blocked by blockedBy
      await pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $2, 'blocks')`,
        [blockingId, mainId],
      );
      await pool.query(
        `INSERT INTO work_item_dependency (work_item_id, depends_on_work_item_id, kind)
         VALUES ($1, $2, 'blocks')`,
        [mainId, blockedById],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${mainId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        dependencies: Array<{
          id: string;
          title: string;
          kind: string;
          status: string;
          direction: 'blocks' | 'blocked_by';
        }>;
      };
      expect(body.dependencies).toBeDefined();
      expect(Array.isArray(body.dependencies)).toBe(true);

      // Find dependencies by direction
      const blocks = body.dependencies.filter((d) => d.direction === 'blocks');
      const blockedBy = body.dependencies.filter((d) => d.direction === 'blocked_by');

      expect(blocks.length).toBe(1);
      expect(blocks[0].title).toBe('Blocking Task');
      expect(blockedBy.length).toBe(1);
      expect(blockedBy[0].title).toBe('Prerequisite Task');
    });

    it('returns parent information', async () => {
      // Create parent and child
      const parent = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Parent Project', 'project')
         RETURNING id::text as id`,
      );
      const parentId = (parent.rows[0] as { id: string }).id;

      const child = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Child Issue', 'issue', $1)
         RETURNING id::text as id`,
        [parentId],
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

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('PUT /api/work-items/:id', () => {
    it('updates work item title', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Original Title', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${itemId}`,
        payload: {
          title: 'Updated Title',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { title: string };
      expect(body.title).toBe('Updated Title');
    });

    it('updates work item description', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      // PUT requires title to be included (it's not optional)
      const res = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${itemId}`,
        payload: {
          title: 'Test Item',
          description: 'New description with **markdown**',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { description: string };
      expect(body.description).toBe('New description with **markdown**');
    });

    it('updates work item status', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Test Item', 'issue', 'not_started')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${itemId}`,
        payload: {
          title: 'Test Item',
          status: 'in_progress',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { status: string };
      expect(body.status).toBe('in_progress');
    });

    it('updates work item priority', async () => {
      // Priority uses P0-P4 enum values
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, priority)
         VALUES ('Test Item', 'issue', 'P3')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${itemId}`,
        payload: {
          title: 'Test Item',
          priority: 'P0',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { priority: string };
      expect(body.priority).toBe('P0');
    });

    it('updates work item dates', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const res = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${itemId}`,
        payload: {
          title: 'Test Item',
          notBefore: now.toISOString(),
          notAfter: nextWeek.toISOString(),
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { not_before: string; not_after: string };
      expect(body.not_before).toBeDefined();
      expect(body.not_after).toBeDefined();
    });

    it('updates work item estimates', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/work-items/${itemId}`,
        payload: {
          title: 'Test Item',
          estimateMinutes: 240,
          actualMinutes: 180,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { estimate_minutes: number; actual_minutes: number };
      expect(body.estimate_minutes).toBe(240);
      expect(body.actual_minutes).toBe(180);
    });
  });

  describe('/app/work-items/:id page rendering', () => {
    it('renders the detail page (returns HTML)', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/app/work-items/${itemId}`,
        headers: {
          accept: 'text/html',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('includes work item data in bootstrap', async () => {
      // Use E2E bypass for authentication (JWT replaced session cookies)
      process.env.OPENCLAW_E2E_SESSION_EMAIL = 'test@example.com';

      try {
        const item = await pool.query(
          `INSERT INTO work_item (title, work_item_kind, description)
           VALUES ('Test Item', 'issue', 'Test description')
           RETURNING id::text as id`,
        );
        const itemId = (item.rows[0] as { id: string }).id;

        const res = await app.inject({
          method: 'GET',
          url: `/app/work-items/${itemId}`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.payload).toContain('app-bootstrap');
        expect(res.payload).toContain('Test Item');
      } finally {
        delete process.env.OPENCLAW_E2E_SESSION_EMAIL;
      }
    });
  });
});
