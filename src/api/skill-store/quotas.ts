/**
 * Skill Store quotas and resource limits.
 *
 * Environment-variable-configurable limits with approximate count checks
 * for performance on high-volume tables.
 *
 * Part of Epic #794, Issue #805.
 */

import type { Pool } from 'pg';

/** Default quota values. */
const DEFAULTS = {
  maxItemsPerSkill: 100_000,
  maxCollectionsPerSkill: 1_000,
  maxSchedulesPerSkill: 20,
  maxItemSizeBytes: 1_048_576, // 1MB
} as const;

/** Quota configuration. */
export interface SkillStoreQuotaConfig {
  maxItemsPerSkill: number;
  maxCollectionsPerSkill: number;
  maxSchedulesPerSkill: number;
  maxItemSizeBytes: number;
}

/** Quota check result. */
export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
}

/** Quota usage for a skill. */
export interface SkillStoreQuotaUsage {
  skill_id: string;
  items: { current: number; limit: number };
  collections: { current: number; limit: number };
  schedules: { current: number; limit: number };
  maxItemSizeBytes: number;
}

/**
 * Parse a positive integer from an env var, falling back to a default.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Get the quota configuration from environment variables.
 * Accepts optional overrides (useful for testing).
 */
export function getSkillStoreQuotaConfig(
  overrides?: Partial<SkillStoreQuotaConfig>
): SkillStoreQuotaConfig {
  return {
    maxItemsPerSkill: overrides?.maxItemsPerSkill ?? envInt('SKILL_STORE_MAX_ITEMS_PER_SKILL', DEFAULTS.maxItemsPerSkill),
    maxCollectionsPerSkill: overrides?.maxCollectionsPerSkill ?? envInt('SKILL_STORE_MAX_COLLECTIONS_PER_SKILL', DEFAULTS.maxCollectionsPerSkill),
    maxSchedulesPerSkill: overrides?.maxSchedulesPerSkill ?? envInt('SKILL_STORE_MAX_SCHEDULES_PER_SKILL', DEFAULTS.maxSchedulesPerSkill),
    maxItemSizeBytes: overrides?.maxItemSizeBytes ?? envInt('SKILL_STORE_MAX_ITEM_SIZE_BYTES', DEFAULTS.maxItemSizeBytes),
  };
}

/**
 * Check if a skill has room for more items.
 *
 * Uses exact COUNT for correctness (the skill_id filter means the query
 * won't scan the whole table, just rows matching the index on skill_id).
 */
export async function checkItemQuota(
  pool: Pool,
  skillId: string,
  config?: Pick<SkillStoreQuotaConfig, 'maxItemsPerSkill'>
): Promise<QuotaCheckResult> {
  const limit = config?.maxItemsPerSkill ?? getSkillStoreQuotaConfig().maxItemsPerSkill;

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM skill_store_item
     WHERE skill_id = $1 AND deleted_at IS NULL`,
    [skillId]
  );

  const current = result.rows[0].count;
  return {
    allowed: current < limit,
    current,
    limit,
  };
}

/**
 * Check if a skill has room for a new collection.
 *
 * If the item is being added to an existing collection, it's always allowed.
 * Only checks the limit when creating a genuinely new collection.
 */
export async function checkCollectionQuota(
  pool: Pool,
  skillId: string,
  collection: string,
  config?: Pick<SkillStoreQuotaConfig, 'maxCollectionsPerSkill'>
): Promise<QuotaCheckResult> {
  const limit = config?.maxCollectionsPerSkill ?? getSkillStoreQuotaConfig().maxCollectionsPerSkill;

  // Check if collection already exists for this skill
  const existsResult = await pool.query(
    `SELECT 1 FROM skill_store_item
     WHERE skill_id = $1 AND collection = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [skillId, collection]
  );

  if (existsResult.rows.length > 0) {
    // Collection already exists, always allowed
    return { allowed: true, current: 0, limit };
  }

  // Count distinct collections
  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT collection)::int AS count
     FROM skill_store_item
     WHERE skill_id = $1 AND deleted_at IS NULL`,
    [skillId]
  );

  const current = countResult.rows[0].count;
  return {
    allowed: current < limit,
    current,
    limit,
  };
}

/**
 * Check if a skill has room for more schedules.
 */
export async function checkScheduleQuota(
  pool: Pool,
  skillId: string,
  config?: Pick<SkillStoreQuotaConfig, 'maxSchedulesPerSkill'>
): Promise<QuotaCheckResult> {
  const limit = config?.maxSchedulesPerSkill ?? getSkillStoreQuotaConfig().maxSchedulesPerSkill;

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM skill_store_schedule
     WHERE skill_id = $1`,
    [skillId]
  );

  const current = result.rows[0].count;
  return {
    allowed: current < limit,
    current,
    limit,
  };
}

/**
 * Get full quota usage for a skill.
 */
export async function getSkillStoreQuotaUsage(
  pool: Pool,
  skillId: string,
  config?: SkillStoreQuotaConfig
): Promise<SkillStoreQuotaUsage> {
  const quotaConfig = config ?? getSkillStoreQuotaConfig();

  // Run all counts in parallel for performance
  const [itemsResult, collectionsResult, schedulesResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM skill_store_item
       WHERE skill_id = $1 AND deleted_at IS NULL`,
      [skillId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT collection)::int AS count
       FROM skill_store_item
       WHERE skill_id = $1 AND deleted_at IS NULL`,
      [skillId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM skill_store_schedule
       WHERE skill_id = $1`,
      [skillId]
    ),
  ]);

  return {
    skill_id: skillId,
    items: {
      current: itemsResult.rows[0].count,
      limit: quotaConfig.maxItemsPerSkill,
    },
    collections: {
      current: collectionsResult.rows[0].count,
      limit: quotaConfig.maxCollectionsPerSkill,
    },
    schedules: {
      current: schedulesResult.rows[0].count,
      limit: quotaConfig.maxSchedulesPerSkill,
    },
    maxItemSizeBytes: quotaConfig.maxItemSizeBytes,
  };
}
