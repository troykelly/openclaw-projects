/**
 * Tests for embedding settings service.
 * Part of Issue #231.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';
import {
  getProviderStatus,
  getAvailableProviders,
  getBudgetSettings,
  updateBudgetSettings,
  getUsageStats,
  getEmbeddingSettings,
  recordEmbeddingUsage,
  isOverBudget,
} from '../../src/api/embeddings/settings.ts';
import { clearCachedProvider } from '../../src/api/embeddings/config.ts';

describe('Embedding Settings Service', () => {
  let pool: Pool;
  const originalEnv = process.env;

  beforeAll(async () => {
    await runMigrate('up');
  });

  beforeEach(async () => {
    // Reset environment
    process.env = { ...originalEnv };

    pool = createTestPool();
    await truncateAllTables(pool);

    // Reset singleton (Note: the settings table is a singleton, don't truncate)
    // Reset usage data
    await pool.query('DELETE FROM embedding_usage');
    // Reset settings to defaults (upsert to guarantee the singleton row exists)
    await pool.query(`
      INSERT INTO embedding_settings (id, daily_limit_usd, monthly_limit_usd, pause_on_limit)
      VALUES (1, 10.00, 100.00, true)
      ON CONFLICT (id) DO UPDATE
        SET daily_limit_usd = 10.00,
            monthly_limit_usd = 100.00,
            pause_on_limit = true
    `);
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
  });

  describe('getProviderStatus', () => {
    it('returns null when no provider is configured', () => {
      // Ensure no API keys are set
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      // Clear cached provider to force re-evaluation
      clearCachedProvider();
      clearCachedProvider();

      const status = getProviderStatus();
      expect(status).toBeNull();
    });

    it('returns active provider when configured', () => {
      // Only set OpenAI key, clear others
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';

      clearCachedProvider();

      const status = getProviderStatus();
      expect(status).not.toBeNull();
      expect(status?.name).toBe('openai');
      expect(status?.status).toBe('active');
      expect(status?.key_source).toBe('environment');
    });
  });

  describe('getAvailableProviders', () => {
    it('returns all providers with configuration status', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      delete process.env.VOYAGERAI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const providers = getAvailableProviders();
      expect(providers).toHaveLength(3);
      expect(providers[0].name).toBe('voyageai');
      expect(providers[0].configured).toBe(false);
      expect(providers[0].priority).toBe(1);

      expect(providers[1].name).toBe('openai');
      expect(providers[1].configured).toBe(true);
      expect(providers[1].priority).toBe(2);

      expect(providers[2].name).toBe('gemini');
      expect(providers[2].configured).toBe(false);
      expect(providers[2].priority).toBe(3);
    });
  });

  describe('getBudgetSettings', () => {
    it('returns default budget settings', async () => {
      const budget = await getBudgetSettings(pool);
      expect(budget.daily_limit_usd).toBe(10.0);
      expect(budget.monthly_limit_usd).toBe(100.0);
      expect(budget.pause_on_limit).toBe(true);
      expect(budget.today_spend_usd).toBe(0);
      expect(budget.month_spend_usd).toBe(0);
    });

    it('calculates spend from usage data', async () => {
      // Insert some usage data
      await pool.query(`
        INSERT INTO embedding_usage (date, provider, request_count, token_count, estimated_cost_usd)
        VALUES (CURRENT_DATE, 'openai', 10, 50000, 1.50)
      `);

      const budget = await getBudgetSettings(pool);
      expect(budget.today_spend_usd).toBe(1.5);
      expect(budget.month_spend_usd).toBe(1.5);
    });
  });

  describe('updateBudgetSettings', () => {
    it('updates daily limit', async () => {
      const updated = await updateBudgetSettings(pool, { daily_limit_usd: 25.0 });
      expect(updated.daily_limit_usd).toBe(25.0);
    });

    it('updates monthly limit', async () => {
      const updated = await updateBudgetSettings(pool, { monthly_limit_usd: 250.0 });
      expect(updated.monthly_limit_usd).toBe(250.0);
    });

    it('updates pause on limit', async () => {
      const updated = await updateBudgetSettings(pool, { pause_on_limit: false });
      expect(updated.pause_on_limit).toBe(false);
    });

    it('updates multiple fields at once', async () => {
      const updated = await updateBudgetSettings(pool, {
        daily_limit_usd: 50.0,
        monthly_limit_usd: 500.0,
        pause_on_limit: false,
      });
      expect(updated.daily_limit_usd).toBe(50.0);
      expect(updated.monthly_limit_usd).toBe(500.0);
      expect(updated.pause_on_limit).toBe(false);
    });
  });

  describe('getUsageStats', () => {
    it('returns zero stats when no usage', async () => {
      const stats = await getUsageStats(pool);
      expect(stats.today.count).toBe(0);
      expect(stats.today.tokens).toBe(0);
      expect(stats.month.count).toBe(0);
      expect(stats.month.tokens).toBe(0);
      expect(stats.total.count).toBe(0);
      expect(stats.total.tokens).toBe(0);
    });

    it('aggregates usage across providers', async () => {
      await pool.query(`
        INSERT INTO embedding_usage (date, provider, request_count, token_count, estimated_cost_usd)
        VALUES
          (CURRENT_DATE, 'openai', 10, 50000, 1.00),
          (CURRENT_DATE, 'voyageai', 5, 25000, 0.50)
      `);

      const stats = await getUsageStats(pool);
      expect(stats.today.count).toBe(15);
      expect(stats.today.tokens).toBe(75000);
    });
  });

  describe('recordEmbeddingUsage', () => {
    it('records new usage', async () => {
      await recordEmbeddingUsage(pool, 'openai', 10000);

      const result = await pool.query('SELECT * FROM embedding_usage WHERE date = CURRENT_DATE AND provider = $1', ['openai']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].request_count).toBe(1);
      expect(result.rows[0].token_count).toBe('10000');
    });

    it('increments existing usage', async () => {
      await recordEmbeddingUsage(pool, 'openai', 10000);
      await recordEmbeddingUsage(pool, 'openai', 5000);

      const result = await pool.query('SELECT * FROM embedding_usage WHERE date = CURRENT_DATE AND provider = $1', ['openai']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].request_count).toBe(2);
      expect(result.rows[0].token_count).toBe('15000');
    });
  });

  describe('isOverBudget', () => {
    it('returns false when under budget', async () => {
      const status = await isOverBudget(pool);
      expect(status.over_daily).toBe(false);
      expect(status.over_monthly).toBe(false);
      expect(status.should_pause).toBe(false);
    });

    it('returns true when over daily limit', async () => {
      // Set low daily limit
      await updateBudgetSettings(pool, { daily_limit_usd: 1.0 });

      // Add usage exceeding limit
      await pool.query(`
        INSERT INTO embedding_usage (date, provider, request_count, token_count, estimated_cost_usd)
        VALUES (CURRENT_DATE, 'openai', 100, 1000000, 1.50)
      `);

      const status = await isOverBudget(pool);
      expect(status.over_daily).toBe(true);
      expect(status.should_pause).toBe(true);
    });

    it('respects pause_on_limit setting', async () => {
      // Disable pause on limit
      await updateBudgetSettings(pool, { daily_limit_usd: 1.0, pause_on_limit: false });

      // Add usage exceeding limit
      await pool.query(`
        INSERT INTO embedding_usage (date, provider, request_count, token_count, estimated_cost_usd)
        VALUES (CURRENT_DATE, 'openai', 100, 1000000, 1.50)
      `);

      const status = await isOverBudget(pool);
      expect(status.over_daily).toBe(true);
      expect(status.should_pause).toBe(false);
    });
  });

  describe('getEmbeddingSettings', () => {
    it('returns complete settings response', async () => {
      process.env.OPENAI_API_KEY = 'test-key';

      clearCachedProvider();
      clearCachedProvider();

      const settings = await getEmbeddingSettings(pool);

      expect(settings.provider).not.toBeNull();
      expect(settings.available_providers).toHaveLength(3);
      expect(settings.budget).toHaveProperty('daily_limit_usd');
      expect(settings.budget).toHaveProperty('monthly_limit_usd');
      expect(settings.usage).toHaveProperty('today');
      expect(settings.usage).toHaveProperty('month');
      expect(settings.usage).toHaveProperty('total');
    });
  });
});
