/**
 * Integration tests for meal log API (Issue #1279).
 *
 * Tests CRUD for meal log entries, search, and stats.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createTestPool } from './helpers/db.js';

const TEST_EMAIL = 'meal-log-test@example.com';

describe('Meal Log API (Issue #1279)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let pool: ReturnType<typeof createTestPool>;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildServer();

    await pool.query(`DELETE FROM meal_log WHERE namespace = 'default'`);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM meal_log WHERE namespace = 'default'`);
    await pool.end();
    await app.close();
  });

  // ─── Schema ────────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('meal_log table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'meal_log' ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('namespace');
      expect(columns).toContain('meal_date');
      expect(columns).toContain('meal_type');
      expect(columns).toContain('title');
      expect(columns).toContain('source');
      expect(columns).toContain('cuisine');
      expect(columns).toContain('who_ate');
      expect(columns).toContain('rating');
      expect(columns).toContain('leftovers_stored');
    });
  });

  // ─── POST /api/meal-log ─────────────────────────────────────────────

  describe('POST /api/meal-log', () => {
    it('logs a meal', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/meal-log',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          meal_date: '2026-02-15',
          meal_type: 'dinner',
          title: 'Pad Thai',
          source: 'ordered',
          cuisine: 'thai',
          restaurant: 'Thai Express',
          who_ate: ['alice', 'bob'],
          rating: 4,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe('Pad Thai');
      expect(body.source).toBe('ordered');
      expect(body.cuisine).toBe('thai');
    });

    it('returns 400 when title is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/meal-log',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { meal_date: '2026-02-15', meal_type: 'lunch', source: 'home_cooked' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('logs a home-cooked meal', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/meal-log',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          meal_date: '2026-02-14',
          meal_type: 'dinner',
          title: 'Spaghetti Bolognese',
          source: 'home_cooked',
          cuisine: 'italian',
          who_cooked: 'alice',
          who_ate: ['alice', 'bob'],
          rating: 5,
          leftovers_stored: true,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().leftovers_stored).toBe(true);
    });
  });

  // ─── GET /api/meal-log ──────────────────────────────────────────────

  describe('GET /api/meal-log', () => {
    it('lists recent meals', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/meal-log',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.meals).toBeDefined();
      expect(body.meals.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by cuisine', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/meal-log?cuisine=thai',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.meals.length).toBeGreaterThanOrEqual(1);
      for (const meal of body.meals) {
        expect(meal.cuisine).toBe('thai');
      }
    });

    it('filters by source', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/meal-log?source=home_cooked',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      for (const meal of res.json().meals) {
        expect(meal.source).toBe('home_cooked');
      }
    });

    it('filters by meal_type', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/meal-log?meal_type=dinner',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      for (const meal of res.json().meals) {
        expect(meal.meal_type).toBe('dinner');
      }
    });
  });

  // ─── GET /api/meal-log/:id ──────────────────────────────────────────

  describe('GET /api/meal-log/:id', () => {
    it('returns a specific meal entry', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/meal-log',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          meal_date: '2026-02-13',
          meal_type: 'lunch',
          title: 'Detail Test Meal',
          source: 'ate_out',
          restaurant: 'Cafe Roma',
        },
      });
      const mealId = createRes.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/meal-log/${mealId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(mealId);
      expect(res.json().title).toBe('Detail Test Meal');
    });

    it('returns 404 for non-existent meal', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/meal-log/00000000-0000-0000-0000-000000000099',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── PATCH /api/meal-log/:id ────────────────────────────────────────

  describe('PATCH /api/meal-log/:id', () => {
    it('updates meal fields', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/meal-log',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          meal_date: '2026-02-12',
          meal_type: 'snack',
          title: 'Update Test',
          source: 'other',
        },
      });
      const mealId = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/meal-log/${mealId}`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { rating: 3, notes: 'Pretty good actually' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().rating).toBe(3);
      expect(res.json().notes).toBe('Pretty good actually');
    });
  });

  // ─── DELETE /api/meal-log/:id ───────────────────────────────────────

  describe('DELETE /api/meal-log/:id', () => {
    it('deletes a meal entry', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/meal-log',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          meal_date: '2026-02-11',
          meal_type: 'breakfast',
          title: 'Delete Test',
          source: 'home_cooked',
        },
      });
      const mealId = createRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/meal-log/${mealId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 404 for non-existent meal', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/meal-log/00000000-0000-0000-0000-000000000099',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── GET /api/meal-log/stats ────────────────────────────────────────

  describe('GET /api/meal-log/stats', () => {
    it('returns meal statistics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/meal-log/stats',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBeDefined();
      expect(body.by_source).toBeDefined();
      expect(body.by_cuisine).toBeDefined();
    });
  });
});
