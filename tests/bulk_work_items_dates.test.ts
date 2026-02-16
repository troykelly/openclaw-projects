/**
 * Tests for issue #1352: POST /api/work-items/bulk drops not_before, not_after.
 *
 * Verifies:
 * - Bulk endpoint accepts not_before and not_after per item
 * - Dates are persisted in the work_item table
 * - internal_job entries are created for items with dates
 * - Items without dates still work (backwards compatibility)
 * - Invalid date formats are handled gracefully
 * - Date range validation (not_before must be before not_after)
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
  { maxRetries = 5, delayMs = 100 } = {},
): Promise<{ rows: Record<string, unknown>[] }> {
  for (let i = 0; i < maxRetries; i++) {
    const result = await pool.query(sql, params);
    if (result.rows.length > 0) return result;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return pool.query(sql, params);
}

describe('POST /api/work-items/bulk — not_before/not_after (Issue #1352)', () => {
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

  it('persists not_before and not_after for bulk items', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items/bulk',
      payload: {
        items: [
          {
            title: 'Task with reminder',
            not_before: '2026-06-01T09:00:00Z',
          },
          {
            title: 'Task with deadline',
            not_after: '2026-07-15T17:00:00Z',
          },
          {
            title: 'Task with both dates',
            not_before: '2026-08-01T00:00:00Z',
            not_after: '2026-08-31T23:59:59Z',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: number; results: Array<{ id: string; status: string }> };
    expect(body.created).toBe(3);

    // Check first item: not_before set
    const row1 = await pool.query(
      'SELECT not_before, not_after FROM work_item WHERE id = $1',
      [body.results[0].id],
    );
    expect(row1.rows.length).toBe(1);
    expect(row1.rows[0].not_before).not.toBeNull();
    expect(new Date(row1.rows[0].not_before as string).toISOString()).toContain('2026-06-01');
    expect(row1.rows[0].not_after).toBeNull();

    // Check second item: not_after set
    const row2 = await pool.query(
      'SELECT not_before, not_after FROM work_item WHERE id = $1',
      [body.results[1].id],
    );
    expect(row2.rows[0].not_before).toBeNull();
    expect(row2.rows[0].not_after).not.toBeNull();
    expect(new Date(row2.rows[0].not_after as string).toISOString()).toContain('2026-07-15');

    // Check third item: both dates set
    const row3 = await pool.query(
      'SELECT not_before, not_after FROM work_item WHERE id = $1',
      [body.results[2].id],
    );
    expect(row3.rows[0].not_before).not.toBeNull();
    expect(row3.rows[0].not_after).not.toBeNull();
    expect(new Date(row3.rows[0].not_before as string).toISOString()).toContain('2026-08-01');
    expect(new Date(row3.rows[0].not_after as string).toISOString()).toContain('2026-08-31');
  });

  it('creates internal_job entries for items with dates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items/bulk',
      payload: {
        items: [
          {
            title: 'Reminder item',
            not_before: '2026-06-01T09:00:00Z',
          },
          {
            title: 'Deadline item',
            not_after: '2026-07-15T17:00:00Z',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: number; results: Array<{ id: string; status: string }> };
    expect(body.created).toBe(2);

    // Check reminder job for first item
    const reminderJobs = await queryWithRetry(
      pool,
      `SELECT kind, payload->>'work_item_id' as work_item_id
         FROM internal_job
        WHERE kind = 'reminder.work_item.not_before'
          AND payload->>'work_item_id' = $1`,
      [body.results[0].id],
    );
    expect(reminderJobs.rows.length).toBe(1);
    expect(reminderJobs.rows[0].work_item_id).toBe(body.results[0].id);

    // Check nudge job for second item
    const nudgeJobs = await queryWithRetry(
      pool,
      `SELECT kind, payload->>'work_item_id' as work_item_id
         FROM internal_job
        WHERE kind = 'nudge.work_item.not_after'
          AND payload->>'work_item_id' = $1`,
      [body.results[1].id],
    );
    expect(nudgeJobs.rows.length).toBe(1);
    expect(nudgeJobs.rows[0].work_item_id).toBe(body.results[1].id);
  });

  it('creates both reminder and nudge jobs when both dates are set', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items/bulk',
      payload: {
        items: [
          {
            title: 'Both dates item',
            not_before: '2026-06-01T09:00:00Z',
            not_after: '2026-06-30T17:00:00Z',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: number; results: Array<{ id: string; status: string }> };
    expect(body.created).toBe(1);
    const itemId = body.results[0].id;

    const reminderJobs = await queryWithRetry(
      pool,
      `SELECT kind FROM internal_job
        WHERE kind = 'reminder.work_item.not_before'
          AND payload->>'work_item_id' = $1`,
      [itemId],
    );
    expect(reminderJobs.rows.length).toBe(1);

    const nudgeJobs = await queryWithRetry(
      pool,
      `SELECT kind FROM internal_job
        WHERE kind = 'nudge.work_item.not_after'
          AND payload->>'work_item_id' = $1`,
      [itemId],
    );
    expect(nudgeJobs.rows.length).toBe(1);
  });

  it('does not create jobs for items without dates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items/bulk',
      payload: {
        items: [
          { title: 'No dates item' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: number; results: Array<{ id: string; status: string }> };
    expect(body.created).toBe(1);

    // Small delay to let any potential jobs be created
    await new Promise((r) => setTimeout(r, 100));

    const jobs = await pool.query(
      `SELECT kind FROM internal_job WHERE payload->>'work_item_id' = $1`,
      [body.results[0].id],
    );
    expect(jobs.rows.length).toBe(0);
  });

  it('handles mix of items with and without dates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items/bulk',
      payload: {
        items: [
          { title: 'No dates' },
          { title: 'With reminder', not_before: '2026-06-01T09:00:00Z' },
          { title: 'Also no dates' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { created: number; results: Array<{ id: string; status: string }> };
    expect(body.created).toBe(3);

    // Only item at index 1 should have a job
    const jobs = await queryWithRetry(
      pool,
      `SELECT payload->>'work_item_id' as work_item_id
         FROM internal_job
        WHERE kind = 'reminder.work_item.not_before'`,
      [],
    );
    expect(jobs.rows.length).toBe(1);
    expect(jobs.rows[0].work_item_id).toBe(body.results[1].id);
  });

  it('rejects items with invalid not_before date', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items/bulk',
      payload: {
        items: [
          { title: 'Bad date', not_before: 'not-a-date' },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { results: Array<{ status: string; error?: string }> };
    expect(body.results[0].status).toBe('failed');
    expect(body.results[0].error).toContain('not_before');
  });

  it('rejects items with invalid not_after date', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items/bulk',
      payload: {
        items: [
          { title: 'Bad date', not_after: 'garbage' },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { results: Array<{ status: string; error?: string }> };
    expect(body.results[0].status).toBe('failed');
    expect(body.results[0].error).toContain('not_after');
  });

  it('rejects items where not_before is after not_after', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/work-items/bulk',
      payload: {
        items: [
          {
            title: 'Backwards dates',
            not_before: '2026-09-01T00:00:00Z',
            not_after: '2026-06-01T00:00:00Z',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { results: Array<{ status: string; error?: string }> };
    expect(body.results[0].status).toBe('failed');
    expect(body.results[0].error).toContain('not_before');
  });
});
