import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Internal job queue + pg_cron nudge enqueuer', () => {
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

  it('creates internal_job and webhook_outbox tables', async () => {
    const tables = await pool.query(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('internal_job', 'webhook_outbox')
        ORDER BY tablename`
    );

    expect(tables.rows.map((r) => r.tablename)).toEqual(['internal_job', 'webhook_outbox']);
  });

  it('enqueues a not_after nudge job (idempotent)', async () => {
    const wi = await pool.query(
      `INSERT INTO work_item (title, not_after)
       VALUES ($1, now() + interval '2 hours')
       RETURNING id::text as id`,
      ['Due soon']
    );
    const workItemId = wi.rows[0].id as string;

    // Act: run the DB-side enqueue function twice.
    await pool.query(`SELECT enqueue_due_nudges()`);
    await pool.query(`SELECT enqueue_due_nudges()`);

    const jobs = await pool.query(
      `SELECT kind, payload->>'work_item_id' as work_item_id
         FROM internal_job
        WHERE kind = 'nudge.work_item.not_after'
        ORDER BY created_at`
    );

    expect(jobs.rows).toEqual([
      {
        kind: 'nudge.work_item.not_after',
        work_item_id: workItemId,
      },
    ]);
  });

  it('claims jobs with a locking strategy that prevents double-processing (SKIP LOCKED)', async () => {
    await pool.query(
      `INSERT INTO internal_job (kind, run_at, payload)
       VALUES ('test', now(), '{}'::jsonb)`
    );

    const c1 = await pool.connect();
    const c2 = await pool.connect();

    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');

      const r1 = await c1.query(
        `SELECT id::text as id
           FROM internal_job_claim($1, $2)`,
        ['worker-a', 10]
      );

      const r2 = await c2.query(
        `SELECT id::text as id
           FROM internal_job_claim($1, $2)`,
        ['worker-b', 10]
      );

      expect(r1.rows.length).toBe(1);
      expect(r2.rows.length).toBe(0);

      await c1.query('COMMIT');
      await c2.query('COMMIT');
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('supports retry/backoff fields via fail + requeue semantics', async () => {
    const inserted = await pool.query(
      `INSERT INTO internal_job (kind, run_at, payload)
       VALUES ('test', now(), '{}'::jsonb)
       RETURNING id::text as id`
    );
    const jobId = inserted.rows[0].id as string;

    const claimed = await pool.query(
      `SELECT id::text as id
         FROM internal_job_claim($1, $2)`,
      ['worker-a', 1]
    );
    expect(claimed.rows.map((r) => r.id)).toEqual([jobId]);

    await pool.query(`SELECT internal_job_fail($1, $2, $3)`, [jobId, 'boom', 60]);

    const row = await pool.query(
      `SELECT attempts, last_error, locked_at, locked_by,
              (run_at > now()) as run_at_in_future
         FROM internal_job
        WHERE id = $1`,
      [jobId]
    );

    expect(row.rows[0].attempts).toBe(1);
    expect(row.rows[0].last_error).toBe('boom');
    expect(row.rows[0].locked_at).toBe(null);
    expect(row.rows[0].locked_by).toBe(null);
    expect(row.rows[0].run_at_in_future).toBe(true);
  });

  it('registers a pg_cron job for enqueuing nudges', async () => {
    const job = await pool.query(
      `SELECT jobname, schedule, command
         FROM cron.job
        WHERE jobname = 'internal_nudge_enqueue'
        LIMIT 1`
    );

    expect(job.rows.length).toBe(1);
    expect(job.rows[0].schedule).toContain('*');
    expect(job.rows[0].command).toContain('enqueue_due_nudges');
  });
});
