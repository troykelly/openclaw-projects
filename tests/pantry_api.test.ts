/**
 * Integration tests for pantry inventory API (Issue #1280).
 *
 * Tests CRUD for pantry items, leftovers, use/deplete, and expiring items.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createTestPool } from './helpers/db.js';

const TEST_EMAIL = 'pantry-test@example.com';

describe('Pantry Inventory API (Issue #1280)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let pool: ReturnType<typeof createTestPool>;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildServer();

    await pool.query(`DELETE FROM pantry_item WHERE user_email = $1`, [TEST_EMAIL]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM pantry_item WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.end();
    await app.close();
  });

  // ─── Schema ────────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('pantry_item table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'pantry_item' ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('user_email');
      expect(columns).toContain('name');
      expect(columns).toContain('location');
      expect(columns).toContain('category');
      expect(columns).toContain('is_leftover');
      expect(columns).toContain('use_by_date');
      expect(columns).toContain('use_soon');
      expect(columns).toContain('is_depleted');
    });
  });

  // ─── POST /api/pantry ───────────────────────────────────────────────

  describe('POST /api/pantry', () => {
    it('adds a pantry item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'Chicken thighs',
          location: 'fridge',
          quantity: '500g',
          category: 'meat',
          use_by_date: '2026-02-18',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Chicken thighs');
      expect(body.location).toBe('fridge');
      expect(body.is_depleted).toBe(false);
    });

    it('adds a leftover item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'Leftover Bolognese',
          location: 'fridge',
          is_leftover: true,
          leftover_dish: 'Spaghetti Bolognese',
          leftover_portions: 2,
          category: 'leftover',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().is_leftover).toBe(true);
      expect(res.json().leftover_dish).toBe('Spaghetti Bolognese');
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { location: 'pantry' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── GET /api/pantry ────────────────────────────────────────────────

  describe('GET /api/pantry', () => {
    it('lists active pantry items (not depleted)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/pantry',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeDefined();
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      for (const item of body.items) {
        expect(item.is_depleted).toBe(false);
      }
    });

    it('filters by location', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/pantry?location=fridge',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      for (const item of res.json().items) {
        expect(item.location).toBe('fridge');
      }
    });

    it('filters leftovers only', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/pantry?leftovers=true',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      for (const item of res.json().items) {
        expect(item.is_leftover).toBe(true);
      }
    });
  });

  // ─── PATCH /api/pantry/:id ──────────────────────────────────────────

  describe('PATCH /api/pantry/:id', () => {
    it('updates pantry item fields', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Update Test', location: 'pantry' },
      });
      const itemId = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/pantry/${itemId}`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { quantity: '300g', use_soon: true, notes: 'Use before weekend' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().quantity).toBe('300g');
      expect(res.json().use_soon).toBe(true);
      expect(res.json().notes).toBe('Use before weekend');
    });
  });

  // ─── POST /api/pantry/use ───────────────────────────────────────────

  describe('POST /api/pantry/use', () => {
    it('marks items as depleted', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Use Test', location: 'fridge', category: 'dairy' },
      });
      const itemId = createRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/pantry/use',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { item_ids: [itemId] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().depleted).toBe(1);

      // Verify item is depleted
      const check = await pool.query(`SELECT is_depleted FROM pantry_item WHERE id = $1`, [itemId]);
      expect(check.rows[0].is_depleted).toBe(true);
    });
  });

  // ─── GET /api/pantry/expiring ───────────────────────────────────────

  describe('GET /api/pantry/expiring', () => {
    it('returns items expiring within N days', async () => {
      // Add an item expiring soon
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          name: 'Expiring Milk',
          location: 'fridge',
          category: 'dairy',
          use_by_date: '2026-02-16',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/pantry/expiring?days=3',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toBeDefined();
      // At least the milk should show up (expiring within 3 days of 2026-02-15)
      expect(body.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── DELETE /api/pantry/:id ─────────────────────────────────────────

  describe('DELETE /api/pantry/:id', () => {
    it('deletes a pantry item', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { name: 'Delete Test', location: 'counter' },
      });
      const itemId = createRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/pantry/${itemId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 404 for non-existent item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/pantry/00000000-0000-0000-0000-000000000099',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
