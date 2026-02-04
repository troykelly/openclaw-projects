import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Work Item Labels (Issue #221)', () => {
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

  describe('Label normalization', () => {
    it('normalizes labels to lowercase', async () => {
      const result = await pool.query(`SELECT normalize_label_name('SHOPPING')`);
      expect(result.rows[0].normalize_label_name).toBe('shopping');
    });

    it('trims whitespace', async () => {
      const result = await pool.query(`SELECT normalize_label_name('  @home  ')`);
      expect(result.rows[0].normalize_label_name).toBe('@home');
    });

    it('replaces spaces with hyphens', async () => {
      const result = await pool.query(`SELECT normalize_label_name('grocery list')`);
      expect(result.rows[0].normalize_label_name).toBe('grocery-list');
    });

    it('handles multiple spaces', async () => {
      const result = await pool.query(`SELECT normalize_label_name('my  important   task')`);
      expect(result.rows[0].normalize_label_name).toBe('my-important-task');
    });
  });

  describe('Label table', () => {
    it('creates labels with auto-normalized name', async () => {
      const result = await pool.query(
        `INSERT INTO label (name) VALUES ('Shopping') RETURNING name, normalized_name`
      );
      expect(result.rows[0].name).toBe('Shopping');
      expect(result.rows[0].normalized_name).toBe('shopping');
    });

    it('enforces unique normalized names', async () => {
      await pool.query(`INSERT INTO label (name) VALUES ('Shopping')`);
      await expect(
        pool.query(`INSERT INTO label (name) VALUES ('SHOPPING')`)
      ).rejects.toThrow(/unique|duplicate/i);
    });

    it('supports color and description', async () => {
      const result = await pool.query(
        `INSERT INTO label (name, color, description)
         VALUES ('@home', '#ff5733', 'Tasks to do at home')
         RETURNING color, description`
      );
      expect(result.rows[0].color).toBe('#ff5733');
      expect(result.rows[0].description).toBe('Tasks to do at home');
    });
  });

  describe('get_or_create_label function', () => {
    it('creates new label when not exists', async () => {
      const result = await pool.query(`SELECT get_or_create_label('New Label')`);
      expect(result.rows[0].get_or_create_label).toBeDefined();

      const labels = await pool.query(`SELECT * FROM label WHERE normalized_name = 'new-label'`);
      expect(labels.rows).toHaveLength(1);
    });

    it('returns existing label when exists', async () => {
      // Create first
      const first = await pool.query(`SELECT get_or_create_label('Existing')`);
      // Get again
      const second = await pool.query(`SELECT get_or_create_label('EXISTING')`);

      expect(first.rows[0].get_or_create_label).toBe(second.rows[0].get_or_create_label);

      // Should still only have one label
      const labels = await pool.query(`SELECT * FROM label WHERE normalized_name = 'existing'`);
      expect(labels.rows).toHaveLength(1);
    });
  });

  describe('set_work_item_labels function', () => {
    it('sets multiple labels on a work item', async () => {
      const wiResult = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Labeled Task') RETURNING id::text as id`
      );
      const workItemId = wiResult.rows[0].id;

      await pool.query(
        `SELECT set_work_item_labels($1, ARRAY['@home', '@phone', 'urgent'])`,
        [workItemId]
      );

      const labels = await pool.query(
        `SELECT l.normalized_name
         FROM work_item_label wl
         JOIN label l ON l.id = wl.label_id
         WHERE wl.work_item_id = $1
         ORDER BY l.normalized_name`,
        [workItemId]
      );

      expect(labels.rows.map((r) => r.normalized_name)).toEqual(['@home', '@phone', 'urgent']);
    });

    it('replaces existing labels', async () => {
      const wiResult = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Replace Labels') RETURNING id::text as id`
      );
      const workItemId = wiResult.rows[0].id;

      // Set initial labels
      await pool.query(
        `SELECT set_work_item_labels($1, ARRAY['old-label', 'keep-label'])`,
        [workItemId]
      );

      // Replace with new labels
      await pool.query(
        `SELECT set_work_item_labels($1, ARRAY['keep-label', 'new-label'])`,
        [workItemId]
      );

      const labels = await pool.query(
        `SELECT l.normalized_name
         FROM work_item_label wl
         JOIN label l ON l.id = wl.label_id
         WHERE wl.work_item_id = $1
         ORDER BY l.normalized_name`,
        [workItemId]
      );

      expect(labels.rows.map((r) => r.normalized_name)).toEqual(['keep-label', 'new-label']);
    });

    it('clears labels when passed empty array', async () => {
      const wiResult = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Clear Labels') RETURNING id::text as id`
      );
      const workItemId = wiResult.rows[0].id;

      await pool.query(
        `SELECT set_work_item_labels($1, ARRAY['label1', 'label2'])`,
        [workItemId]
      );

      await pool.query(
        `SELECT set_work_item_labels($1, ARRAY[]::text[])`,
        [workItemId]
      );

      const labels = await pool.query(
        `SELECT COUNT(*) as count FROM work_item_label WHERE work_item_id = $1`,
        [workItemId]
      );

      expect(parseInt(labels.rows[0].count, 10)).toBe(0);
    });
  });

  describe('add_work_item_label function', () => {
    it('adds a single label', async () => {
      const wiResult = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Add Single') RETURNING id::text as id`
      );
      const workItemId = wiResult.rows[0].id;

      await pool.query(`SELECT add_work_item_label($1, '@errands')`, [workItemId]);

      const labels = await pool.query(
        `SELECT l.normalized_name
         FROM work_item_label wl
         JOIN label l ON l.id = wl.label_id
         WHERE wl.work_item_id = $1`,
        [workItemId]
      );

      expect(labels.rows[0].normalized_name).toBe('@errands');
    });

    it('does not duplicate labels', async () => {
      const wiResult = await pool.query(
        `INSERT INTO work_item (title) VALUES ('No Duplicate') RETURNING id::text as id`
      );
      const workItemId = wiResult.rows[0].id;

      await pool.query(`SELECT add_work_item_label($1, 'test')`, [workItemId]);
      await pool.query(`SELECT add_work_item_label($1, 'TEST')`, [workItemId]);

      const labels = await pool.query(
        `SELECT COUNT(*) as count FROM work_item_label WHERE work_item_id = $1`,
        [workItemId]
      );

      expect(parseInt(labels.rows[0].count, 10)).toBe(1);
    });
  });

  describe('remove_work_item_label function', () => {
    it('removes a label from work item', async () => {
      const wiResult = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Remove Label') RETURNING id::text as id`
      );
      const workItemId = wiResult.rows[0].id;

      await pool.query(
        `SELECT set_work_item_labels($1, ARRAY['keep', 'remove'])`,
        [workItemId]
      );

      await pool.query(`SELECT remove_work_item_label($1, 'remove')`, [workItemId]);

      const labels = await pool.query(
        `SELECT l.normalized_name
         FROM work_item_label wl
         JOIN label l ON l.id = wl.label_id
         WHERE wl.work_item_id = $1`,
        [workItemId]
      );

      expect(labels.rows.map((r) => r.normalized_name)).toEqual(['keep']);
    });

    it('handles case-insensitive removal', async () => {
      const wiResult = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Case Remove') RETURNING id::text as id`
      );
      const workItemId = wiResult.rows[0].id;

      await pool.query(`SELECT add_work_item_label($1, 'CamelCase')`, [workItemId]);
      await pool.query(`SELECT remove_work_item_label($1, 'camelcase')`, [workItemId]);

      const labels = await pool.query(
        `SELECT COUNT(*) as count FROM work_item_label WHERE work_item_id = $1`,
        [workItemId]
      );

      expect(parseInt(labels.rows[0].count, 10)).toBe(0);
    });
  });

  describe('Work item cascade delete', () => {
    it('removes label associations when work item is deleted', async () => {
      const wiResult = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Cascade Delete') RETURNING id::text as id`
      );
      const workItemId = wiResult.rows[0].id;

      await pool.query(
        `SELECT set_work_item_labels($1, ARRAY['cascade-test'])`,
        [workItemId]
      );

      await pool.query(`DELETE FROM work_item WHERE id = $1`, [workItemId]);

      const associations = await pool.query(
        `SELECT COUNT(*) as count FROM work_item_label WHERE work_item_id = $1`,
        [workItemId]
      );

      expect(parseInt(associations.rows[0].count, 10)).toBe(0);

      // Label should still exist
      const labels = await pool.query(
        `SELECT COUNT(*) as count FROM label WHERE normalized_name = 'cascade-test'`
      );
      expect(parseInt(labels.rows[0].count, 10)).toBe(1);
    });
  });

  describe('Label cascade delete', () => {
    it('removes associations when label is deleted', async () => {
      const wiResult = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Label Delete') RETURNING id::text as id`
      );
      const workItemId = wiResult.rows[0].id;

      await pool.query(`SELECT add_work_item_label($1, 'deleteme')`, [workItemId]);

      const labelResult = await pool.query(
        `SELECT id FROM label WHERE normalized_name = 'deleteme'`
      );
      const labelId = labelResult.rows[0].id;

      await pool.query(`DELETE FROM label WHERE id = $1`, [labelId]);

      const associations = await pool.query(
        `SELECT COUNT(*) as count FROM work_item_label WHERE label_id = $1`,
        [labelId]
      );

      expect(parseInt(associations.rows[0].count, 10)).toBe(0);
    });
  });

  describe('Querying work items by labels', () => {
    it('filters work items by single label', async () => {
      // Create work items with labels
      const wi1 = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Home Task') RETURNING id::text as id`
      );
      const wi2 = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Work Task') RETURNING id::text as id`
      );
      const wi3 = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Home and Work') RETURNING id::text as id`
      );

      await pool.query(`SELECT add_work_item_label($1, '@home')`, [wi1.rows[0].id]);
      await pool.query(`SELECT add_work_item_label($1, '@work')`, [wi2.rows[0].id]);
      await pool.query(`SELECT add_work_item_label($1, '@home')`, [wi3.rows[0].id]);
      await pool.query(`SELECT add_work_item_label($1, '@work')`, [wi3.rows[0].id]);

      // Query for @home items
      const homeItems = await pool.query(
        `SELECT wi.title
         FROM work_item wi
         JOIN work_item_label wl ON wl.work_item_id = wi.id
         JOIN label l ON l.id = wl.label_id
         WHERE l.normalized_name = '@home'
         ORDER BY wi.title`
      );

      expect(homeItems.rows.map((r) => r.title).sort()).toEqual(['Home Task', 'Home and Work'].sort());
    });

    it('filters work items by multiple labels (AND)', async () => {
      const wi1 = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Single Label') RETURNING id::text as id`
      );
      const wi2 = await pool.query(
        `INSERT INTO work_item (title) VALUES ('Both Labels') RETURNING id::text as id`
      );

      await pool.query(`SELECT add_work_item_label($1, 'urgent')`, [wi1.rows[0].id]);
      await pool.query(`SELECT add_work_item_label($1, 'urgent')`, [wi2.rows[0].id]);
      await pool.query(`SELECT add_work_item_label($1, 'important')`, [wi2.rows[0].id]);

      // Query for items with BOTH urgent AND important
      const bothItems = await pool.query(
        `SELECT wi.title
         FROM work_item wi
         WHERE EXISTS (
           SELECT 1 FROM work_item_label wl
           JOIN label l ON l.id = wl.label_id
           WHERE wl.work_item_id = wi.id AND l.normalized_name = 'urgent'
         )
         AND EXISTS (
           SELECT 1 FROM work_item_label wl
           JOIN label l ON l.id = wl.label_id
           WHERE wl.work_item_id = wi.id AND l.normalized_name = 'important'
         )`
      );

      expect(bothItems.rows.map((r) => r.title)).toEqual(['Both Labels']);
    });
  });

  describe('Label usage counts', () => {
    it('can count work items per label', async () => {
      const wi1 = await pool.query(
        `INSERT INTO work_item (title) VALUES ('WI 1') RETURNING id::text as id`
      );
      const wi2 = await pool.query(
        `INSERT INTO work_item (title) VALUES ('WI 2') RETURNING id::text as id`
      );
      const wi3 = await pool.query(
        `INSERT INTO work_item (title) VALUES ('WI 3') RETURNING id::text as id`
      );

      await pool.query(`SELECT add_work_item_label($1, 'popular')`, [wi1.rows[0].id]);
      await pool.query(`SELECT add_work_item_label($1, 'popular')`, [wi2.rows[0].id]);
      await pool.query(`SELECT add_work_item_label($1, 'popular')`, [wi3.rows[0].id]);
      await pool.query(`SELECT add_work_item_label($1, 'rare')`, [wi1.rows[0].id]);

      const counts = await pool.query(
        `SELECT l.name, l.normalized_name, COUNT(wl.work_item_id) as count
         FROM label l
         LEFT JOIN work_item_label wl ON wl.label_id = l.id
         GROUP BY l.id, l.name, l.normalized_name
         ORDER BY count DESC, l.normalized_name`
      );

      expect(counts.rows[0].normalized_name).toBe('popular');
      expect(parseInt(counts.rows[0].count, 10)).toBe(3);
      expect(counts.rows[1].normalized_name).toBe('rare');
      expect(parseInt(counts.rows[1].count, 10)).toBe(1);
    });
  });
});
