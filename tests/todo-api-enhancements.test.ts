import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Issue #2293: Integration tests for todo API enhancements.
 * Tests: sort_order, not_before, not_after, priority fields on PATCH
 * Tests: POST /work-items/:id/todos/reorder endpoint
 * Tests: GET /work-items/:id/todos orders by sort_order
 * Tests: ?scope=triage on GET /work-items
 */
describe('Todo API enhancements (#2293)', () => {
  const app = buildServer();
  let pool: Pool;
  let list_id: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, 'test@example.com');

    // Create a list work item for todos
    const created = await app.inject({
      method: 'POST',
      url: '/work-items',
      payload: { title: 'Shopping List', kind: 'list' },
    });
    list_id = (created.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('PATCH /work-items/:id/todos/:todo_id — new fields', () => {
    let todoId: string;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos`,
        payload: { text: 'Buy asparagus' },
      });
      todoId = (created.json() as { id: string }).id;
    });

    it('accepts sort_order', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todoId}`,
        payload: { sort_order: 100 },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { sort_order: number };
      expect(body.sort_order).toBe(100);
    });

    it('accepts not_before', async () => {
      const notBefore = '2026-03-10T09:00:00.000Z';
      const res = await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todoId}`,
        payload: { not_before: notBefore },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { not_before: string | null };
      expect(body.not_before).not.toBeNull();
    });

    it('accepts not_after', async () => {
      const notAfter = '2026-03-15T17:00:00.000Z';
      const res = await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todoId}`,
        payload: { not_after: notAfter },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { not_after: string | null };
      expect(body.not_after).not.toBeNull();
    });

    it('accepts priority', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todoId}`,
        payload: { priority: 'P0' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { priority: string };
      expect(body.priority).toBe('P0');
    });

    it('rejects invalid not_before/not_after order', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todoId}`,
        payload: { not_before: '2026-03-20T00:00:00Z', not_after: '2026-03-10T00:00:00Z' },
      });
      // DB constraint: not_before <= not_after
      expect(res.statusCode).toBe(400);
    });

    it('clears not_before when set to null', async () => {
      // First set a value
      await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todoId}`,
        payload: { not_before: '2026-03-10T09:00:00Z' },
      });

      // Then clear it
      const res = await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todoId}`,
        payload: { not_before: null },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { not_before: string | null };
      expect(body.not_before).toBeNull();
    });
  });

  describe('POST /work-items/:id/todos — returns new fields', () => {
    it('returns sort_order, priority, updated_at on create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos`,
        payload: { text: 'Bananas' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        sort_order: number;
        priority: string;
        updated_at: string;
        not_before: string | null;
        not_after: string | null;
      };
      expect(typeof body.sort_order).toBe('number');
      expect(body.priority).toBe('P2'); // default
      expect(body.updated_at).toBeDefined();
      expect(body.not_before).toBeNull();
      expect(body.not_after).toBeNull();
    });
  });

  describe('GET /work-items/:id/todos — ordered by sort_order', () => {
    it('returns todos ordered by sort_order', async () => {
      // Create 3 todos with specific sort_orders
      const todo1 = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos`,
        payload: { text: 'C - third' },
      });
      const todo1Id = (todo1.json() as { id: string }).id;

      const todo2 = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos`,
        payload: { text: 'A - first' },
      });
      const todo2Id = (todo2.json() as { id: string }).id;

      const todo3 = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos`,
        payload: { text: 'B - second' },
      });
      const todo3Id = (todo3.json() as { id: string }).id;

      // Reorder: A=100, B=200, C=300
      await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todo2Id}`,
        payload: { sort_order: 100 },
      });
      await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todo3Id}`,
        payload: { sort_order: 200 },
      });
      await app.inject({
        method: 'PATCH',
        url: `/work-items/${list_id}/todos/${todo1Id}`,
        payload: { sort_order: 300 },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/work-items/${list_id}/todos`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { todos: Array<{ text: string; sort_order: number }> };
      expect(body.todos.length).toBe(3);
      expect(body.todos[0].text).toBe('A - first');
      expect(body.todos[1].text).toBe('B - second');
      expect(body.todos[2].text).toBe('C - third');
    });

    it('returns new fields in GET response', async () => {
      await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos`,
        payload: { text: 'Test item' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/work-items/${list_id}/todos`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        todos: Array<{
          sort_order: number;
          not_before: string | null;
          not_after: string | null;
          priority: string;
          updated_at: string;
        }>;
      };
      const todo = body.todos[0];
      expect(typeof todo.sort_order).toBe('number');
      expect(todo.not_before).toBeNull();
      expect(todo.not_after).toBeNull();
      expect(todo.priority).toBe('P2');
      expect(todo.updated_at).toBeDefined();
    });
  });

  describe('POST /work-items/:id/todos/reorder', () => {
    it('reorders multiple todos at once', async () => {
      const t1 = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos`,
        payload: { text: 'Item 1' },
      });
      const t2 = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos`,
        payload: { text: 'Item 2' },
      });
      const t3 = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos`,
        payload: { text: 'Item 3' },
      });

      const id1 = (t1.json() as { id: string }).id;
      const id2 = (t2.json() as { id: string }).id;
      const id3 = (t3.json() as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos/reorder`,
        payload: {
          items: [
            { todo_id: id3, sort_order: 100 },
            { todo_id: id1, sort_order: 200 },
            { todo_id: id2, sort_order: 300 },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean };
      expect(body.ok).toBe(true);

      // Verify order
      const list = await app.inject({
        method: 'GET',
        url: `/work-items/${list_id}/todos`,
      });
      const todos = (list.json() as { todos: Array<{ id: string; text: string }> }).todos;
      expect(todos[0].text).toBe('Item 3');
      expect(todos[1].text).toBe('Item 1');
      expect(todos[2].text).toBe('Item 2');
    });

    it('returns 400 when items is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos/reorder`,
        payload: { items: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when items is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/work-items/${list_id}/todos/reorder`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/work-items/00000000-0000-0000-0000-000000000000/todos/reorder',
        payload: {
          items: [{ todo_id: '00000000-0000-0000-0000-000000000001', sort_order: 100 }],
        },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /work-items?scope=triage', () => {
    it('returns only unparented issues', async () => {
      // Create an initiative (top-level, not an issue)
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'My Initiative', kind: 'initiative' },
      });

      // Create a standalone issue (should appear in triage)
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Call dentist', kind: 'issue' },
      });

      // Create another standalone issue
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Buy groceries', kind: 'issue' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/work-items?scope=triage',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ title: string; kind: string }> };
      expect(body.items.length).toBe(2);
      expect(body.items.every((i) => i.kind === 'issue')).toBe(true);
    });

    it('does not include parented issues', async () => {
      // Create hierarchy
      const init = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Init', kind: 'initiative' },
      });
      const initId = (init.json() as { id: string }).id;

      const epic = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Epic', kind: 'epic', parent_id: initId },
      });
      const epicId = (epic.json() as { id: string }).id;

      // Parented issue (should NOT appear in triage)
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Parented issue', kind: 'issue', parent_id: epicId },
      });

      // Standalone issue (should appear)
      await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Standalone', kind: 'issue' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/work-items?scope=triage',
      });
      const body = res.json() as { items: Array<{ title: string }> };
      expect(body.items.length).toBe(1);
      expect(body.items[0].title).toBe('Standalone');
    });
  });

  describe('Hierarchy validation via API', () => {
    it('rejects creating a child under a list', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Bad child', kind: 'issue', parent_id: list_id },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe('cannot create child under a list');
    });

    it('rejects list with parent', async () => {
      const init = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Init', kind: 'initiative' },
      });
      const initId = (init.json() as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/work-items',
        payload: { title: 'Bad list', kind: 'list', parent_id: initId },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe('list cannot have parent');
    });
  });
});
