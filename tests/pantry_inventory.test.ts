import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Pantry/Fridge/Freezer Inventory API endpoints (issue #1280).
 */
describe('Pantry Inventory API', () => {
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

  // ── Schema ──────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('pantry_item table exists with expected columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'pantry_item'
        ORDER BY ordinal_position
      `);
      const cols = result.rows.map((r: { column_name: string }) => r.column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('namespace');
      expect(cols).toContain('name');
      expect(cols).toContain('location');
      expect(cols).toContain('quantity');
      expect(cols).toContain('category');
      expect(cols).toContain('is_leftover');
      expect(cols).toContain('leftover_dish');
      expect(cols).toContain('leftover_portions');
      expect(cols).toContain('meal_log_id');
      expect(cols).toContain('added_date');
      expect(cols).toContain('use_by_date');
      expect(cols).toContain('use_soon');
      expect(cols).toContain('notes');
      expect(cols).toContain('is_depleted');
      expect(cols).toContain('depleted_at');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });
  });

  // ── POST /api/pantry ────────────────────────────────────────────────

  describe('POST /api/pantry', () => {
    it('creates a pantry item with required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Milk', location: 'fridge' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Milk');
      expect(body.location).toBe('fridge');
      expect(body.is_leftover).toBe(false);
      expect(body.is_depleted).toBe(false);
      expect(body.use_soon).toBe(false);
    });

    it('creates a pantry item with all optional fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: {
          name: 'Chicken Thighs',
          location: 'freezer',
          quantity: '500g',
          category: 'meat',
          use_by_date: '2026-02-20',
          use_soon: true,
          notes: 'Bought from butcher',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe('Chicken Thighs');
      expect(body.location).toBe('freezer');
      expect(body.quantity).toBe('500g');
      expect(body.category).toBe('meat');
      expect(body.use_by_date).toContain('2026-02-20');
      expect(body.use_soon).toBe(true);
      expect(body.notes).toBe('Bought from butcher');
    });

    it('creates a leftover entry', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: {
          name: 'Leftover Curry',
          location: 'fridge',
          is_leftover: true,
          leftover_dish: 'Thai Green Curry',
          leftover_portions: 3,
          category: 'leftover',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.is_leftover).toBe(true);
      expect(body.leftover_dish).toBe('Thai Green Curry');
      expect(body.leftover_portions).toBe(3);
    });

    it('rejects request missing name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { location: 'fridge' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects request missing location', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Milk' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /api/pantry ─────────────────────────────────────────────────

  describe('GET /api/pantry', () => {
    it('returns empty array when no items exist', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/pantry' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns non-depleted items by default', async () => {
      // Create two items
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Milk', location: 'fridge' },
      });
      const created = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Old Cheese', location: 'fridge' },
      });
      const cheeseId = created.json().id;

      // Deplete the cheese
      await app.inject({
        method: 'POST',
        url: `/api/pantry/${cheeseId}/deplete`,
      });

      const res = await app.inject({ method: 'GET', url: '/api/pantry' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].name).toBe('Milk');
    });

    it('filters by location', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Milk', location: 'fridge' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Rice', location: 'pantry' },
      });

      const res = await app.inject({ method: 'GET', url: '/api/pantry?location=fridge' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].name).toBe('Milk');
    });

    it('filters by category', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Milk', location: 'fridge', category: 'dairy' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Chicken', location: 'fridge', category: 'meat' },
      });

      const res = await app.inject({ method: 'GET', url: '/api/pantry?category=dairy' });
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].name).toBe('Milk');
    });

    it('filters for leftovers only', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Milk', location: 'fridge' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Leftover Pasta', location: 'fridge', is_leftover: true, leftover_dish: 'Bolognese' },
      });

      const res = await app.inject({ method: 'GET', url: '/api/pantry?leftovers_only=true' });
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].name).toBe('Leftover Pasta');
    });

    it('filters for use_soon items', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Milk', location: 'fridge' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Yogurt', location: 'fridge', use_soon: true },
      });

      const res = await app.inject({ method: 'GET', url: '/api/pantry?use_soon_only=true' });
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].name).toBe('Yogurt');
    });

    it('includes depleted items when include_depleted=true', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Used Up Milk', location: 'fridge' },
      });
      const id = created.json().id;
      await app.inject({ method: 'POST', url: `/api/pantry/${id}/deplete` });

      const res = await app.inject({ method: 'GET', url: '/api/pantry?include_depleted=true' });
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].is_depleted).toBe(true);
    });
  });

  // ── GET /api/pantry/:id ─────────────────────────────────────────────

  describe('GET /api/pantry/:id', () => {
    it('returns a single item by id', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Eggs', location: 'fridge', quantity: '12' },
      });
      const { id } = created.json();

      const res = await app.inject({ method: 'GET', url: `/api/pantry/${id}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(id);
      expect(body.name).toBe('Eggs');
    });

    it('returns 404 for non-existent item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/pantry/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /api/pantry/:id ───────────────────────────────────────────

  describe('PATCH /api/pantry/:id', () => {
    it('updates item fields', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Milk', location: 'fridge', quantity: '1L' },
      });
      const { id } = created.json();

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/pantry/${id}`,
        payload: { quantity: '500ml', use_soon: true, notes: 'Running low' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.quantity).toBe('500ml');
      expect(body.use_soon).toBe(true);
      expect(body.notes).toBe('Running low');
    });

    it('returns 404 for non-existent item', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/pantry/00000000-0000-0000-0000-000000000000',
        payload: { quantity: '2' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── POST /api/pantry/:id/deplete ────────────────────────────────────

  describe('POST /api/pantry/:id/deplete', () => {
    it('marks item as depleted', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Butter', location: 'fridge' },
      });
      const { id } = created.json();

      const res = await app.inject({
        method: 'POST',
        url: `/api/pantry/${id}/deplete`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.is_depleted).toBe(true);
      expect(body.depleted_at).toBeDefined();
    });
  });

  // ── DELETE /api/pantry/:id ──────────────────────────────────────────

  describe('DELETE /api/pantry/:id', () => {
    it('hard-deletes a pantry item', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Expired Yogurt', location: 'fridge' },
      });
      const { id } = created.json();

      const res = await app.inject({ method: 'DELETE', url: `/api/pantry/${id}` });
      expect(res.statusCode).toBe(204);

      const check = await app.inject({ method: 'GET', url: `/api/pantry/${id}` });
      expect(check.statusCode).toBe(404);
    });
  });

  // ── GET /api/pantry/expiring ────────────────────────────────────────

  describe('GET /api/pantry/expiring', () => {
    it('returns items expiring within N days', async () => {
      // Item expiring tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Yogurt', location: 'fridge', use_by_date: tomorrowStr },
      });

      // Item expiring in 30 days (should not appear for days=3)
      const farDate = new Date();
      farDate.setDate(farDate.getDate() + 30);
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Canned Beans', location: 'pantry', use_by_date: farDate.toISOString().split('T')[0] },
      });

      // Item with no use_by_date (should not appear)
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Salt', location: 'pantry' },
      });

      const res = await app.inject({ method: 'GET', url: '/api/pantry/expiring?days=3' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].name).toBe('Yogurt');
    });

    it('defaults to 7 days when no days param', async () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 5);
      await app.inject({
        method: 'POST',
        url: '/api/pantry',
        payload: { name: 'Cream', location: 'fridge', use_by_date: soon.toISOString().split('T')[0] },
      });

      const res = await app.inject({ method: 'GET', url: '/api/pantry/expiring' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.length).toBe(1);
    });
  });
});
