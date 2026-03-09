import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Issue #2292: Integration tests for todo reminder/nudge pgcron functions and job routing.
 */
describe('Todo pgcron reminders and nudges (#2292)', () => {
  const app = buildServer();
  let pool: Pool;
  let listId: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, 'test@example.com');

    // Create a list work item
    const created = await app.inject({
      method: 'POST',
      url: '/work-items',
      payload: { title: 'Shopping', kind: 'list' },
    });
    listId = (created.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('enqueue_due_todo_reminders()', () => {
    it('creates internal_job for todo with not_before in the past', async () => {
      // Create a todo with not_before in the past
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Buy milk' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      // Set not_before to the past
      await pool.query(
        `UPDATE work_item_todo SET not_before = now() - interval '1 hour' WHERE id = $1`,
        [todoId],
      );

      // Call the pgcron function
      const result = await pool.query('SELECT enqueue_due_todo_reminders() as count');
      const count = (result.rows[0] as { count: number }).count;
      expect(count).toBeGreaterThanOrEqual(1);

      // Verify job was created
      const jobs = await pool.query(
        `SELECT kind, payload, idempotency_key
         FROM internal_job
         WHERE kind = 'reminder.todo.not_before'
           AND completed_at IS NULL`,
      );
      expect(jobs.rows.length).toBeGreaterThanOrEqual(1);
      const job = jobs.rows[0] as { kind: string; payload: { entity_type: string; todo_id: string }; idempotency_key: string };
      expect(job.payload.entity_type).toBe('todo');
      expect(job.payload.todo_id).toBe(todoId);
      expect(job.idempotency_key).toMatch(/^todo_not_before:/);
    });

    it('does NOT create job for completed todo', async () => {
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Already done' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      // Set not_before in past AND mark completed
      await pool.query(
        `UPDATE work_item_todo SET not_before = now() - interval '1 hour', completed = true, completed_at = now() WHERE id = $1`,
        [todoId],
      );

      const result = await pool.query('SELECT enqueue_due_todo_reminders() as count');
      const count = (result.rows[0] as { count: number }).count;
      expect(count).toBe(0);
    });

    it('is idempotent — same todo same day creates one job', async () => {
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Idempotent test' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      await pool.query(
        `UPDATE work_item_todo SET not_before = now() - interval '30 minutes' WHERE id = $1`,
        [todoId],
      );

      // Call twice
      await pool.query('SELECT enqueue_due_todo_reminders()');
      await pool.query('SELECT enqueue_due_todo_reminders()');

      const jobs = await pool.query(
        `SELECT * FROM internal_job
         WHERE kind = 'reminder.todo.not_before'
           AND payload->>'todo_id' = $1`,
        [todoId],
      );
      expect(jobs.rows.length).toBe(1);
    });

    it('idempotency key follows expected format', async () => {
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Key format test' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      await pool.query(
        `UPDATE work_item_todo SET not_before = now() - interval '10 minutes' WHERE id = $1`,
        [todoId],
      );

      await pool.query('SELECT enqueue_due_todo_reminders()');

      const jobs = await pool.query(
        `SELECT idempotency_key FROM internal_job
         WHERE kind = 'reminder.todo.not_before'
           AND payload->>'todo_id' = $1`,
        [todoId],
      );
      const key = (jobs.rows[0] as { idempotency_key: string }).idempotency_key;
      // Format: todo_not_before:<uuid>:<YYYY-MM-DD>
      expect(key).toMatch(/^todo_not_before:[0-9a-f-]+:\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('enqueue_due_todo_nudges()', () => {
    it('creates internal_job for todo with not_after within 24 hours', async () => {
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Deadline soon' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      // Set not_after to 12 hours from now (within 24 hour window)
      await pool.query(
        `UPDATE work_item_todo SET not_after = now() + interval '12 hours' WHERE id = $1`,
        [todoId],
      );

      const result = await pool.query('SELECT enqueue_due_todo_nudges() as count');
      const count = (result.rows[0] as { count: number }).count;
      expect(count).toBeGreaterThanOrEqual(1);

      const jobs = await pool.query(
        `SELECT kind, payload, idempotency_key
         FROM internal_job
         WHERE kind = 'nudge.todo.not_after'
           AND completed_at IS NULL`,
      );
      expect(jobs.rows.length).toBeGreaterThanOrEqual(1);
      const job = jobs.rows[0] as { kind: string; payload: { entity_type: string; todo_id: string }; idempotency_key: string };
      expect(job.payload.entity_type).toBe('todo');
      expect(job.payload.todo_id).toBe(todoId);
      expect(job.idempotency_key).toMatch(/^todo_not_after:/);
    });

    it('does NOT create job for completed todo', async () => {
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Done already' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      await pool.query(
        `UPDATE work_item_todo SET not_after = now() + interval '6 hours', completed = true, completed_at = now() WHERE id = $1`,
        [todoId],
      );

      const result = await pool.query('SELECT enqueue_due_todo_nudges() as count');
      const count = (result.rows[0] as { count: number }).count;
      expect(count).toBe(0);
    });

    it('does NOT create job for todo with not_after more than 24h away', async () => {
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Far away' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      await pool.query(
        `UPDATE work_item_todo SET not_after = now() + interval '48 hours' WHERE id = $1`,
        [todoId],
      );

      const result = await pool.query('SELECT enqueue_due_todo_nudges() as count');
      const count = (result.rows[0] as { count: number }).count;
      expect(count).toBe(0);
    });
  });

  describe('Job payload includes entity_type for routing', () => {
    it('reminder job has entity_type=todo in payload', async () => {
      const todoRes = await app.inject({
        method: 'POST',
        url: `/work-items/${listId}/todos`,
        payload: { text: 'Routing test' },
      });
      const todoId = (todoRes.json() as { id: string }).id;

      await pool.query(
        `UPDATE work_item_todo SET not_before = now() - interval '5 minutes' WHERE id = $1`,
        [todoId],
      );

      await pool.query('SELECT enqueue_due_todo_reminders()');

      const jobs = await pool.query(
        `SELECT payload FROM internal_job
         WHERE kind = 'reminder.todo.not_before'
           AND payload->>'todo_id' = $1`,
        [todoId],
      );
      const payload = (jobs.rows[0] as { payload: { entity_type: string } }).payload;
      expect(payload.entity_type).toBe('todo');
    });
  });
});
