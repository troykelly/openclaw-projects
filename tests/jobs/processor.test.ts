import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from '../helpers/migrate.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { claimJobs, completeJob, failJob, processJobs, getPendingJobCounts } from '../../src/api/jobs/processor.ts';

// Set up OpenClaw config for webhook tests
vi.stubEnv('OPENCLAW_GATEWAY_URL', 'https://test-gateway.openclaw.ai');
vi.stubEnv('OPENCLAW_HOOK_TOKEN', 'test-hook-token');

describe('Job processor (Issue #222)', () => {
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

  describe('claimJobs', () => {
    it('claims available jobs', async () => {
      // Insert a job that's due
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('test.job', now(), '{"test": true}'::jsonb)`,
      );

      const jobs = await claimJobs(pool, 'test-worker', 10);

      expect(jobs.length).toBe(1);
      expect(jobs[0].kind).toBe('test.job');
      expect(jobs[0].payload).toEqual({ test: true });
    });

    it('does not claim future jobs', async () => {
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('test.job', now() + interval '1 hour', '{"test": true}'::jsonb)`,
      );

      const jobs = await claimJobs(pool, 'test-worker', 10);

      expect(jobs.length).toBe(0);
    });

    it('does not claim completed jobs', async () => {
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload, completed_at)
         VALUES ('test.job', now(), '{"test": true}'::jsonb, now())`,
      );

      const jobs = await claimJobs(pool, 'test-worker', 10);

      expect(jobs.length).toBe(0);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `INSERT INTO internal_job (kind, run_at, payload)
           VALUES ('test.job', now(), '{"index": ${i}}'::jsonb)`,
        );
      }

      const jobs = await claimJobs(pool, 'test-worker', 2);

      expect(jobs.length).toBe(2);
    });
  });

  describe('completeJob', () => {
    it('marks a job as completed', async () => {
      const result = await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('test.job', now(), '{}'::jsonb)
         RETURNING id::text as id`,
      );
      const jobId = result.rows[0].id as string;

      // Claim the job first (migration 063 requires locked_by IS NOT NULL)
      const claimed = await claimJobs(pool, 'test-worker', 1);
      expect(claimed.length).toBe(1);

      await completeJob(pool, jobId, 'test-worker');

      const job = await pool.query(`SELECT completed_at FROM internal_job WHERE id = $1`, [jobId]);

      expect(job.rows[0].completed_at).not.toBeNull();
    });
  });

  describe('failJob', () => {
    it('records error and schedules retry', async () => {
      const result = await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('test.job', now(), '{}'::jsonb)
         RETURNING id::text as id`,
      );
      const jobId = result.rows[0].id as string;

      // Claim the job first (migration 063 requires locked_by IS NOT NULL)
      const claimed = await claimJobs(pool, 'test-worker', 1);
      expect(claimed.length).toBe(1);

      await failJob(pool, jobId, 'Test error', 60, 'test-worker');

      const job = await pool.query(
        `SELECT attempts, last_error, (run_at > now()) as scheduled_future
         FROM internal_job WHERE id = $1`,
        [jobId],
      );

      expect(job.rows[0].attempts).toBe(1);
      expect(job.rows[0].last_error).toBe('Test error');
      expect(job.rows[0].scheduled_future).toBe(true);
    });
  });

  describe('processJobs', () => {
    it('processes reminder.work_item.not_before jobs', async () => {
      // Create a work item
      const wi = await pool.query(
        `INSERT INTO work_item (title, not_before, status, work_item_kind)
         VALUES ('Call mom', now() - interval '1 hour', 'open', 'issue')
         RETURNING id::text as id`,
      );
      const workItemId = wi.rows[0].id as string;

      // Create a reminder job
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('reminder.work_item.not_before', now(), $1)`,
        [JSON.stringify({ work_item_id: workItemId, not_before: new Date().toISOString() })],
      );

      // Process jobs
      const stats = await processJobs(pool, 10);

      expect(stats.processed).toBe(1);
      expect(stats.succeeded).toBe(1);
      expect(stats.failed).toBe(0);

      // Verify webhook was enqueued
      const webhooks = await pool.query(
        `SELECT kind, destination, body
         FROM webhook_outbox
         WHERE kind = 'reminder.work_item.not_before'`,
      );

      expect(webhooks.rows.length).toBe(1);
      expect(webhooks.rows[0].destination).toBe('/hooks/agent');
      expect(webhooks.rows[0].body.context.work_item_id).toBe(workItemId);
    });

    it('processes nudge.work_item.not_after jobs', async () => {
      // Create a work item
      const wi = await pool.query(
        `INSERT INTO work_item (title, not_after, status, work_item_kind)
         VALUES ('Deadline soon', now() + interval '2 hours', 'open', 'issue')
         RETURNING id::text as id`,
      );
      const workItemId = wi.rows[0].id as string;

      // Create a nudge job
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('nudge.work_item.not_after', now(), $1)`,
        [JSON.stringify({ work_item_id: workItemId, not_after: new Date().toISOString() })],
      );

      // Process jobs
      const stats = await processJobs(pool, 10);

      expect(stats.processed).toBe(1);
      expect(stats.succeeded).toBe(1);

      // Verify webhook was enqueued
      const webhooks = await pool.query(
        `SELECT kind, destination
         FROM webhook_outbox
         WHERE kind = 'nudge.work_item.not_after'`,
      );

      expect(webhooks.rows.length).toBe(1);
      expect(webhooks.rows[0].destination).toBe('/hooks/wake');
    });

    it('skips completed work items', async () => {
      // Create a completed work item
      const wi = await pool.query(
        `INSERT INTO work_item (title, not_before, status, work_item_kind)
         VALUES ('Done task', now() - interval '1 hour', 'completed', 'issue')
         RETURNING id::text as id`,
      );
      const workItemId = wi.rows[0].id as string;

      // Create a reminder job
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('reminder.work_item.not_before', now(), $1)`,
        [JSON.stringify({ work_item_id: workItemId, not_before: new Date().toISOString() })],
      );

      // Process jobs
      const stats = await processJobs(pool, 10);

      expect(stats.processed).toBe(1);
      expect(stats.succeeded).toBe(1); // Skipped silently counts as success

      // Verify no webhook was enqueued
      const webhooks = await pool.query(`SELECT COUNT(*) as count FROM webhook_outbox`);

      expect(parseInt(webhooks.rows[0].count as string, 10)).toBe(0);
    });

    it('fails unknown job kinds', async () => {
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('unknown.job.kind', now(), '{}'::jsonb)`,
      );

      const stats = await processJobs(pool, 10);

      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(1);
    });

    it('handles missing work items gracefully', async () => {
      // Create a job referencing a non-existent work item
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('reminder.work_item.not_before', now(), $1)`,
        [
          JSON.stringify({
            work_item_id: '00000000-0000-0000-0000-000000000000',
            not_before: new Date().toISOString(),
          }),
        ],
      );

      const stats = await processJobs(pool, 10);

      expect(stats.processed).toBe(1);
      expect(stats.failed).toBe(1);
    });
  });

  describe('getPendingJobCounts', () => {
    it('returns counts by job kind', async () => {
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload)
         VALUES ('reminder.work_item.not_before', now(), '{}'),
                ('reminder.work_item.not_before', now(), '{}'),
                ('nudge.work_item.not_after', now(), '{}')`,
      );

      const counts = await getPendingJobCounts(pool);

      expect(counts['reminder.work_item.not_before']).toBe(2);
      expect(counts['nudge.work_item.not_after']).toBe(1);
    });

    it('excludes completed jobs', async () => {
      await pool.query(
        `INSERT INTO internal_job (kind, run_at, payload, completed_at)
         VALUES ('reminder.work_item.not_before', now(), '{}', now())`,
      );

      const counts = await getPendingJobCounts(pool);

      expect(counts['reminder.work_item.not_before']).toBeUndefined();
    });
  });
});
