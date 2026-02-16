/**
 * Integration tests for recipes API (Issue #1278).
 *
 * Tests CRUD for recipes, ingredients, steps, search, and shopping list push.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { createTestPool } from './helpers/db.js';

const TEST_EMAIL = 'recipe-test@example.com';

describe('Recipes API (Issue #1278)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let pool: ReturnType<typeof createTestPool>;

  beforeAll(async () => {
    pool = createTestPool();
    app = await buildServer();

    // Clean up any leftover test data
    await pool.query(`DELETE FROM recipe_image WHERE recipe_id IN (SELECT id FROM recipe WHERE user_email = $1)`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM recipe_step WHERE recipe_id IN (SELECT id FROM recipe WHERE user_email = $1)`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM recipe_ingredient WHERE recipe_id IN (SELECT id FROM recipe WHERE user_email = $1)`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM recipe WHERE user_email = $1`, [TEST_EMAIL]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM recipe_image WHERE recipe_id IN (SELECT id FROM recipe WHERE user_email = $1)`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM recipe_step WHERE recipe_id IN (SELECT id FROM recipe WHERE user_email = $1)`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM recipe_ingredient WHERE recipe_id IN (SELECT id FROM recipe WHERE user_email = $1)`, [TEST_EMAIL]);
    await pool.query(`DELETE FROM recipe WHERE user_email = $1`, [TEST_EMAIL]);
    await pool.end();
    await app.close();
  });

  // ─── Schema ────────────────────────────────────────────────────────────

  describe('Schema', () => {
    it('recipe table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'recipe' ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('user_email');
      expect(columns).toContain('title');
      expect(columns).toContain('cuisine');
      expect(columns).toContain('meal_type');
      expect(columns).toContain('tags');
      expect(columns).toContain('rating');
      expect(columns).toContain('is_favourite');
    });

    it('recipe_ingredient table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'recipe_ingredient' ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('recipe_id');
      expect(columns).toContain('name');
      expect(columns).toContain('quantity');
      expect(columns).toContain('unit');
      expect(columns).toContain('category');
      expect(columns).toContain('is_optional');
    });

    it('recipe_step table exists with expected columns', async () => {
      const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'recipe_step' ORDER BY ordinal_position`,
      );
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toContain('id');
      expect(columns).toContain('recipe_id');
      expect(columns).toContain('step_number');
      expect(columns).toContain('instruction');
    });
  });

  // ─── POST /api/recipes ──────────────────────────────────────────────

  describe('POST /api/recipes', () => {
    it('creates a recipe with ingredients and steps', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recipes',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          title: 'Spaghetti Bolognese',
          cuisine: 'italian',
          servings: 4,
          prep_time_min: 15,
          cook_time_min: 45,
          total_time_min: 60,
          difficulty: 'medium',
          meal_type: ['dinner'],
          tags: ['comfort-food', 'batch-cook'],
          ingredients: [
            { name: 'Spaghetti', quantity: '400', unit: 'g', category: 'pantry' },
            { name: 'Minced beef', quantity: '500', unit: 'g', category: 'meat' },
            { name: 'Onion', quantity: '1', unit: 'piece', category: 'produce' },
          ],
          steps: [
            { step_number: 1, instruction: 'Boil water and cook spaghetti' },
            { step_number: 2, instruction: 'Brown the mince with onion' },
            { step_number: 3, instruction: 'Add sauce and simmer for 30 minutes' },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.title).toBe('Spaghetti Bolognese');
      expect(body.cuisine).toBe('italian');
      expect(body.ingredients).toHaveLength(3);
      expect(body.steps).toHaveLength(3);
    });

    it('returns 400 when title is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/recipes',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── GET /api/recipes ───────────────────────────────────────────────

  describe('GET /api/recipes', () => {
    it('lists all recipes for the user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recipes',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recipes).toBeDefined();
      expect(body.recipes.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by cuisine', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recipes?cuisine=italian',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recipes.length).toBeGreaterThanOrEqual(1);
      for (const recipe of body.recipes) {
        expect(recipe.cuisine).toBe('italian');
      }
    });

    it('filters by tag', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recipes?tag=comfort-food',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recipes.length).toBeGreaterThanOrEqual(1);
    });

    it('filters favourites only', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recipes?favourites=true',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      // No favourites yet, so empty is fine
      expect(res.json().recipes).toBeDefined();
    });
  });

  // ─── GET /api/recipes/:id ──────────────────────────────────────────

  describe('GET /api/recipes/:id', () => {
    it('returns a recipe with ingredients and steps', async () => {
      // Create a recipe first
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/recipes',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          title: 'Detail Test Recipe',
          ingredients: [{ name: 'Salt', quantity: '1', unit: 'tsp' }],
          steps: [{ step_number: 1, instruction: 'Add salt' }],
        },
      });
      const recipeId = createRes.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/recipes/${recipeId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(200);
      const recipe = res.json();
      expect(recipe.id).toBe(recipeId);
      expect(recipe.ingredients).toBeDefined();
      expect(recipe.steps).toBeDefined();
    });

    it('returns 404 for non-existent recipe', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/recipes/00000000-0000-0000-0000-000000000099',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── PATCH /api/recipes/:id ─────────────────────────────────────────

  describe('PATCH /api/recipes/:id', () => {
    it('updates recipe fields', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/recipes',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { title: 'Update Test' },
      });
      const recipeId = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/recipes/${recipeId}`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          title: 'Updated Title',
          rating: 4,
          is_favourite: true,
          notes: 'Great dish!',
        },
      });

      expect(res.statusCode).toBe(200);
      const recipe = res.json();
      expect(recipe.title).toBe('Updated Title');
      expect(recipe.rating).toBe(4);
      expect(recipe.is_favourite).toBe(true);
      expect(recipe.notes).toBe('Great dish!');
    });
  });

  // ─── DELETE /api/recipes/:id ────────────────────────────────────────

  describe('DELETE /api/recipes/:id', () => {
    it('deletes a recipe and cascades', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/recipes',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          title: 'Delete Test',
          ingredients: [{ name: 'Test' }],
          steps: [{ step_number: 1, instruction: 'Test' }],
        },
      });
      const recipeId = createRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/recipes/${recipeId}`,
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(204);

      // Verify cascade
      const check = await pool.query(`SELECT id FROM recipe_ingredient WHERE recipe_id = $1`, [recipeId]);
      expect(check.rows.length).toBe(0);
    });

    it('returns 404 for non-existent recipe', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/recipes/00000000-0000-0000-0000-000000000099',
        headers: { 'x-user-email': TEST_EMAIL },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /api/recipes/:id/to-shopping-list ─────────────────────────
  // Skipped: depends on `list` and `list_item` tables from the lists PR.

  describe.skip('POST /api/recipes/:id/to-shopping-list', () => {
    it('pushes recipe ingredients to a shopping list', async () => {
      // Create a list directly in DB (list routes are in a separate PR)
      const listResult = await pool.query(
        `INSERT INTO list (user_email, name, list_type, is_shared)
         VALUES ($1, 'Recipe Shopping', 'shopping', true)
         RETURNING id`,
        [TEST_EMAIL],
      );
      const listId = listResult.rows[0].id;

      // Create a recipe with ingredients
      const recipeRes = await app.inject({
        method: 'POST',
        url: '/api/recipes',
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: {
          title: 'Shopping List Test',
          ingredients: [
            { name: 'Chicken', quantity: '500', unit: 'g', category: 'meat' },
            { name: 'Rice', quantity: '300', unit: 'g', category: 'pantry' },
          ],
        },
      });
      const recipeId = recipeRes.json().id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/recipes/${recipeId}/to-shopping-list`,
        headers: { 'content-type': 'application/json', 'x-user-email': TEST_EMAIL },
        payload: { list_id: listId },
      });

      expect(res.statusCode).toBe(200);
      const result = res.json();
      expect(result.added).toBe(2);

      // Verify items in list directly via DB
      const itemsResult = await pool.query(
        `SELECT name FROM list_item WHERE list_id = $1 ORDER BY name`,
        [listId],
      );
      expect(itemsResult.rows.length).toBe(2);
      expect(itemsResult.rows.map((r) => r.name)).toContain('Chicken');
      expect(itemsResult.rows.map((r) => r.name)).toContain('Rice');
    });
  });
});
