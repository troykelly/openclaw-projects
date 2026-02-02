/**
 * Embedding settings service.
 * Part of Issue #231.
 */

import type { Pool } from 'pg';
import {
  getConfigSummary,
  isProviderConfigured,
  loadApiKey,
} from './config.js';
import { PROVIDER_PRIORITY, PROVIDER_DETAILS, type EmbeddingProviderName } from './types.js';

/**
 * Provider status for settings response
 */
export interface ProviderStatus {
  name: EmbeddingProviderName;
  model: string;
  dimensions: number;
  status: 'active' | 'configured' | 'unconfigured';
  keySource: 'environment' | 'file' | 'command' | null;
}

/**
 * Available provider with configuration status
 */
export interface AvailableProvider {
  name: EmbeddingProviderName;
  configured: boolean;
  priority: number;
}

/**
 * Budget settings
 */
export interface BudgetSettings {
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  todaySpendUsd: number;
  monthSpendUsd: number;
  pauseOnLimit: boolean;
}

/**
 * Usage statistics
 */
export interface UsageStats {
  count: number;
  tokens: number;
}

/**
 * Full embedding settings response
 */
export interface EmbeddingSettingsResponse {
  provider: ProviderStatus | null;
  availableProviders: AvailableProvider[];
  budget: BudgetSettings;
  usage: {
    today: UsageStats;
    month: UsageStats;
    total: UsageStats;
  };
}

/**
 * Budget update request
 */
export interface BudgetUpdateRequest {
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  pauseOnLimit?: boolean;
}

/**
 * Provider cost per 1M tokens (approximate)
 */
const PROVIDER_COSTS: Record<EmbeddingProviderName, number> = {
  voyageai: 0.12, // $0.12 per 1M tokens
  openai: 0.13, // $0.13 per 1M tokens (text-embedding-3-large)
  gemini: 0.025, // $0.025 per 1M tokens
};

/**
 * Environment variable names for each provider's API key.
 */
