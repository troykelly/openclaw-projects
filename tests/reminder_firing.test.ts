import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';

describe('Reminder firing hook (Issue #222)', () => {
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

  describe('enqueue_due_reminders()', () => {
    it('enqueues a reminder job when not_before is reached', async () => {
      // Create a work item with not_before in the past (reminder due)
      const wi = await pool.query(
        `INSERT INTO work_item (title, not_before, status)
         VALUES ($1, now() - interval '1 hour', 'open')
         RETURNING id::text as id`,
        ['Call mom']
      );
      const workItemId = wi.rows[0].id as string;

      // Run the enqueue function
      await pool.query(`SELECT enqueue_due_reminders()`);

      // Verify job was created
      const jobs = await pool.query(
        `SELECT kind, payload->>'work_item_id' as work_item_id
           FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'`
      );

      expect(jobs.rows).toEqual([
        {
          kind: 'reminder.work_item.not_before',
          work_item_id: workItemId,
        },
      ]);
    });

    it('is idempotent - only one job per work item per day', async () => {
      // Create a work item with not_before in the past
      await pool.query(
        `INSERT INTO work_item (title, not_before, status)
         VALUES ($1, now() - interval '1 hour', 'open')`,
        ['Call mom']
      );

      // Run the enqueue function twice
      await pool.query(`SELECT enqueue_due_reminders()`);
      await pool.query(`SELECT enqueue_due_reminders()`);

      // Verify only one job was created
      const jobs = await pool.query(
        `SELECT COUNT(*) as count
           FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'`
      );

      expect(parseInt(jobs.rows[0].count as string, 10)).toBe(1);
    });

    it('does not enqueue for future not_before dates', async () => {
      // Create a work item with not_before in the future
      await pool.query(
        `INSERT INTO work_item (title, not_before, status)
         VALUES ($1, now() + interval '1 hour', 'open')`,
        ['Future reminder']
      );

      // Run the enqueue function
      await pool.query(`SELECT enqueue_due_reminders()`);

      // Verify no jobs were created
      const jobs = await pool.query(
        `SELECT COUNT(*) as count
           FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'`
      );

      expect(parseInt(jobs.rows[0].count as string, 10)).toBe(0);
    });

    it('does not enqueue for completed work items', async () => {
      // Create a completed work item with not_before in the past
      await pool.query(
        `INSERT INTO work_item (title, not_before, status)
         VALUES ($1, now() - interval '1 hour', 'completed')`,
        ['Done task']
      );

      // Run the enqueue function
      await pool.query(`SELECT enqueue_due_reminders()`);

      // Verify no jobs were created
      const jobs = await pool.query(
        `SELECT COUNT(*) as count
           FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'`
      );

      expect(parseInt(jobs.rows[0].count as string, 10)).toBe(0);
    });

    it('does not enqueue for cancelled work items', async () => {
      await pool.query(
        `INSERT INTO work_item (title, not_before, status)
         VALUES ($1, now() - interval '1 hour', 'cancelled')`,
        ['Cancelled task']
      );

      await pool.query(`SELECT enqueue_due_reminders()`);

      const jobs = await pool.query(
        `SELECT COUNT(*) as count
           FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'`
      );

      expect(parseInt(jobs.rows[0].count as string, 10)).toBe(0);
    });

    it('does not enqueue for archived work items', async () => {
      await pool.query(
        `INSERT INTO work_item (title, not_before, status)
         VALUES ($1, now() - interval '1 hour', 'archived')`,
        ['Archived task']
      );

      await pool.query(`SELECT enqueue_due_reminders()`);

      const jobs = await pool.query(
        `SELECT COUNT(*) as count
           FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'`
      );

      expect(parseInt(jobs.rows[0].count as string, 10)).toBe(0);
    });

    it('includes not_before timestamp in payload', async () => {
      const notBefore = new Date();
      notBefore.setHours(notBefore.getHours() - 1);

      await pool.query(
        `INSERT INTO work_item (title, not_before, status)
         VALUES ($1, $2, 'open')`,
        ['Call mom', notBefore]
      );

      await pool.query(`SELECT enqueue_due_reminders()`);

      const jobs = await pool.query(
        `SELECT payload->>'not_before' as not_before
           FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'`
      );

      expect(jobs.rows.length).toBe(1);
      expect(jobs.rows[0].not_before).toBeDefined();
    });
  });

  describe('pg_cron job', () => {
    it('registers a pg_cron job for enqueuing reminders', async () => {
      const job = await pool.query(
        `SELECT jobname, schedule, command
           FROM cron.job
          WHERE jobname = 'internal_reminder_enqueue'
          LIMIT 1`
      );

      expect(job.rows.length).toBe(1);
      expect(job.rows[0].schedule).toContain('*');
      expect(job.rows[0].command).toContain('enqueue_due_reminders');
    });
  });
});
