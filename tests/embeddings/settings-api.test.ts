/**
 * Tests for embedding settings API endpoints.
 * Part of Issue #231.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';
import { clearCachedProvider } from '../../src/api/embeddings/config.ts';

describe('Embedding Settings API Endpoints', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
    // Only set OpenAI key, ensure others are cleared
    delete process.env.VOYAGERAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-api-key';

    pool = createTestPool();
    await truncateAllTables(pool);

    // Reset usage data
    await pool.query('DELETE FROM embedding_usage');
    // Reset settings to defaults
    await pool.query(`
      UPDATE embedding_settings
      SET daily_limit_usd = 10.00,
          monthly_limit_usd = 100.00,
          pause_on_limit = true
      WHERE id = 1
    `);

    // Clear cached provider
    clearCachedProvider();

    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
    await app.close();
  });

  describe('GET /api/settings/embeddings', () => {
    it('returns embedding settings', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/embeddings',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body).toHaveProperty('provider');
      expect(body).toHaveProperty('available_providers');
      expect(body).toHaveProperty('budget');
      expect(body).toHaveProperty('usage');

      expect(body.available_providers).toHaveLength(3);
      expect(body.budget.daily_limit_usd).toBe(10);
      expect(body.budget.monthly_limit_usd).toBe(100);
    });

    it('includes current provider status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/embeddings',
      });

      const body = response.json();
      expect(body.provider).not.toBeNull();
      expect(body.provider.name).toBe('openai');
      expect(body.provider.status).toBe('active');
      expect(body.provider.key_source).toBe('environment');
    });

    it('includes usage statistics', async () => {
      // Add some usage
      await pool.query(`
        INSERT INTO embedding_usage (date, provider, request_count, token_count, estimated_cost_usd)
        VALUES (CURRENT_DATE, 'openai', 10, 50000, 1.50)
      `);

      const response = await app.inject({
        method: 'GET',
        url: '/api/settings/embeddings',
      });

      const body = response.json();
      expect(body.usage.today.count).toBe(10);
      expect(body.usage.today.tokens).toBe(50000);
      expect(body.budget.today_spend_usd).toBe(1.5);
    });
  });

  describe('PATCH /api/settings/embeddings', () => {
    it('updates daily limit', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/settings/embeddings',
        payload: { daily_limit_usd: 25 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.budget.daily_limit_usd).toBe(25);
    });

    it('updates monthly limit', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/settings/embeddings',
        payload: { monthly_limit_usd: 250 },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.budget.monthly_limit_usd).toBe(250);
    });

    it('updates pause on limit', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/settings/embeddings',
        payload: { pause_on_limit: false },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.budget.pause_on_limit).toBe(false);
    });

    it('updates multiple fields', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/settings/embeddings',
        payload: {
          daily_limit_usd: 50,
          monthly_limit_usd: 500,
          pause_on_limit: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.budget.daily_limit_usd).toBe(50);
      expect(body.budget.monthly_limit_usd).toBe(500);
      expect(body.budget.pause_on_limit).toBe(false);
    });

    it('rejects invalid daily limit', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/settings/embeddings',
        payload: { daily_limit_usd: -5 },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects daily limit over maximum', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/settings/embeddings',
        payload: { daily_limit_usd: 50000 },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects invalid monthly limit', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/settings/embeddings',
        payload: { monthly_limit_usd: -10 },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/settings/embeddings/test', () => {
    it('returns test result structure', async () => {
      // Note: This will likely fail in tests without real API key
      const response = await app.inject({
        method: 'POST',
        url: '/api/settings/embeddings/test',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('provider');

      // Without real API key, expect failure
      if (!body.success) {
        expect(body).toHaveProperty('error');
      }
    });
  });
});