const PROVIDER_ENV_VARS: Record<EmbeddingProviderName, string> = {
  voyageai: 'VOYAGERAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

/**
 * Determine the source of an API key
 */
function getKeySource(envVarBase: string): 'environment' | 'file' | 'command' | null {
  if (process.env[`${envVarBase}_COMMAND`]?.trim()) {
    return 'command';
  }
  if (process.env[`${envVarBase}_FILE`]?.trim()) {
    return 'file';
  }
  if (process.env[envVarBase]?.trim()) {
    return 'environment';
  }
  return null;
}

/**
 * Get the current provider status
 */
export function getProviderStatus(): ProviderStatus | null {
  const summary = getConfigSummary();

  if (!summary.provider) {
    return null;
  }

  const envVar = PROVIDER_ENV_VARS[summary.provider];
  const details = PROVIDER_DETAILS[summary.provider];

  return {
    name: summary.provider,
    model: details.model,
    dimensions: details.dimensions,
    status: 'active',
    keySource: getKeySource(envVar),
  };
}

/**
 * Get list of available providers with configuration status
 */
export function getAvailableProviders(): AvailableProvider[] {
  return PROVIDER_PRIORITY.map((name, index) => ({
    name,
    configured: isProviderConfigured(name),
    priority: index + 1,
  }));
}

/**
 * Get budget settings from database
 */
export async function getBudgetSettings(pool: Pool): Promise<BudgetSettings> {
  // Get settings
  const settingsResult = await pool.query(`
    SELECT daily_limit_usd, monthly_limit_usd, pause_on_limit
    FROM embedding_settings
    WHERE id = 1
  `);

  const settings = settingsResult.rows[0] || {
    daily_limit_usd: 10.0,
    monthly_limit_usd: 100.0,
    pause_on_limit: true,
  };

  // Get today's spend
  const todayResult = await pool.query(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
    FROM embedding_usage
    WHERE date = CURRENT_DATE
  `);

  // Get this month's spend
  const monthResult = await pool.query(`
    SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
    FROM embedding_usage
    WHERE date >= DATE_TRUNC('month', CURRENT_DATE)
  `);

  return {
    dailyLimitUsd: parseFloat(settings.daily_limit_usd),
    monthlyLimitUsd: parseFloat(settings.monthly_limit_usd),
    pauseOnLimit: settings.pause_on_limit,
    todaySpendUsd: parseFloat(todayResult.rows[0].total),
    monthSpendUsd: parseFloat(monthResult.rows[0].total),
  };
}

/**
 * Update budget settings
 */
export async function updateBudgetSettings(
  pool: Pool,
  updates: BudgetUpdateRequest
): Promise<BudgetSettings> {
  const fields: string[] = [];
  const values: (number | boolean)[] = [];
  let paramIndex = 1;

  if (updates.dailyLimitUsd !== undefined) {
    fields.push(`daily_limit_usd = $${paramIndex++}`);
    values.push(updates.dailyLimitUsd);
  }

  if (updates.monthlyLimitUsd !== undefined) {
    fields.push(`monthly_limit_usd = $${paramIndex++}`);
    values.push(updates.monthlyLimitUsd);
  }

  if (updates.pauseOnLimit !== undefined) {
    fields.push(`pause_on_limit = $${paramIndex++}`);
    values.push(updates.pauseOnLimit);
  }

  if (fields.length > 0) {
    await pool.query(
      `UPDATE embedding_settings SET ${fields.join(', ')} WHERE id = 1`,
      values
    );
  }

  return getBudgetSettings(pool);
}

/**
 * Get usage statistics
 */
export async function getUsageStats(pool: Pool): Promise<{
  today: UsageStats;
  month: UsageStats;
  total: UsageStats;
}> {
  // Today's usage
  const todayResult = await pool.query(`
    SELECT
      COALESCE(SUM(request_count), 0) as count,
      COALESCE(SUM(token_count), 0) as tokens
    FROM embedding_usage
    WHERE date = CURRENT_DATE
  `);

  // This month's usage
  const monthResult = await pool.query(`
    SELECT
      COALESCE(SUM(request_count), 0) as count,
      COALESCE(SUM(token_count), 0) as tokens
    FROM embedding_usage
    WHERE date >= DATE_TRUNC('month', CURRENT_DATE)
  `);

  // All time usage
  const totalResult = await pool.query(`
    SELECT
      COALESCE(SUM(request_count), 0) as count,
      COALESCE(SUM(token_count), 0) as tokens
    FROM embedding_usage
  `);

  return {
    today: {
      count: parseInt(todayResult.rows[0].count, 10),
      tokens: parseInt(todayResult.rows[0].tokens, 10),
    },
    month: {
      count: parseInt(monthResult.rows[0].count, 10),
      tokens: parseInt(monthResult.rows[0].tokens, 10),
    },
    total: {
      count: parseInt(totalResult.rows[0].count, 10),
      tokens: parseInt(totalResult.rows[0].tokens, 10),
    },
  };
}

/**
 * Get full embedding settings response
 */
export async function getEmbeddingSettings(
  pool: Pool
): Promise<EmbeddingSettingsResponse> {
  const [budget, usage] = await Promise.all([
    getBudgetSettings(pool),
    getUsageStats(pool),
  ]);

  return {
    provider: getProviderStatus(),
    availableProviders: getAvailableProviders(),
    budget,
    usage,
  };
}

/**
 * Record embedding usage
 */
export async function recordEmbeddingUsage(
  pool: Pool,
  provider: EmbeddingProviderName,
  tokens: number
): Promise<void> {
  const costPerMillion = PROVIDER_COSTS[provider];
  const costUsd = (tokens / 1_000_000) * costPerMillion;

  await pool.query(
    `SELECT increment_embedding_usage($1, $2, $3)`,
    [provider, tokens, costUsd]
  );
}

/**
 * Check if embeddings should be paused due to budget limits
 */
export async function isOverBudget(pool: Pool): Promise<{
  overDaily: boolean;
  overMonthly: boolean;
  shouldPause: boolean;
}> {
  const budget = await getBudgetSettings(pool);

  const overDaily = budget.todaySpendUsd >= budget.dailyLimitUsd;
  const overMonthly = budget.monthSpendUsd >= budget.monthlyLimitUsd;

  return {
    overDaily,
    overMonthly,
    shouldPause: budget.pauseOnLimit && (overDaily || overMonthly),
  };
}

/**
 * Test connection to the active provider
 */
export async function testProviderConnection(): Promise<{
  success: boolean;
  provider: EmbeddingProviderName | null;
  error?: string;
  latencyMs?: number;
}> {
  const summary = getConfigSummary();

  if (!summary.provider) {
    return {
      success: false,
      provider: null,
      error: 'No embedding provider configured',
    };
  }

  try {
    // Dynamic import to avoid circular dependencies
    const { createProvider } = await import('./providers/index.js');
    const provider = createProvider(summary.provider);

    const start = Date.now();
    await provider.embed(['test connection']);
    const latencyMs = Date.now() - start;

    return {
      success: true,
      provider: summary.provider,
      latencyMs,
    };
  } catch (error) {
    return {
      success: false,
      provider: summary.provider,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
