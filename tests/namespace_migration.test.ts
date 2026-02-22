import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createTestPool } from './helpers/db.ts';

/**
 * Tests for migration 090_namespace_scoping.
 * Verifies: namespace_grant table, namespace columns on entity tables,
 * CHECK constraints, and indexes.
 *
 * NOTE: These tests run AFTER all migrations have been applied (by test setup),
 * so they verify the final state rather than applying the migration themselves.
 */
describe('Namespace Scoping Migration (#1429)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('namespace_grant table', () => {
    it('exists with correct columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'namespace_grant'
        ORDER BY ordinal_position
      `);
      const cols = result.rows.map((r: Record<string, string>) => r.column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('email');
      expect(cols).toContain('namespace');
      expect(cols).toContain('access');
      expect(cols).toContain('is_home');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });

    it('has FK constraint to user_setting(email)', async () => {
      const result = await pool.query(`
        SELECT tc.constraint_type, ccu.table_name AS referenced_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'namespace_grant'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND ccu.column_name = 'email'
      `);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].referenced_table).toBe('user_setting');
    });

    it('has unique constraint on (email, namespace)', async () => {
      const result = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'namespace_grant'
          AND constraint_type = 'UNIQUE'
      `);
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('enforces namespace naming pattern CHECK constraint', async () => {
      // Create a test user first
      const testEmail = `ns-check-test-${Date.now()}@test.com`;
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`,
        [testEmail],
      );

      // Valid namespace should work
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'valid-ns-1', 'read')`,
        [testEmail],
      );

      // Invalid namespace (starts with hyphen) should fail
      await expect(
        pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, '-invalid', 'read')`,
          [testEmail],
        ),
      ).rejects.toThrow();

      // Invalid namespace (uppercase) should fail
      await expect(
        pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'UPPER', 'read')`,
          [testEmail],
        ),
      ).rejects.toThrow();

      // Cleanup
      await pool.query(`DELETE FROM namespace_grant WHERE email = $1`, [testEmail]);
      await pool.query(`DELETE FROM user_setting WHERE email = $1`, [testEmail]);
    });

    it('enforces access CHECK constraint', async () => {
      const testEmail = `ns-access-test-${Date.now()}@test.com`;
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`,
        [testEmail],
      );

      // Valid access levels should work
      for (const access of ['read', 'readwrite']) {
        const ns = `access-test-${access}`;
        await pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, $2, $3)`,
          [testEmail, ns, access],
        );
      }

      // Invalid access should fail
      await expect(
        pool.query(
          `INSERT INTO namespace_grant (email, namespace, access) VALUES ($1, 'access-invalid', 'superuser')`,
          [testEmail],
        ),
      ).rejects.toThrow();

      // Cleanup
      await pool.query(`DELETE FROM namespace_grant WHERE email = $1`, [testEmail]);
      await pool.query(`DELETE FROM user_setting WHERE email = $1`, [testEmail]);
    });

    it('enforces at most one is_home=true per user', async () => {
      const testEmail = `ns-home-test-${Date.now()}@test.com`;
      await pool.query(
        `INSERT INTO user_setting (email) VALUES ($1) ON CONFLICT DO NOTHING`,
        [testEmail],
      );

      // First home should work
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'home-test-1', 'readwrite', true)`,
        [testEmail],
      );

      // Second home should fail (unique partial index)
      await expect(
        pool.query(
          `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'home-test-2', 'read', true)`,
          [testEmail],
        ),
      ).rejects.toThrow();

      // Non-home should work fine
      await pool.query(
        `INSERT INTO namespace_grant (email, namespace, access, is_home) VALUES ($1, 'home-test-3', 'read', false)`,
        [testEmail],
      );

      // Cleanup
      await pool.query(`DELETE FROM namespace_grant WHERE email = $1`, [testEmail]);
      await pool.query(`DELETE FROM user_setting WHERE email = $1`, [testEmail]);
    });
  });

  describe('namespace columns on entity tables', () => {
    const entityTables = [
      'work_item', 'memory', 'contact', 'contact_endpoint', 'relationship',
      'external_thread', 'external_message', 'notebook', 'note', 'notification',
      'list', 'recipe', 'meal_log', 'pantry_item', 'entity_link', 'context',
      'file_attachment', 'file_share', 'skill_store_item',
    ];

    for (const table of entityTables) {
      it(`${table} has namespace column with NOT NULL and default 'default'`, async () => {
        const result = await pool.query(`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = $1 AND column_name = 'namespace'
        `, [table]);

        expect(result.rows.length).toBe(1);
        expect(result.rows[0].data_type).toBe('text');
        expect(result.rows[0].is_nullable).toBe('NO');
        expect(result.rows[0].column_default).toContain('default');
      });
    }

    it('namespace CHECK constraint enforces valid names on work_item', async () => {
      // Try inserting a work_item with an invalid namespace
      await expect(
        pool.query(`
          INSERT INTO work_item (id, title, kind, namespace)
          VALUES (gen_random_uuid(), 'test', 'task', '-invalid-ns')
        `),
      ).rejects.toThrow();
    });
  });

  describe('namespace indexes', () => {
    const expectedIndexes = [
      'idx_work_item_namespace', 'idx_memory_namespace', 'idx_contact_namespace',
      'idx_contact_endpoint_namespace', 'idx_relationship_namespace',
      'idx_external_thread_namespace', 'idx_external_message_namespace',
      'idx_notebook_namespace', 'idx_note_namespace', 'idx_notification_namespace',
      'idx_list_namespace', 'idx_recipe_namespace', 'idx_meal_log_namespace',
      'idx_pantry_item_namespace', 'idx_entity_link_namespace',
      'idx_context_namespace', 'idx_file_attachment_namespace',
      'idx_file_share_namespace', 'idx_skill_store_item_namespace',
    ];

    it('all namespace indexes exist', async () => {
      const result = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE indexname = ANY($1::text[])
      `, [expectedIndexes]);

      const foundIndexes = result.rows.map((r: Record<string, string>) => r.indexname);
      for (const idx of expectedIndexes) {
        expect(foundIndexes).toContain(idx);
      }
    });
  });
});
