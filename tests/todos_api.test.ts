import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

describe('Todos API (issue #108)', () => {
  const app = buildServer();
  let pool: Pool;
  let workItemId: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Create a work item for todos to attach to
    const created = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Work item with todos' },
    });
    workItemId = (created.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('GET /api/work-items/:id/todos', () => {
    it('returns empty array when no todos exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/todos`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ todos: [] });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/todos',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns todos ordered by creation date', async () => {
      // Create multiple todos
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/todos`,
        payload: { text: 'First todo' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/todos`,
        payload: { text: 'Second todo' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/todos`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { todos: Array<{ text: string }> };
      expect(body.todos.length).toBe(2);
      expect(body.todos[0].text).toBe('First todo');
      expect(body.todos[1].text).toBe('Second todo');
    });
  });

  describe('POST /api/work-items/:id/todos', () => {
    it('creates a new todo', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/todos`,
        payload: { text: 'New todo item' },
      });
      expect(res.statusCode).toBe(201);

      const body = res.json() as {
        id: string;
        text: string;
        completed: boolean;
        createdAt: string;
        completedAt: string | null;
      };
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(body.text).toBe('New todo item');
      expect(body.completed).toBe(false);
      expect(body.completedAt).toBeNull();
      expect(body.createdAt).toBeDefined();
    });

    it('returns 400 when text is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/todos`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'text is required' });
    });

    it('returns 400 when text is empty', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/todos`,
        payload: { text: '   ' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'text is required' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/todos',
        payload: { text: 'Todo for missing item' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });
  });

  describe('PATCH /api/work-items/:id/todos/:todoId', () => {
    let todoId: string;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/todos`,
        payload: { text: 'Original text' },
      });
      todoId = (created.json() as { id: string }).id;
    });

    it('updates todo text', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/todos/${todoId}`,
        payload: { text: 'Updated text' },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { text: string };
      expect(body.text).toBe('Updated text');
    });

    it('marks todo as completed and sets completedAt', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/todos/${todoId}`,
        payload: { completed: true },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { completed: boolean; completedAt: string | null };
      expect(body.completed).toBe(true);
      expect(body.completedAt).not.toBeNull();
    });

    it('marks todo as incomplete and clears completedAt', async () => {
      // First mark as complete
      await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/todos/${todoId}`,
        payload: { completed: true },
      });

      // Then mark as incomplete
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/todos/${todoId}`,
        payload: { completed: false },
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { completed: boolean; completedAt: string | null };
      expect(body.completed).toBe(false);
      expect(body.completedAt).toBeNull();
    });

    it('returns 404 for non-existent todo', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/todos/00000000-0000-0000-0000-000000000000`,
        payload: { text: 'Updated' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/00000000-0000-0000-0000-000000000000/todos/${todoId}`,
        payload: { text: 'Updated' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 400 when no update fields provided', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/work-items/${workItemId}/todos/${todoId}`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'at least one field is required' });
    });
  });

  describe('DELETE /api/work-items/:id/todos/:todoId', () => {
    let todoId: string;

    beforeEach(async () => {
      const created = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/todos`,
        payload: { text: 'Todo to delete' },
      });
      todoId = (created.json() as { id: string }).id;
    });

    it('deletes a todo', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId}/todos/${todoId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify it's deleted
      const list = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/todos`,
      });
      const body = list.json() as { todos: Array<{ id: string }> };
      expect(body.todos.find(t => t.id === todoId)).toBeUndefined();
    });

    it('returns 404 for non-existent todo', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId}/todos/00000000-0000-0000-0000-000000000000`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/00000000-0000-0000-0000-000000000000/todos/${todoId}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });
  });
});
