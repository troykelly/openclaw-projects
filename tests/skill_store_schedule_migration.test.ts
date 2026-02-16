import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

/**
 * Tests for skill_store_schedule migration (issue #796).
 *
 * Covers:
 * - Table creation with all columns and correct types
 * - Unique constraint on (skill_id, collection, cron_expression)
 * - Cron frequency validation (reject < 5 minutes)
 * - Job enqueue function with idempotency and overlap prevention
 * - pgcron job registration
 * - Updated_at trigger
 */
describe('Skill Store Schedule Migration (Issue #796)', () => {
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
    it('creates skill_store_schedule table', async () => {
      const result = await pool.query(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename = 'skill_store_schedule'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('has all required columns with correct types', async () => {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_name = 'skill_store_schedule'
         ORDER BY ordinal_position`,
      );

      const columns = new Map(result.rows.map((r) => [r.column_name, r]));

      expect(columns.get('id')?.data_type).toBe('uuid');
      expect(columns.get('skill_id')?.is_nullable).toBe('NO');
      expect(columns.get('collection')?.is_nullable).toBe('YES');
      expect(columns.get('cron_expression')?.is_nullable).toBe('NO');
      expect(columns.get('timezone')?.is_nullable).toBe('NO');
      expect(columns.get('webhook_url')?.is_nullable).toBe('NO');
      expect(columns.get('webhook_headers')?.data_type).toBe('jsonb');
      expect(columns.get('payload_template')?.data_type).toBe('jsonb');
      expect(columns.get('enabled')?.is_nullable).toBe('NO');
      expect(columns.get('max_retries')?.is_nullable).toBe('NO');
      expect(columns.get('last_run_status')?.is_nullable).toBe('YES');
      expect(columns.has('last_run_at')).toBe(true);
      expect(columns.has('next_run_at')).toBe(true);
      expect(columns.has('created_at')).toBe(true);
      expect(columns.has('updated_at')).toBe(true);
    });
  });

  describe('Default values', () => {
    it('defaults timezone to UTC', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook')
         RETURNING timezone`,
      );
      expect(result.rows[0].timezone).toBe('UTC');
    });

    it('defaults enabled to true', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook')
         RETURNING enabled`,
      );
      expect(result.rows[0].enabled).toBe(true);
    });

    it('defaults max_retries to 5', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook')
         RETURNING max_retries`,
      );
      expect(result.rows[0].max_retries).toBe(5);
    });

    it('defaults webhook_headers and payload_template to empty objects', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook')
         RETURNING webhook_headers, payload_template`,
      );
      expect(result.rows[0].webhook_headers).toEqual({});
      expect(result.rows[0].payload_template).toEqual({});
    });
  });

  describe('Unique constraint', () => {
    it('prevents duplicate (skill_id, collection, cron_expression)', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, collection, cron_expression, webhook_url)
         VALUES ('s1', 'articles', '0 9 * * *', 'https://example.com/hook')`,
      );

      await expect(
        pool.query(
          `INSERT INTO skill_store_schedule (skill_id, collection, cron_expression, webhook_url)
           VALUES ('s1', 'articles', '0 9 * * *', 'https://example.com/hook2')`,
        ),
      ).rejects.toThrow(/duplicate key/);
    });

    it('allows same cron in different collections', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, collection, cron_expression, webhook_url)
         VALUES ('s1', 'articles', '0 9 * * *', 'https://example.com/hook')`,
      );

      const result = await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, collection, cron_expression, webhook_url)
         VALUES ('s1', 'newsletters', '0 9 * * *', 'https://example.com/hook')
         RETURNING id`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('handles NULL collection uniqueness correctly', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
         VALUES ('s1', '0 9 * * *', 'https://example.com/hook')`,
      );

      await expect(
        pool.query(
          `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
           VALUES ('s1', '0 9 * * *', 'https://example.com/hook2')`,
        ),
      ).rejects.toThrow(/duplicate key/);
    });
  });

  describe('Cron frequency validation', () => {
    it('allows cron expressions >= 5 minutes', async () => {
      const validExpressions = ['*/5 * * * *', '*/10 * * * *', '0 * * * *', '0 9 * * *', '30 8 * * 1-5', '0 0 1 * *'];

      for (const expr of validExpressions) {
        const result = await pool.query(
          `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
           VALUES ($1, $2, 'https://example.com/hook')
           RETURNING id`,
          [`skill-${expr.replace(/[^a-z0-9]/g, '')}`, expr],
        );
        expect(result.rows).toHaveLength(1);
      }
    });

    it('rejects cron expressions < 5 minutes', async () => {
      const invalidExpressions = ['*/1 * * * *', '*/2 * * * *', '*/3 * * * *', '*/4 * * * *'];

      for (const expr of invalidExpressions) {
        await expect(
          pool.query(
            `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
             VALUES ('test-skill', $1, 'https://example.com/hook')`,
            [expr],
          ),
        ).rejects.toThrow(/fires more frequently than every 5 minutes/);
      }
    });

    it('rejects every-minute cron (* * * * *)', async () => {
      await expect(
        pool.query(
          `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
           VALUES ('test-skill', '* * * * *', 'https://example.com/hook')`,
        ),
      ).rejects.toThrow(/fires every minute/);
    });
  });

  describe('last_run_status constraint', () => {
    it('accepts valid status values', async () => {
      for (const status of ['success', 'failed', 'skipped']) {
        const result = await pool.query(
          `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url, last_run_status)
           VALUES ($1, '0 9 * * *', 'https://example.com/hook', $2)
           RETURNING last_run_status`,
          [`skill-${status}`, status],
        );
        expect(result.rows[0].last_run_status).toBe(status);
      }
    });

    it('rejects invalid status values', async () => {
      await expect(
        pool.query(
          `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url, last_run_status)
           VALUES ('test', '0 9 * * *', 'https://example.com/hook', 'invalid')`,
        ),
      ).rejects.toThrow(/last_run_status/);
    });

    it('allows NULL status (never run or in progress)', async () => {
      const result = await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook')
         RETURNING last_run_status`,
      );
      expect(result.rows[0].last_run_status).toBeNull();
    });
  });

  describe('Updated_at trigger', () => {
    it('auto-updates updated_at on modification', async () => {
      const insert = await pool.query(
        `INSERT INTO skill_store_schedule (skill_id, cron_expression, webhook_url)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook')
         RETURNING id, updated_at`,
      );
      const { id, updated_at: original } = insert.rows[0];

      await new Promise((resolve) => setTimeout(resolve, 50));

      const update = await pool.query(
        `UPDATE skill_store_schedule SET enabled = false WHERE id = $1
         RETURNING updated_at`,
        [id],
      );

      expect(new Date(update.rows[0].updated_at).getTime()).toBeGreaterThan(new Date(original).getTime());
    });
  });

  describe('Job enqueue function', () => {
    it('enqueues jobs for due schedules', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule
         (skill_id, collection, cron_expression, webhook_url, next_run_at)
         VALUES ('news-skill', 'articles', '0 */12 * * *', 'https://example.com/hook',
                 now() - interval '1 minute')`,
      );

      const result = await pool.query(`SELECT enqueue_skill_store_scheduled_jobs() as count`);
      expect(parseInt(result.rows[0].count)).toBe(1);

      const jobs = await pool.query(
        `SELECT kind, payload FROM internal_job
         WHERE kind = 'skill_store.scheduled_process'`,
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0].payload.skill_id).toBe('news-skill');
      expect(jobs.rows[0].payload.collection).toBe('articles');
    });

    it('skips disabled schedules', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule
         (skill_id, cron_expression, webhook_url, enabled, next_run_at)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook', false,
                 now() - interval '1 minute')`,
      );

      const result = await pool.query(`SELECT enqueue_skill_store_scheduled_jobs() as count`);
      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    it('provides idempotency (no duplicate jobs in same minute)', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule
         (skill_id, cron_expression, webhook_url, next_run_at)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook',
                 now() - interval '1 minute')`,
      );

      await pool.query(`SELECT enqueue_skill_store_scheduled_jobs()`);

      await pool.query(
        `UPDATE skill_store_schedule
         SET last_run_at = NULL, last_run_status = 'success'
         WHERE skill_id = 'test-skill'`,
      );

      await pool.query(`SELECT enqueue_skill_store_scheduled_jobs()`);

      const jobs = await pool.query(
        `SELECT count(*) FROM internal_job
         WHERE kind = 'skill_store.scheduled_process'`,
      );
      expect(parseInt(jobs.rows[0].count)).toBe(1);
    });

    it('implements overlap prevention', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule
         (skill_id, cron_expression, webhook_url, last_run_at, last_run_status, next_run_at)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook',
                 now() - interval '5 minutes', NULL,
                 now() - interval '1 minute')`,
      );

      const result = await pool.query(`SELECT enqueue_skill_store_scheduled_jobs() as count`);
      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    it('does not prevent overlap for old runs (> 1 hour)', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule
         (skill_id, cron_expression, webhook_url, last_run_at, last_run_status, next_run_at)
         VALUES ('test-skill', '0 9 * * *', 'https://example.com/hook',
                 now() - interval '2 hours', NULL,
                 now() - interval '1 minute')`,
      );

      const result = await pool.query(`SELECT enqueue_skill_store_scheduled_jobs() as count`);
      expect(parseInt(result.rows[0].count)).toBe(1);
    });

    // Issue #1360: consecutive_failures race condition guard
    it('skips schedules where consecutive_failures >= max_retries', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule
         (skill_id, cron_expression, webhook_url, max_retries, consecutive_failures,
          last_run_status, next_run_at)
         VALUES ('failing-skill', '0 9 * * *', 'https://example.com/hook',
                 3, 3, 'failed', now() - interval '1 minute')`,
      );

      const result = await pool.query(`SELECT enqueue_skill_store_scheduled_jobs() as count`);
      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    it('skips schedules where consecutive_failures exceeds max_retries', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule
         (skill_id, cron_expression, webhook_url, max_retries, consecutive_failures,
          last_run_status, next_run_at)
         VALUES ('very-broken', '0 9 * * *', 'https://example.com/hook',
                 3, 10, 'failed', now() - interval '1 minute')`,
      );

      const result = await pool.query(`SELECT enqueue_skill_store_scheduled_jobs() as count`);
      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    it('still enqueues schedules below max_retries', async () => {
      await pool.query(
        `INSERT INTO skill_store_schedule
         (skill_id, cron_expression, webhook_url, max_retries, consecutive_failures,
          last_run_status, next_run_at)
         VALUES ('recovering-skill', '0 9 * * *', 'https://example.com/hook',
                 5, 2, 'failed', now() - interval '1 minute')`,
      );

      const result = await pool.query(`SELECT enqueue_skill_store_scheduled_jobs() as count`);
      expect(parseInt(result.rows[0].count)).toBe(1);
    });
  });

  describe('pgcron job', () => {
    it('registers skill_store_schedule_enqueue cron job', async () => {
      const result = await pool.query(
        `SELECT jobname, schedule FROM cron.job
         WHERE jobname = 'skill_store_schedule_enqueue'`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].schedule).toBe('*/1 * * * *');
    });
  });

  describe('Indexes', () => {
    it('has all required indexes', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'skill_store_schedule'
         ORDER BY indexname`,
      );

      const indexNames = result.rows.map((r) => r.indexname);

      expect(indexNames).toContain('idx_skill_store_schedule_skill_id');
      expect(indexNames).toContain('idx_skill_store_schedule_enabled');
      expect(indexNames).toContain('idx_skill_store_schedule_next_run');
      expect(indexNames).toContain('idx_skill_store_schedule_unique');
      expect(indexNames).toContain('idx_skill_store_schedule_unique_no_collection');
    });
  });
});
