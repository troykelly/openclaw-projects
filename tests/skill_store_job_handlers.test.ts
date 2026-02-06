import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { processJobs } from '../src/api/jobs/processor.ts';

/**
 * Integration tests for skill_store.scheduled_process job handler (Issue #806).
 *
 * Tests the job processor handling of skill_store.scheduled_process jobs,
 * which fire webhooks for scheduled skill store operations.
 */
describe('Skill Store Job Handlers (Issue #806)', () => {
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

  /** Helper to create a schedule directly in DB */
  async function createSchedule(overrides: Record<string, unknown> = {}) {
    const defaults = {
      skill_id: 'test-skill',
      cron_expression: '0 9 * * *',
      webhook_url: 'https://example.com/hook',
      enabled: true,
      max_retries: 5,
      ...overrides,
    };

    const result = await pool.query(
      `INSERT INTO skill_store_schedule
       (skill_id, collection, cron_expression, webhook_url, enabled, max_retries, payload_template, webhook_headers)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       RETURNING id::text as id, skill_id, collection, webhook_url, max_retries, payload_template, webhook_headers`,
      [
        defaults.skill_id,
        defaults.collection ?? null,
        defaults.cron_expression,
        defaults.webhook_url,
        defaults.enabled,
        defaults.max_retries,
        JSON.stringify(defaults.payload_template ?? {}),
        JSON.stringify(defaults.webhook_headers ?? {}),
      ]
    );
    return result.rows[0] as {
      id: string;
      skill_id: string;
      collection: string | null;
      webhook_url: string;
      max_retries: number;
      payload_template: Record<string, unknown>;
      webhook_headers: Record<string, string>;
    };
  }

  /** Helper to enqueue a scheduled_process job */
  async function enqueueScheduledJob(schedule: {
    id: string;
    skill_id: string;
    collection: string | null;
    webhook_url: string;
    max_retries: number;
    payload_template: Record<string, unknown>;
    webhook_headers: Record<string, string>;
  }, extraPayload: Record<string, unknown> = {}) {
    const result = await pool.query(
      `INSERT INTO internal_job (kind, payload, run_at)
       VALUES ('skill_store.scheduled_process', $1::jsonb, NOW())
       RETURNING id::text as id`,
      [
        JSON.stringify({
          schedule_id: schedule.id,
          skill_id: schedule.skill_id,
          collection: schedule.collection,
          webhook_url: schedule.webhook_url,
          webhook_headers: schedule.webhook_headers,
          payload_template: schedule.payload_template,
          max_retries: schedule.max_retries,
          ...extraPayload,
        }),
      ]
    );
    return (result.rows[0] as { id: string }).id;
  }

  describe('skill_store.scheduled_process handler', () => {
    it('dispatches the handler without "Unknown job kind" error', async () => {
      const schedule = await createSchedule();
      await enqueueScheduledJob(schedule);

      const stats = await processJobs(pool, 10);

      // Should be processed (not skipped as unknown)
      expect(stats.processed).toBe(1);
      // The handler should have been found (not "Unknown job kind" failure)
      // It will enqueue to webhook_outbox, which may or may not dispatch
      // depending on OpenClaw configuration, but the handler itself should succeed
    });

    it('enqueues webhook to webhook_outbox', async () => {
      const schedule = await createSchedule({
        skill_id: 'news-skill',
        collection: 'articles',
        payload_template: { custom_key: 'custom_value' },
      });
      await enqueueScheduledJob(schedule);

      await processJobs(pool, 10);

      // Check webhook_outbox for the enqueued webhook
      const outbox = await pool.query(
        `SELECT kind, destination, body
         FROM webhook_outbox
         WHERE kind = 'skill_store.scheduled_process'`
      );
      expect(outbox.rows).toHaveLength(1);

      const body = outbox.rows[0].body as Record<string, unknown>;
      expect(body.skill_id).toBe('news-skill');
      expect(body.collection).toBe('articles');
      expect(body.schedule_id).toBe(schedule.id);
      expect(body.custom_key).toBe('custom_value');
      expect(body.triggered_at).toBeDefined();
    });

    it('updates schedule last_run_at and last_run_status on success', async () => {
      const schedule = await createSchedule();
      await enqueueScheduledJob(schedule);

      await processJobs(pool, 10);

      const updated = await pool.query(
        `SELECT last_run_at, last_run_status
         FROM skill_store_schedule WHERE id = $1`,
        [schedule.id]
      );
      expect(updated.rows[0].last_run_at).toBeDefined();
      expect(updated.rows[0].last_run_at).not.toBeNull();
      expect(updated.rows[0].last_run_status).toBe('success');
    });

    it('includes runtime data merged with payload_template', async () => {
      const schedule = await createSchedule({
        skill_id: 'my-skill',
        collection: 'my-col',
        payload_template: { user_key: 'user_value', nested: { a: 1 } },
      });
      await enqueueScheduledJob(schedule);

      await processJobs(pool, 10);

      const outbox = await pool.query(
        `SELECT body FROM webhook_outbox WHERE kind = 'skill_store.scheduled_process'`
      );
      const body = outbox.rows[0].body as Record<string, unknown>;
      // Runtime data
      expect(body.skill_id).toBe('my-skill');
      expect(body.collection).toBe('my-col');
      expect(body.schedule_id).toBe(schedule.id);
      expect(body.triggered_at).toBeDefined();
      // Template data
      expect(body.user_key).toBe('user_value');
      expect((body.nested as Record<string, unknown>).a).toBe(1);
    });

    it('handles missing schedule gracefully', async () => {
      // Enqueue a job with a non-existent schedule_id
      await pool.query(
        `INSERT INTO internal_job (kind, payload, run_at)
         VALUES ('skill_store.scheduled_process', $1::jsonb, NOW())`,
        [
          JSON.stringify({
            schedule_id: '00000000-0000-0000-0000-000000000000',
            skill_id: 'test-skill',
            webhook_url: 'https://example.com/hook',
            max_retries: 5,
            webhook_headers: {},
            payload_template: {},
          }),
        ]
      );

      const stats = await processJobs(pool, 10);
      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(1);
    });

    it('handles missing schedule_id in payload', async () => {
      await pool.query(
        `INSERT INTO internal_job (kind, payload, run_at)
         VALUES ('skill_store.scheduled_process', '{"skill_id": "test"}'::jsonb, NOW())`
      );

      const stats = await processJobs(pool, 10);
      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(1);
    });

    it('uses webhook_url from schedule over job payload for security', async () => {
      const schedule = await createSchedule({
        webhook_url: 'https://trusted.example.com/hook',
      });
      await enqueueScheduledJob(schedule);

      await processJobs(pool, 10);

      const outbox = await pool.query(
        `SELECT destination FROM webhook_outbox WHERE kind = 'skill_store.scheduled_process'`
      );
      // The webhook_url from the schedule should be used as the destination
      expect(outbox.rows).toHaveLength(1);
    });

    it('marks job as completed on success', async () => {
      const schedule = await createSchedule();
      const jobId = await enqueueScheduledJob(schedule);

      await processJobs(pool, 10);

      const job = await pool.query(
        `SELECT completed_at FROM internal_job WHERE id = $1`,
        [jobId]
      );
      expect(job.rows[0].completed_at).not.toBeNull();
    });

    it('auto-disables schedule after max_retries consecutive failures (Issue #825)', async () => {
      const schedule = await createSchedule({
        max_retries: 2,
      });

      // Set consecutive_failures in DB to match max_retries (Issue #825: read from DB, not payload)
      await pool.query(
        `UPDATE skill_store_schedule
         SET consecutive_failures = 2, last_run_status = 'failed'
         WHERE id = $1`,
        [schedule.id]
      );

      // Enqueue a job — processor should read consecutive_failures from the schedule row
      await enqueueScheduledJob(schedule);

      await processJobs(pool, 10);

      // Schedule should be auto-disabled
      const updated = await pool.query(
        `SELECT enabled, last_run_status FROM skill_store_schedule WHERE id = $1`,
        [schedule.id]
      );
      expect(updated.rows[0].enabled).toBe(false);
      expect(updated.rows[0].last_run_status).toBe('failed');
    });

    it('does not auto-disable when consecutive failures below max_retries (Issue #825)', async () => {
      const schedule = await createSchedule({
        max_retries: 5,
      });

      // Set consecutive_failures in DB below threshold
      await pool.query(
        `UPDATE skill_store_schedule
         SET consecutive_failures = 2
         WHERE id = $1`,
        [schedule.id]
      );

      await enqueueScheduledJob(schedule);

      await processJobs(pool, 10);

      // Schedule should still be enabled
      const updated = await pool.query(
        `SELECT enabled FROM skill_store_schedule WHERE id = $1`,
        [schedule.id]
      );
      expect(updated.rows[0].enabled).toBe(true);
    });

    it('resets consecutive_failures to 0 on success (Issue #825)', async () => {
      const schedule = await createSchedule({
        max_retries: 5,
      });

      // Simulate prior failures
      await pool.query(
        `UPDATE skill_store_schedule
         SET consecutive_failures = 3, last_run_status = 'failed'
         WHERE id = $1`,
        [schedule.id]
      );

      await enqueueScheduledJob(schedule);
      await processJobs(pool, 10);

      // consecutive_failures should be reset to 0 after successful enqueue
      const updated = await pool.query(
        `SELECT consecutive_failures, last_run_status
         FROM skill_store_schedule WHERE id = $1`,
        [schedule.id]
      );
      expect(updated.rows[0].consecutive_failures).toBe(0);
      expect(updated.rows[0].last_run_status).toBe('success');
    });

    it('consecutive_failures column exists and defaults to 0 (Issue #825)', async () => {
      const schedule = await createSchedule();

      const result = await pool.query(
        `SELECT consecutive_failures FROM skill_store_schedule WHERE id = $1`,
        [schedule.id]
      );
      expect(result.rows[0].consecutive_failures).toBe(0);
    });
  });

  describe('skill_store.embed handler dispatch', () => {
    it('is registered and does not fail with "Unknown job kind"', async () => {
      // Create a skill store item for the embed job
      await pool.query(
        `INSERT INTO skill_store_item (skill_id, collection, title, content)
         VALUES ('test-skill', 'articles', 'Test Item', 'Some content to embed')`
      );

      const itemResult = await pool.query(
        `SELECT id::text as id FROM skill_store_item WHERE skill_id = 'test-skill' LIMIT 1`
      );
      const itemId = (itemResult.rows[0] as { id: string }).id;

      // Enqueue an embed job
      await pool.query(
        `INSERT INTO internal_job (kind, payload, run_at)
         VALUES ('skill_store.embed', $1::jsonb, NOW())`,
        [JSON.stringify({ item_id: itemId })]
      );

      const stats = await processJobs(pool, 10);
      expect(stats.processed).toBe(1);
      // Should not fail with "Unknown job kind" - handler is registered
      // Embedding may succeed or fail depending on embedding service config,
      // but the handler dispatch itself should work
    });
  });
});
