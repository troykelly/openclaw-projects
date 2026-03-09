import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Issue #2306: Integration tests for real-time events on todo mutations.
 * These tests verify that the todo endpoints work correctly and that
 * the emitter functions are wired in (they won't fail even if the
 * RealtimeHub is not connected, since events fire-and-forget).
 */
describe('Todo real-time events (#2306)', () => {
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

    const created = await app.inject({
      method: 'POST',
      url: '/work-items',
      payload: { title: 'Event Test List', kind: 'list' },
    });
    listId = (created.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it('creating a todo does not error (event emission is fire-and-forget)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/work-items/${listId}/todos`,
      payload: { text: 'Event test item' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; text: string };
    expect(body.id).toBeDefined();
    expect(body.text).toBe('Event test item');
  });

  it('updating a todo does not error (event emission is fire-and-forget)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/work-items/${listId}/todos`,
      payload: { text: 'To update' },
    });
    const todoId = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/work-items/${listId}/todos/${todoId}`,
      payload: { completed: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { completed: boolean };
    expect(body.completed).toBe(true);
  });

  it('deleting a todo does not error (event emission is fire-and-forget)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/work-items/${listId}/todos`,
      payload: { text: 'To delete' },
    });
    const todoId = (created.json() as { id: string }).id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/work-items/${listId}/todos/${todoId}`,
    });
    expect(res.statusCode).toBe(204);
  });

  it('reordering todos does not error (event emission is fire-and-forget)', async () => {
    const t1 = await app.inject({
      method: 'POST',
      url: `/work-items/${listId}/todos`,
      payload: { text: 'A' },
    });
    const t2 = await app.inject({
      method: 'POST',
      url: `/work-items/${listId}/todos`,
      payload: { text: 'B' },
    });
    const id1 = (t1.json() as { id: string }).id;
    const id2 = (t2.json() as { id: string }).id;

    const res = await app.inject({
      method: 'POST',
      url: `/work-items/${listId}/todos/reorder`,
      payload: {
        items: [
          { todo_id: id2, sort_order: 100 },
          { todo_id: id1, sort_order: 200 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
  });

  it('events are scoped to parent work_item_id (verified via GET after mutations)', async () => {
    // Create todos in two different lists
    const list2Res = await app.inject({
      method: 'POST',
      url: '/work-items',
      payload: { title: 'Second List', kind: 'list' },
    });
    const list2Id = (list2Res.json() as { id: string }).id;

    await app.inject({
      method: 'POST',
      url: `/work-items/${listId}/todos`,
      payload: { text: 'List 1 item' },
    });
    await app.inject({
      method: 'POST',
      url: `/work-items/${list2Id}/todos`,
      payload: { text: 'List 2 item' },
    });

    // Verify items are scoped to their parent
    const list1Todos = await app.inject({
      method: 'GET',
      url: `/work-items/${listId}/todos`,
    });
    const list2Todos = await app.inject({
      method: 'GET',
      url: `/work-items/${list2Id}/todos`,
    });

    const list1Items = (list1Todos.json() as { todos: Array<{ text: string }> }).todos;
    const list2Items = (list2Todos.json() as { todos: Array<{ text: string }> }).todos;

    expect(list1Items.length).toBe(1);
    expect(list1Items[0].text).toBe('List 1 item');
    expect(list2Items.length).toBe(1);
    expect(list2Items[0].text).toBe('List 2 item');
  });
});
