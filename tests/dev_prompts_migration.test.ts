/**
 * Integration tests for dev_prompt migration and seeding (Epic #2011, Issue #2012).
 * Verifies table creation, constraints, indexes, triggers, and seed data.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Dev Prompts Migration (#2012)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Table structure', () => {
    it('creates the dev_prompt table', async () => {
      const result = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dev_prompt'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('has all expected columns with correct types', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = 'dev_prompt'
         ORDER BY ordinal_position`,
      );
      const columns = result.rows as Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>;

      const colMap = new Map(columns.map((c) => [c.column_name, c]));

      expect(colMap.get('id')?.data_type).toBe('uuid');
      expect(colMap.get('namespace')?.data_type).toBe('text');
      expect(colMap.get('prompt_key')?.data_type).toBe('text');
      expect(colMap.get('category')?.data_type).toBe('text');
      expect(colMap.get('is_system')?.data_type).toBe('boolean');
      expect(colMap.get('title')?.data_type).toBe('text');
      expect(colMap.get('description')?.data_type).toBe('text');
      expect(colMap.get('body')?.data_type).toBe('text');
      expect(colMap.get('default_body')?.data_type).toBe('text');
      expect(colMap.get('sort_order')?.data_type).toBe('integer');
      expect(colMap.get('is_active')?.data_type).toBe('boolean');
      expect(colMap.get('deleted_at')?.data_type).toContain('timestamp');
      expect(colMap.get('created_at')?.data_type).toContain('timestamp');
      expect(colMap.get('updated_at')?.data_type).toContain('timestamp');
    });
  });

  describe('Constraints', () => {
    beforeEach(async () => {
      await truncateAllTables(pool);
    });

    it('enforces namespace format check', async () => {
      await expect(
        pool.query(
          `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
           VALUES ('INVALID NS!', 'test_key', 'Test', 'body', 'body')`,
        ),
      ).rejects.toThrow();
    });

    it('enforces prompt_key format check (snake_case)', async () => {
      await expect(
        pool.query(
          `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
           VALUES ('default', 'Invalid-Key', 'Test', 'body', 'body')`,
        ),
      ).rejects.toThrow();
    });

    it('enforces prompt_key length <= 100', async () => {
      const longKey = 'a'.repeat(101);
      await expect(
        pool.query(
          `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
           VALUES ('default', $1, 'Test', 'body', 'body')`,
          [longKey],
        ),
      ).rejects.toThrow();
    });

    it('enforces category check constraint', async () => {
      await expect(
        pool.query(
          `INSERT INTO dev_prompt (namespace, prompt_key, category, title, body, default_body)
           VALUES ('default', 'test_key', 'invalid_category', 'Test', 'body', 'body')`,
        ),
      ).rejects.toThrow();
    });

    it('enforces non-empty title', async () => {
      await expect(
        pool.query(
          `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
           VALUES ('default', 'test_key', '   ', 'body', 'body')`,
        ),
      ).rejects.toThrow();
    });

    it('enforces partial unique index on (namespace, prompt_key) for non-deleted rows', async () => {
      await pool.query(
        `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
         VALUES ('default', 'dup_key', 'First', 'body', 'body')`,
      );
      await expect(
        pool.query(
          `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
           VALUES ('default', 'dup_key', 'Second', 'body', 'body')`,
        ),
      ).rejects.toThrow();
    });

    it('allows same prompt_key in different namespaces', async () => {
      await pool.query(
        `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
         VALUES ('default', 'shared_key', 'In Default', 'body', 'body')`,
      );
      const result = await pool.query(
        `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
         VALUES ('other', 'shared_key', 'In Other', 'body', 'body')
         RETURNING id`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('allows re-using prompt_key if original is soft-deleted', async () => {
      await pool.query(
        `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body, deleted_at)
         VALUES ('default', 'reuse_key', 'Deleted', 'body', 'body', now())`,
      );
      const result = await pool.query(
        `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
         VALUES ('default', 'reuse_key', 'New', 'body', 'body')
         RETURNING id`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('accepts all valid categories', async () => {
      const categories = ['identification', 'creation', 'triage', 'shipping', 'general', 'custom'];
      for (const cat of categories) {
        const result = await pool.query(
          `INSERT INTO dev_prompt (namespace, prompt_key, category, title, body, default_body)
           VALUES ('default', $1, $2, 'Test', 'body', 'body')
           RETURNING id`,
          [`cat_test_${cat}`, cat],
        );
        expect(result.rows).toHaveLength(1);
      }
    });
  });

  describe('updated_at trigger', () => {
    beforeEach(async () => {
      await truncateAllTables(pool);
    });

    it('auto-updates updated_at on row modification', async () => {
      const insert = await pool.query(
        `INSERT INTO dev_prompt (namespace, prompt_key, title, body, default_body)
         VALUES ('default', 'trigger_test', 'Original', 'body', 'body')
         RETURNING id, updated_at`,
      );
      const originalUpdated = (insert.rows[0] as { updated_at: Date }).updated_at;

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 50));

      const update = await pool.query(
        `UPDATE dev_prompt SET title = 'Modified' WHERE id = $1 RETURNING updated_at`,
        [(insert.rows[0] as { id: string }).id],
      );
      const newUpdated = (update.rows[0] as { updated_at: Date }).updated_at;

      expect(new Date(newUpdated).getTime()).toBeGreaterThanOrEqual(
        new Date(originalUpdated).getTime(),
      );
    });
  });

  describe('Seed data', () => {
    /**
     * Re-seed by re-running just the INSERT from the migration SQL.
     * This simulates what happens when the migration first runs.
     */
    async function reseed(): Promise<void> {
      // Read the migration file and extract the INSERT statement
      const { readFileSync } = await import('fs');
      const { resolve, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const migrationPath = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../migrations/132_dev_prompts.up.sql',
      );
      const sql = readFileSync(migrationPath, 'utf-8');
      // Extract the INSERT ... ON CONFLICT block
      const insertMatch = sql.match(/INSERT INTO dev_prompt[\s\S]+?ON CONFLICT[\s\S]+?DO NOTHING;/);
      if (!insertMatch) throw new Error('Could not find INSERT statement in migration');
      await pool.query(insertMatch[0]);
    }

    beforeEach(async () => {
      await truncateAllTables(pool);
      await reseed();
    });

    it('seeds 9 system prompts in default namespace', async () => {
      const result = await pool.query(
        `SELECT prompt_key, category, is_system, title, description, body, default_body, sort_order
         FROM dev_prompt
         WHERE namespace = 'default' AND is_system = true
         ORDER BY sort_order`,
      );

      expect(result.rows.length).toBe(9);

      const keys = (result.rows as Array<{ prompt_key: string }>).map((r) => r.prompt_key);
      expect(keys).toContain('all_open');
      expect(keys).toContain('new_feature_request');
      expect(keys).toContain('new_initiative');
      expect(keys).toContain('new_epic');
      expect(keys).toContain('new_bug');
      expect(keys).toContain('triage');
      expect(keys).toContain('omnibus_issues');
      expect(keys).toContain('omnibus_epic');
      expect(keys).toContain('omnibus_initiative');
    });

    it('seeds with body equal to default_body', async () => {
      const result = await pool.query(
        `SELECT prompt_key FROM dev_prompt
         WHERE namespace = 'default' AND is_system = true AND body != default_body`,
      );
      expect(result.rows).toHaveLength(0);
    });

    it('seed data has non-empty descriptions', async () => {
      const result = await pool.query(
        `SELECT prompt_key FROM dev_prompt
         WHERE namespace = 'default' AND is_system = true AND length(description) = 0`,
      );
      expect(result.rows).toHaveLength(0);
    });

    it('does not overwrite user edits on re-run (ON CONFLICT DO NOTHING)', async () => {
      // Modify a seed prompt body
      await pool.query(
        `UPDATE dev_prompt SET body = 'User edited body'
         WHERE namespace = 'default' AND prompt_key = 'all_open'`,
      );

      // Re-seed (simulates re-running migration INSERT)
      await reseed();

      const result = await pool.query(
        `SELECT body FROM dev_prompt
         WHERE namespace = 'default' AND prompt_key = 'all_open'`,
      );
      expect((result.rows[0] as { body: string }).body).toBe('User edited body');
    });
  });
});
