import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

/**
 * Tests for skill_store_item migration (issue #795).
 *
 * Covers:
 * - Table creation with all columns and correct types
 * - Enum type: skill_store_item_status
 * - Unique constraint on (skill_id, collection, key) excluding soft-deleted
 * - CHECK constraint on data JSONB size (1MB max)
 * - Triggers: search_vector auto-update, updated_at auto-update
 * - Soft delete behavior
 * - pgcron jobs: TTL cleanup, soft-delete purge
 * - Indexes existence
 */
describe('Skill Store Item Migration (Issue #795)', () => {
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

  describe('Table structure', () => {
    it('creates skill_store_item table', async () => {
      const result = await pool.query(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename = 'skill_store_item'`
      );
      expect(result.rows).toHaveLength(1);
    });

    it('has all required columns with correct types', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = 'skill_store_item'
         ORDER BY ordinal_position`
      );

      const columns = new Map(
        result.rows.map((r) => [r.column_name, r])
      );

      // Core namespacing
      expect(columns.get('id')?.data_type).toBe('uuid');
      expect(columns.get('skill_id')?.is_nullable).toBe('NO');
      expect(columns.get('collection')?.is_nullable).toBe('NO');
      expect(columns.get('key')?.is_nullable).toBe('YES');

      // Content
      expect(columns.has('title')).toBe(true);
      expect(columns.has('summary')).toBe(true);
      expect(columns.has('content')).toBe(true);
      expect(columns.get('data')?.data_type).toBe('jsonb');

      // Media
      expect(columns.has('media_url')).toBe(true);
      expect(columns.has('media_type')).toBe(true);
      expect(columns.has('source_url')).toBe(true);

      // Classification
      expect(columns.has('status')).toBe(true);
      expect(columns.get('tags')?.data_type).toBe('ARRAY');
      expect(columns.has('priority')).toBe(true);

      // Lifecycle
      expect(columns.has('expires_at')).toBe(true);
      expect(columns.has('pinned')).toBe(true);

      // Embeddings
      expect(columns.has('embedding')).toBe(true);
      expect(columns.has('embedding_model')).toBe(true);
      expect(columns.has('embedding_provider')).toBe(true);
      expect(columns.has('embedding_status')).toBe(true);

      // Search
      expect(columns.get('search_vector')?.data_type).toBe('tsvector');

      // Multi-user isolation
      expect(columns.get('user_email')?.is_nullable).toBe('YES');

      // Soft delete
      expect(columns.get('deleted_at')?.is_nullable).toBe('YES');

      // Timestamps
      expect(columns.has('created_at')).toBe(true);
      expect(columns.has('updated_at')).toBe(true);
      expect(columns.has('created_by')).toBe(true);
    });
  });

  describe('Enum type', () => {
    it('creates skill_store_item_status enum with correct values', async () => {
      const result = await pool.query(
        `SELECT enumlabel FROM pg_enum
         JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
         WHERE pg_type.typname = 'skill_store_item_status'
         ORDER BY enumsortorder`
      );

      expect(result.rows.map((r) => r.enumlabel)).toEqual([
        'active',
        'archived',
        'processing',
      ]);
    });

    it('defaults status to active', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id) VALUES ('test-skill')
         RETURNING status::text`
      );
      expect(result.rows[0].status).toBe('active');
    });

    it('rejects invalid status values', async () => {
      await expect(
        pool.query(
          `INSERT INTO skill_store_item (skill_id, status) VALUES ('test', 'invalid')`
        )
      ).rejects.toThrow(/invalid input value for enum skill_store_item_status/);
    });
  });

  describe('Default values', () => {
    it('generates uuid for id', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id) VALUES ('test-skill')
         RETURNING id`
      );
      expect(result.rows[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('defaults collection to _default', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id) VALUES ('test-skill')
         RETURNING collection`
      );
      expect(result.rows[0].collection).toBe('_default');
    });

    it('defaults data to empty JSONB object', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id) VALUES ('test-skill')
         RETURNING data`
      );
      expect(result.rows[0].data).toEqual({});
    });

    it('defaults tags to empty array', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id) VALUES ('test-skill')
         RETURNING tags`
      );
      expect(result.rows[0].tags).toEqual([]);
    });

    it('defaults pinned to false', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id) VALUES ('test-skill')
         RETURNING pinned`
      );
      expect(result.rows[0].pinned).toBe(false);
    });
  });

  describe('Unique constraint (skill_id, collection, key)', () => {
    it('allows duplicate keys when key is NULL', async () => {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection) VALUES ('s1', 'c1')`
      );
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection) VALUES ('s1', 'c1')
         RETURNING id`
      );
      expect(result.rows).toHaveLength(1);
    });

    it('enforces uniqueness when key is set', async () => {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, key) VALUES ('s1', 'c1', 'k1')`
      );
      await expect(
        pool.query(
          `INSERT INTO skill_store_item (skill_id, collection, key) VALUES ('s1', 'c1', 'k1')`
        )
      ).rejects.toThrow(/duplicate key value/);
    });

    it('allows same key in different collections', async () => {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, key) VALUES ('s1', 'c1', 'k1')`
      );
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, key) VALUES ('s1', 'c2', 'k1')
         RETURNING id`
      );
      expect(result.rows).toHaveLength(1);
    });

    it('allows same key in different skills', async () => {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, key) VALUES ('s1', 'c1', 'k1')`
      );
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, key) VALUES ('s2', 'c1', 'k1')
         RETURNING id`
      );
      expect(result.rows).toHaveLength(1);
    });

    it('allows reusing key after soft delete', async () => {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, key) VALUES ('s1', 'c1', 'k1')`
      );

      // Soft delete the item
      await pool.query(
        `UPDATE skill_store_item SET deleted_at = now()
         WHERE skill_id = 's1' AND collection = 'c1' AND key = 'k1'`
      );

      // Should be able to insert the same key again
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, key) VALUES ('s1', 'c1', 'k1')
         RETURNING id`
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('JSONB data size constraint', () => {
    it('accepts data within 1MB limit', async () => {
      const smallData = { key: 'value'.repeat(100) };
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id, data) VALUES ('test-skill', $1)
         RETURNING id`,
        [JSON.stringify(smallData)]
      );
      expect(result.rows).toHaveLength(1);
    });

    it('rejects data exceeding 1MB limit', async () => {
      // Create a JSON string > 1MB
      const largeData = { payload: 'x'.repeat(1048577) };
      await expect(
        pool.query(
          `INSERT INTO skill_store_item (skill_id, data) VALUES ('test-skill', $1)`,
          [JSON.stringify(largeData)]
        )
      ).rejects.toThrow(/skill_store_item_data_size/);
    });
  });

  describe('Search vector trigger', () => {
    it('auto-populates search_vector on insert', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id, title, summary, content)
         VALUES ('test-skill', 'Breaking News', 'Summary of events', 'Full article content here')
         RETURNING search_vector IS NOT NULL as has_vector`
      );
      expect(result.rows[0].has_vector).toBe(true);
    });

    it('weights title as A, summary as B, content as C', async () => {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, title, summary, content)
         VALUES ('test-skill', 'unique_title_word', 'unique_summary_word', 'unique_content_word')`
      );

      // Title (A weight) should rank higher than summary (B) and content (C)
      const result = await pool.query(
        `SELECT ts_rank(search_vector, to_tsquery('unique_title_word')) as title_rank,
                ts_rank(search_vector, to_tsquery('unique_summary_word')) as summary_rank,
                ts_rank(search_vector, to_tsquery('unique_content_word')) as content_rank
         FROM skill_store_item
         WHERE skill_id = 'test-skill'`
      );

      const { title_rank, summary_rank, content_rank } = result.rows[0];
      expect(parseFloat(title_rank)).toBeGreaterThan(parseFloat(summary_rank));
      expect(parseFloat(summary_rank)).toBeGreaterThan(parseFloat(content_rank));
    });

    it('updates search_vector on update', async () => {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, title)
         VALUES ('test-skill', 'original_title')`
      );

      await pool.query(
        `UPDATE skill_store_item SET title = 'updated_title'
         WHERE skill_id = 'test-skill'`
      );

      const result = await pool.query(
        `SELECT search_vector @@ to_tsquery('updated_title') as matches
         FROM skill_store_item WHERE skill_id = 'test-skill'`
      );
      expect(result.rows[0].matches).toBe(true);
    });

    it('supports full-text search queries', async () => {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, title, summary)
         VALUES ('test-skill', 'PostgreSQL Database Guide', 'How to optimize queries')`
      );

      const result = await pool.query(
        `SELECT id FROM skill_store_item
         WHERE search_vector @@ plainto_tsquery('english', 'database optimize')`
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('Updated_at trigger', () => {
    it('auto-updates updated_at on row modification', async () => {
      const insert = await pool.query(
        `INSERT INTO skill_store_item (skill_id, title)
         VALUES ('test-skill', 'Original')
         RETURNING updated_at`
      );
      const originalUpdatedAt = insert.rows[0].updated_at;

      // Small delay to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 50));

      const update = await pool.query(
        `UPDATE skill_store_item SET title = 'Modified'
         WHERE skill_id = 'test-skill'
         RETURNING updated_at`
      );
      const newUpdatedAt = update.rows[0].updated_at;

      expect(new Date(newUpdatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );
    });
  });

  describe('Soft delete', () => {
    it('supports soft delete by setting deleted_at', async () => {
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, key) VALUES ('s1', 'k1')`
      );

      await pool.query(
        `UPDATE skill_store_item SET deleted_at = now()
         WHERE skill_id = 's1' AND key = 'k1'`
      );

      // Soft-deleted items still exist in the table
      const all = await pool.query(
        `SELECT count(*) FROM skill_store_item WHERE skill_id = 's1'`
      );
      expect(parseInt(all.rows[0].count)).toBe(1);

      // But can be filtered out
      const active = await pool.query(
        `SELECT count(*) FROM skill_store_item
         WHERE skill_id = 's1' AND deleted_at IS NULL`
      );
      expect(parseInt(active.rows[0].count)).toBe(0);
    });
  });

  describe('Embedding columns', () => {
    it('accepts embedding_status values', async () => {
      for (const status of ['complete', 'pending', 'failed']) {
        const result = await pool.query(
          `INSERT INTO skill_store_item (skill_id, embedding_status)
           VALUES ('test-' || $1, $1)
           RETURNING embedding_status`,
          [status]
        );
        expect(result.rows[0].embedding_status).toBe(status);
      }
    });

    it('rejects invalid embedding_status', async () => {
      await expect(
        pool.query(
          `INSERT INTO skill_store_item (skill_id, embedding_status) VALUES ('test', 'invalid')`
        )
      ).rejects.toThrow(/embedding_status/);
    });

    it('defaults embedding_status to pending', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_item (skill_id) VALUES ('test-skill')
         RETURNING embedding_status`
      );
      expect(result.rows[0].embedding_status).toBe('pending');
    });
  });

  describe('pgcron jobs', () => {
    it('registers skill_store_cleanup_expired cron job', async () => {
      const result = await pool.query(
        `SELECT jobname, schedule FROM cron.job
         WHERE jobname = 'skill_store_cleanup_expired'`
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schedule).toBe('*/15 * * * *');
    });

    it('registers skill_store_purge_soft_deleted cron job', async () => {
      const result = await pool.query(
        `SELECT jobname, schedule FROM cron.job
         WHERE jobname = 'skill_store_purge_soft_deleted'`
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schedule).toBe('0 3 * * *');
    });

    it('skill_store_cleanup_expired function deletes expired non-pinned items', async () => {
      // Insert expired item
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, key, expires_at)
         VALUES ('s1', 'expired', now() - interval '1 hour')`
      );

      // Insert non-expired item
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, key, expires_at)
         VALUES ('s1', 'valid', now() + interval '1 hour')`
      );

      // Insert pinned expired item (should survive)
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, key, expires_at, pinned)
         VALUES ('s1', 'pinned', now() - interval '1 hour', true)`
      );

      const deleted = await pool.query(
        `SELECT skill_store_cleanup_expired() as count`
      );
      expect(parseInt(deleted.rows[0].count)).toBe(1);

      // Verify: valid + pinned remain, expired is gone
      const remaining = await pool.query(
        `SELECT key FROM skill_store_item WHERE skill_id = 's1' ORDER BY key`
      );
      expect(remaining.rows.map((r) => r.key)).toEqual(['pinned', 'valid']);
    });

    it('skill_store_purge_soft_deleted function removes old soft-deleted items', async () => {
      // Insert item soft-deleted more than 30 days ago
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, key, deleted_at)
         VALUES ('s1', 'old-deleted', now() - interval '31 days')`
      );

      // Insert item soft-deleted recently (should survive)
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, key, deleted_at)
         VALUES ('s1', 'recent-deleted', now() - interval '1 day')`
      );

      // Insert active item
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, key)
         VALUES ('s1', 'active')`
      );

      const purged = await pool.query(
        `SELECT skill_store_purge_soft_deleted() as count`
      );
      expect(parseInt(purged.rows[0].count)).toBe(1);

      // Verify: active + recent-deleted remain, old-deleted is gone
      const remaining = await pool.query(
        `SELECT key FROM skill_store_item WHERE skill_id = 's1' ORDER BY key`
      );
      expect(remaining.rows.map((r) => r.key)).toEqual(['active', 'recent-deleted']);
    });
  });

  describe('Indexes', () => {
    it('has all required indexes', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'skill_store_item'
         ORDER BY indexname`
      );

      const indexNames = result.rows.map((r) => r.indexname);

      expect(indexNames).toContain('idx_skill_store_item_skill_collection_key');
      expect(indexNames).toContain('idx_skill_store_item_skill_collection');
      expect(indexNames).toContain('idx_skill_store_item_skill_key');
      expect(indexNames).toContain('idx_skill_store_item_status');
      expect(indexNames).toContain('idx_skill_store_item_expires');
      expect(indexNames).toContain('idx_skill_store_item_tags');
      expect(indexNames).toContain('idx_skill_store_item_data');
      expect(indexNames).toContain('idx_skill_store_item_created_at');
      expect(indexNames).toContain('idx_skill_store_item_priority');
      expect(indexNames).toContain('idx_skill_store_item_search_vector');
      expect(indexNames).toContain('idx_skill_store_item_embedding');
      expect(indexNames).toContain('idx_skill_store_item_embedding_status');
      expect(indexNames).toContain('idx_skill_store_item_user_email');
      expect(indexNames).toContain('idx_skill_store_item_deleted_at');
    });
  });

  describe('Multi-user isolation', () => {
    it('allows items with and without user_email', async () => {
      // Shared item (no user)
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, key, title)
         VALUES ('news-skill', 'shared-config', 'Shared Config')`
      );

      // User-scoped item
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, key, title, user_email)
         VALUES ('news-skill', 'user-pref', 'User Preferences', 'alice@example.com')`
      );

      const shared = await pool.query(
        `SELECT count(*) FROM skill_store_item
         WHERE skill_id = 'news-skill' AND user_email IS NULL`
      );
      expect(parseInt(shared.rows[0].count)).toBe(1);

      const userScoped = await pool.query(
        `SELECT count(*) FROM skill_store_item
         WHERE skill_id = 'news-skill' AND user_email = 'alice@example.com'`
      );
      expect(parseInt(userScoped.rows[0].count)).toBe(1);
    });
  });

  describe('Upsert via ON CONFLICT', () => {
    it('supports upsert on (skill_id, collection, key)', async () => {
      // Initial insert
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, key, title, data)
         VALUES ('s1', 'config', 'settings', 'v1', '{"version": 1}'::jsonb)
         ON CONFLICT (skill_id, collection, key) WHERE key IS NOT NULL AND deleted_at IS NULL
         DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data`
      );

      // Upsert
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, key, title, data)
         VALUES ('s1', 'config', 'settings', 'v2', '{"version": 2}'::jsonb)
         ON CONFLICT (skill_id, collection, key) WHERE key IS NOT NULL AND deleted_at IS NULL
         DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data`
      );

      const result = await pool.query(
        `SELECT title, data FROM skill_store_item
         WHERE skill_id = 's1' AND collection = 'config' AND key = 'settings'`
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].title).toBe('v2');
      expect(result.rows[0].data).toEqual({ version: 2 });
    });
  });
});
