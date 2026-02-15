/**
 * Tests for issue #1321: Todo reminders — due dates not saved and no internal_job created.
 *
 * Verifies:
 * - POST /api/work-items accepts and persists not_before and not_after
 * - Creating a work item with dates creates internal_job entries
 * - PATCH /api/work-items/:id/dates also creates/updates internal_job entries
 * - Clearing dates removes corresponding jobs
 * - Idempotency: same dates don't duplicate jobs
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Query helper that retries on empty results to handle transient
 * visibility delays between the server's pool and the test pool.
 */
async function queryWithRetry(
  pool: Pool,
  sql: string,
  params: unknown[],
  { maxRetries = 3, delayMs = 50 } = {},
): Promise<{ rows: Record<string, unknown>[] }> {
  for (let i = 0; i < maxRetries; i++) {
    const result = await pool.query(sql, params);
    if (result.rows.length > 0) return result;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return pool.query(sql, params);
}

describe('Work item reminders (Issue #1321)', () => {
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

  describe('POST /api/work-items — date persistence', () => {
    it('saves and returns not_before when provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Call mom',
          not_before: '2026-03-01T09:00:00Z',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; not_before: string };
      expect(body.id).toBeDefined();
      expect(body.not_before).toBeDefined();
      expect(new Date(body.not_before).toISOString()).toContain('2026-03-01');
    });

    it('saves and returns not_after when provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Buy groceries',
          not_after: '2026-03-15T17:00:00Z',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; not_after: string };
      expect(body.not_after).toBeDefined();
      expect(new Date(body.not_after).toISOString()).toContain('2026-03-15');
    });

    it('saves both not_before and not_after', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Project milestone',
          not_before: '2026-03-01T00:00:00Z',
          not_after: '2026-03-31T23:59:59Z',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; not_before: string; not_after: string };
      expect(body.not_before).toBeDefined();
      expect(body.not_after).toBeDefined();
      expect(new Date(body.not_before).toISOString()).toContain('2026-03-01');
      expect(new Date(body.not_after).toISOString()).toContain('2026-03-31');
    });

    it('rejects not_before after not_after', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Backwards dates',
          not_before: '2026-06-15T00:00:00Z',
          not_after: '2026-06-01T00:00:00Z',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain('not_before must be before');
    });

    it('rejects invalid not_before date', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Bad date',
          not_before: 'not-a-date',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid not_after date', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Bad date',
          not_after: 'not-a-date',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('works without dates (backwards compatibility)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'No dates',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; not_before: string | null; not_after: string | null };
      expect(body.id).toBeDefined();
      expect(body.not_before).toBeNull();
      expect(body.not_after).toBeNull();
    });
  });

  describe('POST /api/work-items — internal_job creation', () => {
    it('creates a reminder job when not_before is set', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Reminder task',
          not_before: '2026-06-01T09:00:00Z',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };

      const jobs = await queryWithRetry(
        pool,
        `SELECT kind, payload->>'work_item_id' as work_item_id, run_at, idempotency_key
           FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'
            AND payload->>'work_item_id' = $1`,
        [body.id],
      );

      expect(jobs.rows.length).toBe(1);
      expect(jobs.rows[0].work_item_id).toBe(body.id);
      // run_at should be at or near the not_before time
      const runAt = new Date(jobs.rows[0].run_at as string);
      expect(runAt.toISOString()).toContain('2026-06-01');
    });

    it('creates a nudge job when not_after is set', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Deadline task',
          not_after: '2026-06-15T17:00:00Z',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };

      const jobs = await queryWithRetry(
        pool,
        `SELECT kind, payload->>'work_item_id' as work_item_id, idempotency_key
           FROM internal_job
          WHERE kind = 'nudge.work_item.not_after'
            AND payload->>'work_item_id' = $1`,
        [body.id],
      );

      expect(jobs.rows.length).toBe(1);
      expect(jobs.rows[0].work_item_id).toBe(body.id);
    });

    it('creates both jobs when both dates are set', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Both dates',
          not_before: '2026-06-01T09:00:00Z',
          not_after: '2026-06-15T17:00:00Z',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };

      const reminderJobs = await queryWithRetry(
        pool,
        `SELECT kind FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'
            AND payload->>'work_item_id' = $1`,
        [body.id],
      );
      expect(reminderJobs.rows.length).toBe(1);

      const nudgeJobs = await queryWithRetry(
        pool,
        `SELECT kind FROM internal_job
          WHERE kind = 'nudge.work_item.not_after'
            AND payload->>'work_item_id' = $1`,
        [body.id],
      );
      expect(nudgeJobs.rows.length).toBe(1);
    });

    it('does not create jobs when no dates are provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'No dates, no jobs',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string };

      // Small delay to let any potential jobs be created
      await new Promise((r) => setTimeout(r, 100));

      const jobs = await pool.query(
        `SELECT kind FROM internal_job
          WHERE payload->>'work_item_id' = $1`,
        [body.id],
      );
      expect(jobs.rows.length).toBe(0);
    });
  });

  describe('PATCH /api/work-items/:id/dates — internal_job creation', () => {
    it('creates a reminder job when startDate is set', async () => {
      // Create work item without dates
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Patch start date' },
      });
      const { id } = createRes.json() as { id: string };

      // Set startDate
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/dates`,
        payload: { startDate: '2026-07-01' },
      });

      expect(patchRes.statusCode).toBe(200);

      const jobs = await queryWithRetry(
        pool,
        `SELECT kind, payload->>'work_item_id' as work_item_id
           FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'
            AND payload->>'work_item_id' = $1`,
        [id],
      );
      expect(jobs.rows.length).toBe(1);
    });

    it('creates a nudge job when endDate is set', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Patch end date' },
      });
      const { id } = createRes.json() as { id: string };

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/dates`,
        payload: { endDate: '2026-07-15' },
      });

      expect(patchRes.statusCode).toBe(200);

      const jobs = await queryWithRetry(
        pool,
        `SELECT kind, payload->>'work_item_id' as work_item_id
           FROM internal_job
          WHERE kind = 'nudge.work_item.not_after'
            AND payload->>'work_item_id' = $1`,
        [id],
      );
      expect(jobs.rows.length).toBe(1);
    });

    it('removes reminder job when startDate is cleared', async () => {
      // Create with start date
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Clear start date',
          not_before: '2026-07-01T00:00:00Z',
        },
      });
      const { id } = createRes.json() as { id: string };

      // Verify job exists
      const jobsBefore = await queryWithRetry(
        pool,
        `SELECT kind FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'
            AND payload->>'work_item_id' = $1
            AND completed_at IS NULL`,
        [id],
      );
      expect(jobsBefore.rows.length).toBe(1);

      // Clear startDate
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/dates`,
        payload: { startDate: null },
      });

      // Small delay to let DELETE propagate
      await new Promise((r) => setTimeout(r, 100));

      // Verify job was removed
      const jobsAfter = await pool.query(
        `SELECT kind FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'
            AND payload->>'work_item_id' = $1
            AND completed_at IS NULL`,
        [id],
      );
      expect(jobsAfter.rows.length).toBe(0);
    });

    it('removes nudge job when endDate is cleared', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Clear end date',
          not_after: '2026-07-15T00:00:00Z',
        },
      });
      const { id } = createRes.json() as { id: string };

      // Verify job exists
      const jobsBefore = await queryWithRetry(
        pool,
        `SELECT kind FROM internal_job
          WHERE kind = 'nudge.work_item.not_after'
            AND payload->>'work_item_id' = $1
            AND completed_at IS NULL`,
        [id],
      );
      expect(jobsBefore.rows.length).toBe(1);

      // Clear endDate
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/dates`,
        payload: { endDate: null },
      });

      // Small delay to let DELETE propagate
      await new Promise((r) => setTimeout(r, 100));

      // Verify job was removed
      const jobsAfter = await pool.query(
        `SELECT kind FROM internal_job
          WHERE kind = 'nudge.work_item.not_after'
            AND payload->>'work_item_id' = $1
            AND completed_at IS NULL`,
        [id],
      );
      expect(jobsAfter.rows.length).toBe(0);
    });

    it('updates job run_at when dates change (idempotency)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: {
          title: 'Update dates',
          not_before: '2026-07-01T00:00:00Z',
        },
      });
      const { id } = createRes.json() as { id: string };

      // Update to a new date
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${id}/dates`,
        payload: { startDate: '2026-08-01' },
      });

      expect(patchRes.statusCode).toBe(200);

      // Should still only be ONE job, not two
      const jobs = await queryWithRetry(
        pool,
        `SELECT kind, run_at FROM internal_job
          WHERE kind = 'reminder.work_item.not_before'
            AND payload->>'work_item_id' = $1
            AND completed_at IS NULL`,
        [id],
      );
      expect(jobs.rows.length).toBe(1);
      // The run_at should reflect the new date
      const runAt = new Date(jobs.rows[0].run_at as string);
      expect(runAt.toISOString()).toContain('2026-08-01');
    });
  });
});
