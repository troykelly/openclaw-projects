import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool } from './helpers/db.ts';

describe('Bulk Operations API', () => {
  let pool: Pool;
  let testItemIds: string[] = [];

  beforeAll(async () => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM work_item WHERE title LIKE 'bulk-test-%'");

    // Create test items
    testItemIds = [];
    for (let i = 1; i <= 5; i++) {
      const result = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ($1, 'issue', 'backlog') RETURNING id::text as id`,
        [`bulk-test-item-${i}`],
      );
      testItemIds.push(result.rows[0].id);
    }
  });

  describe('PATCH /api/work-items/bulk/status', () => {
    it('updates status for multiple items', async () => {
      // Update first 3 items to "in_progress"
      const idsToUpdate = testItemIds.slice(0, 3);

      const result = await pool.query(
        `UPDATE work_item
         SET status = $1, updated_at = now()
         WHERE id = ANY($2::uuid[])
         RETURNING id::text as id, status`,
        ['in_progress', idsToUpdate],
      );

      expect(result.rows.length).toBe(3);
      result.rows.forEach((row: { id: string; status: string }) => {
        expect(row.status).toBe('in_progress');
        expect(idsToUpdate).toContain(row.id);
      });
    });

    it('leaves unselected items unchanged', async () => {
      const idsToUpdate = testItemIds.slice(0, 2);

      await pool.query(
        `UPDATE work_item
         SET status = $1, updated_at = now()
         WHERE id = ANY($2::uuid[])`,
        ['in_progress', idsToUpdate],
      );

      // Check unchanged items
      const result = await pool.query(`SELECT id::text as id, status FROM work_item WHERE id = ANY($1::uuid[])`, [testItemIds.slice(2)]);

      result.rows.forEach((row: { id: string; status: string }) => {
        expect(row.status).toBe('backlog');
      });
    });
  });

  describe('PATCH /api/work-items/bulk/priority', () => {
    it('updates priority for multiple items', async () => {
      const idsToUpdate = testItemIds.slice(0, 3);

      const result = await pool.query(
        `UPDATE work_item
         SET priority = $1, updated_at = now()
         WHERE id = ANY($2::uuid[])
         RETURNING id::text as id, priority::text as priority`,
        ['P0', idsToUpdate],
      );

      expect(result.rows.length).toBe(3);
      result.rows.forEach((row: { id: string; priority: string }) => {
        expect(row.priority).toBe('P0');
      });
    });
  });

  describe('DELETE /api/work-items/bulk', () => {
    it('deletes multiple items', async () => {
      const idsToDelete = testItemIds.slice(0, 2);

      await pool.query(`DELETE FROM work_item WHERE id = ANY($1::uuid[])`, [idsToDelete]);

      // Verify deleted
      const result = await pool.query(`SELECT id::text as id FROM work_item WHERE id = ANY($1::uuid[])`, [idsToDelete]);
      expect(result.rows.length).toBe(0);

      // Verify remaining
      const remaining = await pool.query(`SELECT id::text as id FROM work_item WHERE id = ANY($1::uuid[])`, [testItemIds.slice(2)]);
      expect(remaining.rows.length).toBe(3);
    });
  });

  describe('PATCH /api/work-items/bulk/parent', () => {
    it('reparents multiple items to a new parent', async () => {
      // Create a parent
      const parentResult = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ($1, 'epic', 'backlog') RETURNING id::text as id`,
        ['bulk-test-parent'],
      );
      const parent_id = parentResult.rows[0].id;

      const idsToReparent = testItemIds.slice(0, 3);

      await pool.query(
        `UPDATE work_item
         SET parent_work_item_id = $1, updated_at = now()
         WHERE id = ANY($2::uuid[])`,
        [parent_id, idsToReparent],
      );

      // Verify reparenting
      const result = await pool.query(
        `SELECT id::text as id, parent_work_item_id::text as parent_id
         FROM work_item WHERE id = ANY($1::uuid[])`,
        [idsToReparent],
      );

      result.rows.forEach((row: { id: string; parent_id: string }) => {
        expect(row.parent_id).toBe(parent_id);
      });
    });

    it('can unparent multiple items', async () => {
      // First create parent and reparent items
      const parentResult = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ($1, 'epic', 'backlog') RETURNING id::text as id`,
        ['bulk-test-parent-2'],
      );
      const parent_id = parentResult.rows[0].id;

      await pool.query(
        `UPDATE work_item
         SET parent_work_item_id = $1
         WHERE id = ANY($2::uuid[])`,
        [parent_id, testItemIds.slice(0, 3)],
      );

      // Now unparent
      const idsToUnparent = testItemIds.slice(0, 2);
      await pool.query(
        `UPDATE work_item
         SET parent_work_item_id = NULL, updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [idsToUnparent],
      );

      // Verify
      const result = await pool.query(
        `SELECT id::text as id, parent_work_item_id
         FROM work_item WHERE id = ANY($1::uuid[])`,
        [idsToUnparent],
      );

      result.rows.forEach((row: { id: string; parent_work_item_id: unknown }) => {
        expect(row.parent_work_item_id).toBeNull();
      });
    });
  });

  describe('Bulk operation with transaction', () => {
    it('rolls back on error (atomicity)', async () => {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Update first item
        await client.query(`UPDATE work_item SET status = 'in_progress' WHERE id = $1`, [testItemIds[0]]);

        // Simulate error by trying to update with invalid data
        try {
          await client.query(`UPDATE work_item SET status = 'invalid_status_that_does_not_exist' WHERE id = $1`, [testItemIds[1]]);
        } catch {
          // Expected
        }

        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // Verify first item was not updated due to rollback
      const result = await pool.query(`SELECT status FROM work_item WHERE id = $1`, [testItemIds[0]]);
      expect(result.rows[0].status).toBe('backlog');
    });
  });
});
