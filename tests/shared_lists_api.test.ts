/**
 * Integration tests for shared lists API (Issue #1277).
 *
 * Tests CRUD for lists and items, check/uncheck, reset, and merge operations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createTestPool } from './helpers/db.js';

const TEST_EMAIL = 'list-test@example.com';

describe('Shared Lists API (Issue #1277)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let pool: ReturnType<typeof createTestPool>;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildServer();

    await pool.query(`DELETE FROM list_item WHERE list_id IN (SELECT id FROM list WHERE user_email = $1)`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM list WHERE user_email = $1`, [TEST_EMAIL]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM list_item WHERE list_id IN (SELECT id FROM list WHERE user_email = $1)`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM list WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.end();
    await app.close();
  });

  // ─── Schema ────────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('list table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'list' ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('user_email');
      expect(columns).toContain('name');
      expect(columns).toContain('list_type');
      expect(columns).toContain('is_shared');
    });

    it('list_item table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'list_item' ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('list_id');
      expect(columns).toContain('name');
      expect(columns).toContain('quantity');
      expect(columns).toContain('category');
      expect(columns).toContain('is_checked');
      expect(columns).toContain('is_recurring');
    });
  });

  // ─── POST /api/lists ──────────────────────────────────────────────────

  describe('POST /api/lists', () => {
    it('creates a list', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Weekly Shopping', list_type: 'shopping' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Weekly Shopping');
      expect(body.list_type).toBe('shopping');
      expect(body.is_shared).toBe(true);
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── GET /api/lists ───────────────────────────────────────────────────

  describe('GET /api/lists', () => {
    it('lists all lists for the user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/lists',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.lists).toBeDefined();
      expect(body.lists.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── GET /api/lists/:id ───────────────────────────────────────────────

  describe('GET /api/lists/:id', () => {
    it('returns a list with its items', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Detail Test' },
      });
      const listId = createRes.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/lists/${listId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(listId);
      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('returns 404 for non-existent list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/lists/00000000-0000-0000-0000-000000000099',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /api/lists/:id/items ────────────────────────────────────────

  describe('POST /api/lists/:id/items', () => {
    it('adds items to a list', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Items Test' },
      });
      const listId = createRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          items: [
            { name: 'Milk', quantity: '2L', category: 'dairy' },
            { name: 'Bread', quantity: '1', category: 'bakery' },
            { name: 'Bananas', quantity: '1 bunch', category: 'produce' },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.items).toBeDefined();
      expect(body.items.length).toBe(3);
      expect(body.items[0].name).toBe('Milk');
    });

    it('returns 404 for non-existent list', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/lists/00000000-0000-0000-0000-000000000099/items',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { items: [{ name: 'Test' }] },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /api/lists/:id/items/check ──────────────────────────────────

  describe('POST /api/lists/:id/items/check', () => {
    it('checks off items by ID', async () => {
      // Create list with items
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Check Test' },
      });
      const listId = createRes.json().id;

      const addRes = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { items: [{ name: 'Eggs' }, { name: 'Butter' }] },
      });
      const itemIds = addRes.json().items.map((i: { id: string }) => i.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items/check`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { item_ids: [itemIds[0]] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.checked).toBe(1);
    });
  });

  // ─── POST /api/lists/:id/items/uncheck ────────────────────────────────

  describe('POST /api/lists/:id/items/uncheck', () => {
    it('unchecks items by ID', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Uncheck Test' },
      });
      const listId = createRes.json().id;

      const addRes = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { items: [{ name: 'Cheese' }] },
      });
      const itemId = addRes.json().items[0].id;

      // Check first
      await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items/check`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { item_ids: [itemId] },
      });

      // Then uncheck
      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items/uncheck`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { item_ids: [itemId] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.unchecked).toBe(1);
    });
  });

  // ─── POST /api/lists/:id/reset ────────────────────────────────────────

  describe('POST /api/lists/:id/reset', () => {
    it('resets a list: removes checked non-recurring, unchecks recurring', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Reset Test' },
      });
      const listId = createRes.json().id;

      // Add items: one recurring, one not
      const addRes = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          items: [
            { name: 'Milk', is_recurring: true },
            { name: 'Birthday cake', is_recurring: false },
          ],
        },
      });
      const items = addRes.json().items;
      const allIds = items.map((i: { id: string }) => i.id);

      // Check both
      await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/items/check`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { item_ids: allIds },
      });

      // Reset
      const res = await app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/reset`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.removed).toBeGreaterThanOrEqual(1); // Birthday cake removed
      expect(body.unchecked).toBeGreaterThanOrEqual(1); // Milk unchecked
    });
  });

  // ─── DELETE /api/lists/:id ────────────────────────────────────────────

  describe('DELETE /api/lists/:id', () => {
    it('deletes a list and its items', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/lists',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Delete Test' },
      });
      const listId = createRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/lists/${listId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 404 for non-existent list', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/lists/00000000-0000-0000-0000-000000000099',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
