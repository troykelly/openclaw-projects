/**
 * Symphony orchestrator configuration loading.
 * Loads per-project config from `symphony_orchestrator_config`.
 * Issue #2195 — Symphony Worker Process Skeleton.
 */

import type { Pool } from 'pg';

/** Per-project orchestrator configuration stored in JSONB. */
export interface OrchestratorConfig {
  /** Maximum concurrent runs for this project. Default: 3. */
  maxConcurrentRuns: number;
  /** Maximum run duration in seconds. Default: 3600 (1 hour). */
  maxRunDurationSeconds: number;
  /** Poll interval in milliseconds. Default: 30000. */
  pollIntervalMs: number;
  /** Heartbeat interval in milliseconds. Default: 30000. */
  heartbeatIntervalMs: number;
  /** Lease duration for claims in seconds. Default: 600 (10 min). */
  leaseDurationSeconds: number;
  /** Whether to enable auto-retry on failure. Default: true. */
  autoRetry: boolean;
  /** Maximum retry attempts. Default: 3. */
  maxRetryAttempts: number;
  /** GitHub rate limit reserve (minimum calls to keep). Default: 100. */
  githubRateLimitReserve: number;
}

/** Default configuration values. */
const DEFAULTS: OrchestratorConfig = {
  maxConcurrentRuns: 3,
  maxRunDurationSeconds: 3600,
  pollIntervalMs: 30_000,
  heartbeatIntervalMs: 30_000,
  leaseDurationSeconds: 600,
  autoRetry: true,
  maxRetryAttempts: 3,
  githubRateLimitReserve: 100,
};

/** Stored config row from the database. */
interface ConfigRow {
  id: string;
  namespace: string;
  project_id: string | null;
  version: number;
  config: Record<string, unknown>;
}

/**
 * Load the latest orchestrator config for a project.
 * Falls back to namespace-level config (project_id IS NULL), then defaults.
 */
export async function loadConfig(
  pool: Pool,
  namespace: string,
  projectId?: string,
): Promise<{ config: OrchestratorConfig; version: number }> {
  // Try project-specific config first
  if (projectId) {
    const projectResult = await pool.query<ConfigRow>(
      `SELECT id, namespace, project_id, version, config
       FROM symphony_orchestrator_config
       WHERE namespace = $1 AND project_id = $2
       ORDER BY version DESC
       LIMIT 1`,
      [namespace, projectId],
    );

    if (projectResult.rows.length > 0) {
      return {
        config: mergeConfig(projectResult.rows[0].config),
        version: projectResult.rows[0].version,
      };
    }
  }

  // Fall back to namespace-level config
  const nsResult = await pool.query<ConfigRow>(
    `SELECT id, namespace, project_id, version, config
     FROM symphony_orchestrator_config
     WHERE namespace = $1 AND project_id IS NULL
     ORDER BY version DESC
     LIMIT 1`,
    [namespace],
  );

  if (nsResult.rows.length > 0) {
    return {
      config: mergeConfig(nsResult.rows[0].config),
      version: nsResult.rows[0].version,
    };
  }

  // Use defaults
  return { config: { ...DEFAULTS }, version: 0 };
}

/**
 * Merge stored JSONB config with defaults.
 * Only applies known keys; ignores unknown ones.
 */
function mergeConfig(stored: Record<string, unknown>): OrchestratorConfig {
  return {
    maxConcurrentRuns: typeof stored.maxConcurrentRuns === 'number'
      ? stored.maxConcurrentRuns
      : DEFAULTS.maxConcurrentRuns,
    maxRunDurationSeconds: typeof stored.maxRunDurationSeconds === 'number'
      ? stored.maxRunDurationSeconds
      : DEFAULTS.maxRunDurationSeconds,
    pollIntervalMs: typeof stored.pollIntervalMs === 'number'
      ? stored.pollIntervalMs
      : DEFAULTS.pollIntervalMs,
    heartbeatIntervalMs: typeof stored.heartbeatIntervalMs === 'number'
      ? stored.heartbeatIntervalMs
      : DEFAULTS.heartbeatIntervalMs,
    leaseDurationSeconds: typeof stored.leaseDurationSeconds === 'number'
      ? stored.leaseDurationSeconds
      : DEFAULTS.leaseDurationSeconds,
    autoRetry: typeof stored.autoRetry === 'boolean'
      ? stored.autoRetry
      : DEFAULTS.autoRetry,
    maxRetryAttempts: typeof stored.maxRetryAttempts === 'number'
      ? stored.maxRetryAttempts
      : DEFAULTS.maxRetryAttempts,
    githubRateLimitReserve: typeof stored.githubRateLimitReserve === 'number'
      ? stored.githubRateLimitReserve
      : DEFAULTS.githubRateLimitReserve,
  };
}

/** Get the default config (for tests and fallback). */
export function getDefaultConfig(): OrchestratorConfig {
  return { ...DEFAULTS };
}
