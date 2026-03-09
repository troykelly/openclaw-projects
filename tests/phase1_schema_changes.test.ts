/**
 * Phase 1 — Schema change tests
 *
 * Issue #2289: Add 'list' kind to work_item_kind enum with constraints
 * Issue #2290: Enhance work_item_todo with sort_order, dates, priority, namespace, updated_at
 * Issue #2291: Add orphan-to-triage audit trail trigger
 * Issue #2305: Migrate work_item.sort_order from INTEGER to BIGINT
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Phase 1: Schema changes', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // ─── #2289: 'list' kind ────────────────────────────────────────

  describe('#2289: list kind', () => {
    it('creates a list work item successfully', async () => {
      const res = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Shopping', 'list')
         RETURNING id, kind, work_item_kind::text as wik`,
      );
      expect(res.rows.length).toBe(1);
      const row = res.rows[0] as { id: string; kind: string; wik: string };
      expect(row.kind).toBe('list');
      expect(row.wik).toBe('list');
    });

    it('rejects list with a parent (CHECK constraint)', async () => {
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Project', 'project')
         RETURNING id`,
      );
      const projectId = (project.rows[0] as { id: string }).id;

      await expect(
        pool.query(
          `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
           VALUES ('List With Parent', 'list', $1)`,
          [projectId],
        ),
      ).rejects.toThrow();
    });

    it('rejects child work item under a list (trigger)', async () => {
      const list = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('My List', 'list')
         RETURNING id`,
      );
      const listId = (list.rows[0] as { id: string }).id;

      // Trying to create an issue under a list should fail
      await expect(
        pool.query(
          `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
           VALUES ('Issue Under List', 'issue', $1)`,
          [listId],
        ),
      ).rejects.toThrow();
    });

    it('list does not appear in rollup project view', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, estimate_minutes)
         VALUES ('My List', 'list', 10)`,
      );

      const rollup = await pool.query(
        `SELECT * FROM work_item_rollup_project`,
      );
      // Lists should not appear as rollup roots
      const rows = rollup.rows as Array<{ title: string }>;
      expect(rows.find((r) => r.title === 'My List')).toBeUndefined();
    });

    it('list gets embedding_status skipped', async () => {
      const res = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Skip Embedding List', 'list')
         RETURNING id`,
      );
      const listId = (res.rows[0] as { id: string }).id;

      // Check embedding_status column if it exists
      const check = await pool.query(
        `SELECT embedding_status FROM work_item WHERE id = $1`,
        [listId],
      );
      if (check.rows.length > 0) {
        const status = (check.rows[0] as { embedding_status: string | null }).embedding_status;
        expect(status).toBe('skipped');
      }
    });

    it('list kind is accepted by kind CHECK constraint', async () => {
      // Verify the kind text column also accepts 'list'
      const res = await pool.query(
        `INSERT INTO work_item (title, kind, work_item_kind)
         VALUES ('List via both', 'list', 'list')
         RETURNING kind`,
      );
      expect((res.rows[0] as { kind: string }).kind).toBe('list');
    });
  });

  // ─── #2290: Enhanced work_item_todo ─────────────────────────────

  describe('#2290: Enhanced work_item_todo', () => {
    let workItemId: string;

    beforeEach(async () => {
      await truncateAllTables(pool);
      const res = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Todo Parent', 'issue')
         RETURNING id`,
      );
      workItemId = (res.rows[0] as { id: string }).id;
    });

    it('creates todo with sort_order', async () => {
      const res = await pool.query(
        `INSERT INTO work_item_todo (work_item_id, text, sort_order)
         VALUES ($1, 'First item', 1000)
         RETURNING sort_order`,
        [workItemId],
      );
      expect((res.rows[0] as { sort_order: string }).sort_order).toBe('1000');
    });

    it('creates todo with not_before and not_after dates', async () => {
      const res = await pool.query(
        `INSERT INTO work_item_todo (work_item_id, text, not_before, not_after)
         VALUES ($1, 'Scheduled todo', '2026-03-10T09:00:00Z', '2026-03-15T17:00:00Z')
         RETURNING not_before, not_after`,
        [workItemId],
      );
      const row = res.rows[0] as { not_before: string; not_after: string };
      expect(row.not_before).toBeTruthy();
      expect(row.not_after).toBeTruthy();
    });

    it('rejects todo with not_before > not_after', async () => {
      await expect(
        pool.query(
          `INSERT INTO work_item_todo (work_item_id, text, not_before, not_after)
           VALUES ($1, 'Bad dates', '2026-03-15T09:00:00Z', '2026-03-10T09:00:00Z')`,
          [workItemId],
        ),
      ).rejects.toThrow(/date/i);
    });

    it('rejects todo with empty text', async () => {
      await expect(
        pool.query(
          `INSERT INTO work_item_todo (work_item_id, text)
           VALUES ($1, '   ')`,
          [workItemId],
        ),
      ).rejects.toThrow();
    });

    it('todo inherits namespace from parent work_item', async () => {
      const nsItem = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, namespace)
         VALUES ('NS Item', 'issue', 'custom-ns')
         RETURNING id`,
      );
      const nsItemId = (nsItem.rows[0] as { id: string }).id;

      const todo = await pool.query(
        `INSERT INTO work_item_todo (work_item_id, text)
         VALUES ($1, 'NS Todo')
         RETURNING namespace`,
        [nsItemId],
      );
      expect((todo.rows[0] as { namespace: string }).namespace).toBe('custom-ns');
    });

    it('updated_at auto-updates on field changes', async () => {
      const todo = await pool.query(
        `INSERT INTO work_item_todo (work_item_id, text)
         VALUES ($1, 'Update test')
         RETURNING id, updated_at`,
        [workItemId],
      );
      const todoId = (todo.rows[0] as { id: string }).id;
      const originalUpdatedAt = (todo.rows[0] as { updated_at: Date }).updated_at;

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 50));

      await pool.query(
        `UPDATE work_item_todo SET text = 'Updated text' WHERE id = $1`,
        [todoId],
      );

      const check = await pool.query(
        `SELECT updated_at FROM work_item_todo WHERE id = $1`,
        [todoId],
      );
      const newUpdatedAt = (check.rows[0] as { updated_at: Date }).updated_at;
      expect(new Date(newUpdatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
    });

    it('priority field accepts P0-P4 values', async () => {
      for (const p of ['P0', 'P1', 'P2', 'P3', 'P4']) {
        const res = await pool.query(
          `INSERT INTO work_item_todo (work_item_id, text, priority)
           VALUES ($1, $2, $3::work_item_priority)
           RETURNING priority::text as priority`,
          [workItemId, `Priority ${p}`, p],
        );
        expect((res.rows[0] as { priority: string }).priority).toBe(p);
      }
    });

    it('default sort_order is based on epoch', async () => {
      const res = await pool.query(
        `INSERT INTO work_item_todo (work_item_id, text)
         VALUES ($1, 'Default sort')
         RETURNING sort_order`,
        [workItemId],
      );
      const sortOrder = Number((res.rows[0] as { sort_order: string }).sort_order);
      // Should be a reasonable epoch value (> 2026-01-01 epoch)
      expect(sortOrder).toBeGreaterThan(1767225600);
    });
  });

  // ─── #2291: Orphan audit trail ──────────────────────────────────

  describe('#2291: Orphan-to-triage audit trail', () => {
    it('logs activity when parent is set to NULL', async () => {
      // Create hierarchy
      const project = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Audit Project', 'project')
         RETURNING id`,
      );
      const projectId = (project.rows[0] as { id: string }).id;

      const init = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Audit Init', 'initiative', $1)
         RETURNING id`,
        [projectId],
      );
      const initId = (init.rows[0] as { id: string }).id;

      const epic = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Audit Epic', 'epic', $1)
         RETURNING id`,
        [initId],
      );
      const epicId = (epic.rows[0] as { id: string }).id;

      const issue = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, parent_work_item_id)
         VALUES ('Audit Issue', 'issue', $1)
         RETURNING id`,
        [epicId],
      );
      const issueId = (issue.rows[0] as { id: string }).id;

      // Soft-delete the epic, which should SET NULL on issue's parent via FK cascade
      await pool.query(
        `UPDATE work_item SET parent_work_item_id = NULL, parent_id = NULL WHERE id = $1`,
        [issueId],
      );

      // Check that an audit trail was created
      const activity = await pool.query(
        `SELECT activity_type::text as activity_type, description
         FROM work_item_activity
         WHERE work_item_id = $1 AND activity_type = 'parent_removed'`,
        [issueId],
      );
      expect(activity.rows.length).toBe(1);
      const row = activity.rows[0] as { activity_type: string; description: string };
      expect(row.activity_type).toBe('parent_removed');
      expect(row.description).toContain(epicId);
    });

    it('does not trigger audit when inserting item without parent', async () => {
      const issue = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('No Parent Issue', 'issue')
         RETURNING id`,
      );
      const issueId = (issue.rows[0] as { id: string }).id;

      const activity = await pool.query(
        `SELECT * FROM work_item_activity WHERE work_item_id = $1 AND activity_type = 'parent_removed'`,
        [issueId],
      );
      expect(activity.rows.length).toBe(0);
    });
  });

  // ─── #2305: BIGINT sort_order ───────────────────────────────────

  describe('#2305: sort_order BIGINT migration', () => {
    it('accepts sort_order values larger than INT4_MAX', async () => {
      const bigValue = 2147483648; // INT4_MAX + 1
      const res = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, sort_order)
         VALUES ('Big Sort', 'issue', $1)
         RETURNING sort_order`,
        [bigValue],
      );
      expect(Number((res.rows[0] as { sort_order: string }).sort_order)).toBe(bigValue);
    });

    it('accepts sort_order at epoch-based values past 2038', async () => {
      const year2040Epoch = 2208988800; // Unix epoch for ~2040
      const res = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, sort_order)
         VALUES ('Future Sort', 'issue', $1)
         RETURNING sort_order`,
        [year2040Epoch],
      );
      expect(Number((res.rows[0] as { sort_order: string }).sort_order)).toBe(year2040Epoch);
    });
  });
});
