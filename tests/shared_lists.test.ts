/**
 * Tests for shared lists entity — shopping lists, checklists (Issue #1277).
 * TDD RED phase — tests define the desired API behaviour.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

describe('Shared lists API (Issue #1277)', () => {
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

  // ── POST /api/lists ────────────────────────────────────

  describe('POST /api/lists', () => {
    it('creates a list with name and default type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Weekly groceries' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Weekly groceries');
      expect(body.list_type).toBe('shopping');
      expect(body.is_shared).toBe(true);
      expect(body.created_at).toBeDefined();
    });

    it('creates a list with custom type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Camping gear', list_type: 'packing' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().list_type).toBe('packing');
    });

    it('rejects missing name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { list_type: 'shopping' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('name');
    });

    it('rejects empty name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: '   ' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/lists ─────────────────────────────────────

  describe('GET /api/lists', () => {
    it('lists all lists with pagination', async () => {
      await app.inject({ method: 'POST', url: '/api/lists', payload: { name: 'List A' } });
      await app.inject({ method: 'POST', url: '/api/lists', payload: { name: 'List B' } });

      const res = await app.inject({ method: 'GET', url: '/api/lists' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(2);
    });

    it('filters by list_type', async () => {
      await app.inject({ method: 'POST', url: '/api/lists', payload: { name: 'Groceries', list_type: 'shopping' } });
      await app.inject({ method: 'POST', url: '/api/lists', payload: { name: 'Camping', list_type: 'packing' } });

      const res = await app.inject({ method: 'GET', url: '/api/lists?list_type=shopping' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.items[0].name).toBe('Groceries');
    });
  });

  // ── GET /api/lists/:id ─────────────────────────────────

  describe('GET /api/lists/:id', () => {
    it('returns a list with its items', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Shopping' },
      });
      const listId = listRes.json().id;

      // Add an item
      await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Milk', quantity: '2L', category: 'dairy' },
      });

      const res = await app.inject({ method: 'GET', url: `/api/lists/${listId}` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe('Shopping');
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('Milk');
    });

    it('returns 404 for non-existent list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/lists/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /api/lists/:id ───────────────────────────────

  describe('PATCH /api/lists/:id', () => {
    it('updates list name', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Old name' },
      });
      const id = listRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/lists/${id}`,
        payload: { name: 'New name' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('New name');
    });

    it('returns 404 for non-existent list', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/lists/00000000-0000-0000-0000-000000000000',
        payload: { name: 'Updated' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/lists/:id ──────────────────────────────

  describe('DELETE /api/lists/:id', () => {
    it('deletes a list and its items', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Disposable' },
      });
      const id = listRes.json().id;

      await app.inject({
        method: 'POST',
        url: `/api/lists/${id}/items`,
        payload: { name: 'Item 1' },
      });

      const res = await app.inject({ method: 'DELETE', url: `/api/lists/${id}` });
      expect(res.statusCode).toBe(204);

      const getRes = await app.inject({ method: 'GET', url: `/api/lists/${id}` });
      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 for non-existent list', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/lists/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── List Items ─────────────────────────────────────────

  describe('POST /api/lists/:id/items', () => {
    it('adds an item to a list', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Shopping' },
      });
      const listId = listRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: {
          name: 'Bread',
          quantity: '1 loaf',
          category: 'bakery',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Bread');
      expect(body.quantity).toBe('1 loaf');
      expect(body.category).toBe('bakery');
      expect(body.is_checked).toBe(false);
      expect(body.is_recurring).toBe(false);
    });

    it('adds a recurring item', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Staples' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listRes.json().id}/items`,
        payload: { name: 'Milk', is_recurring: true },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().is_recurring).toBe(true);
    });

    it('rejects missing item name', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Shopping' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listRes.json().id}/items`,
        payload: { quantity: '1' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent list', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists/00000000-0000-0000-0000-000000000000/items',
        payload: { name: 'Ghost item' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/lists/:listId/items/:itemId', () => {
    it('updates item fields', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Shopping' },
      });
      const listId = listRes.json().id;

      const itemRes = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Eggs', quantity: '6' },
      });
      const itemId = itemRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/lists/${listId}/items/${itemId}`,
        payload: { quantity: '12', category: 'dairy' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().quantity).toBe('12');
      expect(res.json().category).toBe('dairy');
    });
  });

  describe('DELETE /api/lists/:listId/items/:itemId', () => {
    it('removes an item', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Shopping' },
      });
      const listId = listRes.json().id;

      const itemRes = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Butter' },
      });
      const itemId = itemRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/lists/${listId}/items/${itemId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const getRes = await app.inject({ method: 'GET', url: `/api/lists/${listId}` });
      expect(getRes.json().items).toHaveLength(0);
    });
  });

  // ── Check / Uncheck ────────────────────────────────────

  describe('POST /api/lists/:id/items/check', () => {
    it('checks off items by id', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Shopping' },
      });
      const listId = listRes.json().id;

      const item1 = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Milk' },
      });
      const item2 = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Bread' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items/check`,
        payload: { item_ids: [item1.json().id, item2.json().id] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().checked).toBe(2);

      // Verify items are checked
      const getRes = await app.inject({ method: 'GET', url: `/api/lists/${listId}` });
      const items = getRes.json().items;
      expect(items.every((i: { is_checked: boolean }) => i.is_checked)).toBe(true);
    });
  });

  describe('POST /api/lists/:id/items/uncheck', () => {
    it('unchecks items by id', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Shopping' },
      });
      const listId = listRes.json().id;

      const itemRes = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Milk' },
      });
      const itemId = itemRes.json().id;

      // Check it first
      await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items/check`,
        payload: { item_ids: [itemId] },
      });

      // Then uncheck
      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items/uncheck`,
        payload: { item_ids: [itemId] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().unchecked).toBe(1);

      const getRes = await app.inject({ method: 'GET', url: `/api/lists/${listId}` });
      expect(getRes.json().items[0].is_checked).toBe(false);
    });
  });

  // ── Reset ──────────────────────────────────────────────

  describe('POST /api/lists/:id/reset', () => {
    it('removes checked non-recurring items and unchecks recurring items', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Weekly shop' },
      });
      const listId = listRes.json().id;

      // Add recurring item (milk — always need it)
      const recurringRes = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Milk', is_recurring: true },
      });
      const milkId = recurringRes.json().id;

      // Add non-recurring item (special occasion cake)
      const oneOffRes = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Birthday cake', is_recurring: false },
      });
      const cakeId = oneOffRes.json().id;

      // Add unchecked non-recurring (should survive reset)
      await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Unchecked item', is_recurring: false },
      });

      // Check both milk and cake
      await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items/check`,
        payload: { item_ids: [milkId, cakeId] },
      });

      // Reset the list
      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/reset`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.removed).toBe(1); // cake removed
      expect(body.unchecked).toBe(1); // milk unchecked

      // Verify: milk still there but unchecked, cake gone, unchecked item still there
      const getRes = await app.inject({ method: 'GET', url: `/api/lists/${listId}` });
      const items = getRes.json().items;
      expect(items).toHaveLength(2);
      const names = items.map((i: { name: string }) => i.name);
      expect(names).toContain('Milk');
      expect(names).toContain('Unchecked item');
      expect(names).not.toContain('Birthday cake');
      const milk = items.find((i: { name: string }) => i.name === 'Milk');
      expect(milk.is_checked).toBe(false);
    });
  });

  // ── Merge ──────────────────────────────────────────────

  describe('POST /api/lists/:id/merge', () => {
    it('adds new items and updates quantity for existing items', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Shopping' },
      });
      const listId = listRes.json().id;

      // Add existing item
      await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        payload: { name: 'Onions', quantity: '2', category: 'produce' },
      });

      // Merge: update onions quantity, add new item
      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/merge`,
        payload: {
          items: [
            { name: 'Onions', quantity: '5', category: 'produce' },
            { name: 'Garlic', quantity: '1 head', category: 'produce' },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.added).toBe(1);
      expect(body.updated).toBe(1);

      // Verify
      const getRes = await app.inject({ method: 'GET', url: `/api/lists/${listId}` });
      const items = getRes.json().items;
      expect(items).toHaveLength(2);
      const onions = items.find((i: { name: string }) => i.name === 'Onions');
      expect(onions.quantity).toBe('5');
      const garlic = items.find((i: { name: string }) => i.name === 'Garlic');
      expect(garlic.quantity).toBe('1 head');
    });

    it('rejects empty items array', async () => {
      const listRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { name: 'Shopping' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listRes.json().id}/merge`,
        payload: { items: [] },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
