/**
 * Tests for soft delete service functions.
 * Part of Issue #225.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';
import {
  softDeleteWorkItem,
  softDeleteContact,
  hardDeleteWorkItem,
  hardDeleteContact,
  restoreWorkItem,
  restoreContact,
  restore,
  listTrash,
  purgeOldItems,
  getTrashCount,
  isDeleted,
} from '../../src/api/soft-delete/index.ts';

describe('Soft Delete Service', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('softDeleteWorkItem', () => {
    it('soft deletes a work item', async () => {
      // Create a work item
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Test Task') RETURNING id::text`);
      const work_item_id = result.rows[0].id;

      // Soft delete
      const deleted = await softDeleteWorkItem(pool, work_item_id);
      expect(deleted).toBe(true);

      // Verify it's deleted
      const check = await pool.query(`SELECT deleted_at FROM work_item WHERE id = $1`, [work_item_id]);
      expect(check.rows[0].deleted_at).not.toBeNull();
    });

    it('returns false for non-existent work item', async () => {
      const deleted = await softDeleteWorkItem(pool, '00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });

    it('returns false if already deleted', async () => {
      // Create and soft delete
      const result = await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Deleted Task', now()) RETURNING id::text`);
      const work_item_id = result.rows[0].id;

      const deleted = await softDeleteWorkItem(pool, work_item_id);
      expect(deleted).toBe(false);
    });
  });

  describe('softDeleteContact', () => {
    it('soft deletes a contact', async () => {
      const result = await pool.query(`INSERT INTO contact (display_name) VALUES ('John Doe') RETURNING id::text`);
      const contact_id = result.rows[0].id;

      const deleted = await softDeleteContact(pool, contact_id);
      expect(deleted).toBe(true);

      const check = await pool.query(`SELECT deleted_at FROM contact WHERE id = $1`, [contact_id]);
      expect(check.rows[0].deleted_at).not.toBeNull();
    });
  });

  describe('hardDeleteWorkItem', () => {
    it('permanently deletes a work item', async () => {
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Test Task') RETURNING id::text`);
      const work_item_id = result.rows[0].id;

      const deleted = await hardDeleteWorkItem(pool, work_item_id);
      expect(deleted).toBe(true);

      const check = await pool.query(`SELECT * FROM work_item WHERE id = $1`, [work_item_id]);
      expect(check.rows.length).toBe(0);
    });
  });

  describe('hardDeleteContact', () => {
    it('permanently deletes a contact', async () => {
      const result = await pool.query(`INSERT INTO contact (display_name) VALUES ('Jane Doe') RETURNING id::text`);
      const contact_id = result.rows[0].id;

      const deleted = await hardDeleteContact(pool, contact_id);
      expect(deleted).toBe(true);

      const check = await pool.query(`SELECT * FROM contact WHERE id = $1`, [contact_id]);
      expect(check.rows.length).toBe(0);
    });
  });

  describe('restoreWorkItem', () => {
    it('restores a soft-deleted work item', async () => {
      // Create and soft delete
      const result = await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Deleted Task', now()) RETURNING id::text`);
      const work_item_id = result.rows[0].id;

      const restored = await restoreWorkItem(pool, work_item_id);
      expect(restored).not.toBeNull();
      expect(restored?.success).toBe(true);
      expect(restored?.entity_type).toBe('work_item');
      expect(restored?.entity_id).toBe(work_item_id);

      // Verify it's restored
      const check = await pool.query(`SELECT deleted_at FROM work_item WHERE id = $1`, [work_item_id]);
      expect(check.rows[0].deleted_at).toBeNull();
    });

    it('returns null for non-deleted work item', async () => {
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Active Task') RETURNING id::text`);
      const work_item_id = result.rows[0].id;

      const restored = await restoreWorkItem(pool, work_item_id);
      expect(restored).toBeNull();
    });
  });

  describe('restoreContact', () => {
    it('restores a soft-deleted contact', async () => {
      const result = await pool.query(`INSERT INTO contact (display_name, deleted_at) VALUES ('Deleted Contact', now()) RETURNING id::text`);
      const contact_id = result.rows[0].id;

      const restored = await restoreContact(pool, contact_id);
      expect(restored).not.toBeNull();
      expect(restored?.success).toBe(true);
      expect(restored?.entity_type).toBe('contact');
    });
  });

  describe('restore', () => {
    it('restores work_item by type', async () => {
      const result = await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Deleted', now()) RETURNING id::text`);
      const work_item_id = result.rows[0].id;

      const restored = await restore(pool, 'work_item', work_item_id);
      expect(restored?.entity_type).toBe('work_item');
    });

    it('restores contact by type', async () => {
      const result = await pool.query(`INSERT INTO contact (display_name, deleted_at) VALUES ('Deleted', now()) RETURNING id::text`);
      const contact_id = result.rows[0].id;

      const restored = await restore(pool, 'contact', contact_id);
      expect(restored?.entity_type).toBe('contact');
    });
  });

  describe('listTrash', () => {
    it('lists all soft-deleted items', async () => {
      // Create deleted work items and contacts
      await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Deleted Task 1', now())`);
      await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Deleted Task 2', now())`);
      await pool.query(`INSERT INTO contact (display_name, deleted_at) VALUES ('Deleted Contact', now())`);

      const result = await listTrash(pool);
      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('filters by entity type', async () => {
      await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Deleted Task', now())`);
      await pool.query(`INSERT INTO contact (display_name, deleted_at) VALUES ('Deleted Contact', now())`);

      const workItemsResult = await listTrash(pool, { entity_type: 'work_item' });
      expect(workItemsResult.items.every((i) => i.entity_type === 'work_item')).toBe(true);

      const contactsResult = await listTrash(pool, { entity_type: 'contact' });
      expect(contactsResult.items.every((i) => i.entity_type === 'contact')).toBe(true);
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ($1, now())`, [`Task ${i}`]);
      }

      const result = await listTrash(pool, { limit: 2, offset: 0 });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(5);
    });
  });

  describe('getTrashCount', () => {
    it('returns counts of deleted items', async () => {
      await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Deleted Task 1', now())`);
      await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Deleted Task 2', now())`);
      await pool.query(`INSERT INTO contact (display_name, deleted_at) VALUES ('Deleted Contact', now())`);

      const counts = await getTrashCount(pool);
      expect(counts.workItems).toBe(2);
      expect(counts.contacts).toBe(1);
      expect(counts.total).toBe(3);
    });
  });

  describe('isDeleted', () => {
    it('returns true for deleted work item', async () => {
      const result = await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Deleted', now()) RETURNING id::text`);
      const id = result.rows[0].id;

      expect(await isDeleted(pool, 'work_item', id)).toBe(true);
    });

    it('returns false for active work item', async () => {
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Active') RETURNING id::text`);
      const id = result.rows[0].id;

      expect(await isDeleted(pool, 'work_item', id)).toBe(false);
    });

    it('returns false for non-existent entity', async () => {
      expect(await isDeleted(pool, 'work_item', '00000000-0000-0000-0000-000000000000')).toBe(false);
    });
  });

  describe('purgeOldItems', () => {
    it('purges items older than retention days', async () => {
      // Create items deleted 40 days ago
      await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Old Task', now() - INTERVAL '40 days')`);
      await pool.query(`INSERT INTO contact (display_name, deleted_at) VALUES ('Old Contact', now() - INTERVAL '40 days')`);
      // Create recently deleted item
      await pool.query(`INSERT INTO work_item (title, deleted_at) VALUES ('Recent Task', now())`);

      const result = await purgeOldItems(pool, 30);
      expect(result.work_items_purged).toBe(1);
      expect(result.contacts_purged).toBe(1);
      expect(result.total_purged).toBe(2);

      // Verify recent item still exists
      const check = await pool.query(`SELECT COUNT(*) FROM work_item WHERE deleted_at IS NOT NULL`);
      expect(parseInt(check.rows[0].count, 10)).toBe(1);
    });
  });
});
