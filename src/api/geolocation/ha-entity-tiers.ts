/**
 * Entity tier resolver for Home Assistant entities.
 *
 * Determines how each HA entity should be treated in the observation pipeline
 * based on configurable tier assignments. Tiers control whether an entity is
 * ignored, routed to geo-only processing, logged without scoring, fully triaged,
 * or immediately escalated.
 *
 * Resolution priority (highest to lowest):
 *   1. Exact entity_id match
 *   2. Glob pattern match (highest priority value wins)
 *   3. Domain match (highest priority value wins)
 *   4. Hardcoded defaults
 *
 * Per-namespace overrides from `ha_entity_tier_config` are cached in memory
 * with a 5-minute TTL to avoid repeated DB lookups.
 *
 * Issue #1451, Epic #1440.
 */

import picomatch from 'picomatch';

// ---------- public types ----------

/** Classification tiers for HA entities. */
export type EntityTier = 'ignore' | 'geo' | 'log_only' | 'triage' | 'escalate';

/** A single tier configuration rule. */
export interface TierRule {
  tier: EntityTier;
  domain?: string;
  entity_pattern?: string;
  entity_id?: string;
  priority: number;
}

/** Resolved tier result including the matched rule source. */
export interface ResolvedTier {
  tier: EntityTier;
  source: 'entity_id' | 'pattern' | 'domain' | 'default';
}

// ---------- default tier mappings ----------

/** Domains dropped at the router level — never stored or scored. */
const IGNORE_DOMAINS: ReadonlySet<string> = new Set([
  'geo_location',
  'update',
  'image',
  'button',
  'number',
  'select',
  'text',
  'input_number',
  'input_select',
  'input_text',
  'scene',
  'script',
  'automation',
  'group',
  'zone',
]);

/** Domains routed only to the geo ingestor. */
const GEO_DOMAINS: ReadonlySet<string> = new Set(['device_tracker', 'person']);

/** Sensor patterns stored as raw observations with score = 0. */
const LOG_ONLY_PATTERNS: readonly string[] = [
  'sensor.*_battery',
  'sensor.*_battery_level',
  'sensor.*_linkquality',
  'sensor.*_signal_strength',
  'sensor.*_signal',
  'sensor.*_rssi',
];

/** Domains receiving full scoring via the triage pipeline. */
const TRIAGE_DOMAINS: ReadonlySet<string> = new Set([
  'light',
  'switch',
  'binary_sensor',
  'climate',
  'media_player',
  'lock',
  'cover',
  'fan',
  'vacuum',
  'input_boolean',
]);

/** Domains that always receive score 10 (immediate escalation). */
const ESCALATE_DOMAINS: ReadonlySet<string> = new Set(['alarm_control_panel']);

/** Sensor patterns that always receive score 10 (immediate escalation). */
const ESCALATE_PATTERNS: readonly string[] = [
  'sensor.*water_leak*',
  'sensor.*smoke*',
  'sensor.*gas*',
  'binary_sensor.*water_leak*',
  'binary_sensor.*smoke*',
  'binary_sensor.*gas*',
];

// ---------- cache entry ----------

interface CacheEntry {
  rules: TierRule[];
  expiresAt: number;
}

// ---------- rule loader ----------

/**
 * Callback to load per-namespace tier override rules from the database.
 * Returns an array of TierRule objects for the given namespace.
 * If not provided, only hardcoded defaults are used.
 */
export type TierRuleLoader = (namespace: string) => Promise<TierRule[]>;

// ---------- EntityTierResolver ----------

/** Default cache TTL: 5 minutes. */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolves entity tier classification.
 *
 * Combines hardcoded default mappings with optional per-namespace database
 * overrides. Database rules are cached in memory for the configured TTL.
 */
export class EntityTierResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly loader: TierRuleLoader | undefined;

  /** Pre-compiled matchers for log-only sensor patterns. */
  private readonly logOnlyMatchers: picomatch.Matcher[];

  /** Pre-compiled matchers for escalation sensor patterns. */
  private readonly escalateMatchers: picomatch.Matcher[];

  constructor(opts?: { loader?: TierRuleLoader; cacheTtlMs?: number }) {
    this.loader = opts?.loader;
    this.cacheTtlMs = opts?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.logOnlyMatchers = LOG_ONLY_PATTERNS.map((p) => picomatch(p));
    this.escalateMatchers = ESCALATE_PATTERNS.map((p) => picomatch(p));
  }

  /**
   * Resolve the tier for a single entity in a namespace.
   *
   * Evaluation order (first match wins within each level):
   *   1. DB rules: entity_id exact match (highest priority first)
   *   2. DB rules: entity_pattern glob match (highest priority first)
   *   3. DB rules: domain match (highest priority first)
   *   4. Hardcoded defaults
   */
  async resolve(entityId: string, namespace: string): Promise<ResolvedTier> {
    const domain = extractDomain(entityId);
    const rules = await this.getRules(namespace);

    // --- Phase 1: database override rules (sorted by priority desc) ---
    // entity_id exact match
    for (const rule of rules) {
      if (rule.entity_id !== undefined && rule.entity_id === entityId) {
        return { tier: rule.tier, source: 'entity_id' };
      }
    }

    // entity_pattern glob match
    for (const rule of rules) {
      if (rule.entity_pattern !== undefined) {
        try {
          if (picomatch.isMatch(entityId, rule.entity_pattern)) {
            return { tier: rule.tier, source: 'pattern' };
          }
        } catch (err) {
          console.warn(
            `[entity-tiers] Skipping invalid glob pattern "${rule.entity_pattern}" for namespace "${namespace}":`,
            err,
          );
        }
      }
    }

    // domain match
    for (const rule of rules) {
      if (rule.domain !== undefined && rule.domain === domain) {
        return { tier: rule.tier, source: 'domain' };
      }
    }

    // --- Phase 2: hardcoded defaults ---
    return this.resolveDefault(entityId, domain);
  }

  /**
   * Resolve tiers for a batch of entities in a single namespace.
   * Loads rules once and evaluates each entity against them.
   */
  async resolveBatch(entityIds: string[], namespace: string): Promise<Map<string, ResolvedTier>> {
    const rules = await this.getRules(namespace);
    const results = new Map<string, ResolvedTier>();

    for (const entityId of entityIds) {
      const domain = extractDomain(entityId);
      let resolved: ResolvedTier | undefined;

      // entity_id exact match
      for (const rule of rules) {
        if (rule.entity_id !== undefined && rule.entity_id === entityId) {
          resolved = { tier: rule.tier, source: 'entity_id' };
          break;
        }
      }

      // entity_pattern glob match
      if (!resolved) {
        for (const rule of rules) {
          if (rule.entity_pattern !== undefined) {
            try {
              if (picomatch.isMatch(entityId, rule.entity_pattern)) {
                resolved = { tier: rule.tier, source: 'pattern' };
                break;
              }
            } catch (err) {
              console.warn(
                `[entity-tiers] Skipping invalid glob pattern "${rule.entity_pattern}" for namespace "${namespace}":`,
                err,
              );
            }
          }
        }
      }

      // domain match
      if (!resolved) {
        for (const rule of rules) {
          if (rule.domain !== undefined && rule.domain === domain) {
            resolved = { tier: rule.tier, source: 'domain' };
            break;
          }
        }
      }

      // hardcoded defaults
      if (!resolved) {
        resolved = this.resolveDefault(entityId, domain);
      }

      results.set(entityId, resolved);
    }

    return results;
  }

  /** Invalidate cached rules for a namespace (or all namespaces). */
  invalidate(namespace?: string): void {
    if (namespace !== undefined) {
      this.cache.delete(namespace);
    } else {
      this.cache.clear();
    }
  }

  // ---------- private ----------

  /** Load (and cache) tier rules for a namespace. */
  private async getRules(namespace: string): Promise<TierRule[]> {
    if (!this.loader) return [];

    const now = Date.now();
    const cached = this.cache.get(namespace);
    if (cached && cached.expiresAt > now) {
      return cached.rules;
    }

    const rules = await this.loader(namespace);
    // Sort by priority descending so highest-priority rules are evaluated first
    rules.sort((a, b) => b.priority - a.priority);

    this.cache.set(namespace, { rules, expiresAt: now + this.cacheTtlMs });
    return rules;
  }

  /** Resolve tier using hardcoded default mappings. */
  private resolveDefault(entityId: string, domain: string): ResolvedTier {
    // Escalate patterns (check before domain-based defaults for sensors)
    for (const matcher of this.escalateMatchers) {
      if (matcher(entityId)) {
        return { tier: 'escalate', source: 'default' };
      }
    }

    // Escalate domains
    if (ESCALATE_DOMAINS.has(domain)) {
      return { tier: 'escalate', source: 'default' };
    }

    // Log-only patterns (battery, signal, etc.)
    for (const matcher of this.logOnlyMatchers) {
      if (matcher(entityId)) {
        return { tier: 'log_only', source: 'default' };
      }
    }

    // Geo domains
    if (GEO_DOMAINS.has(domain)) {
      return { tier: 'geo', source: 'default' };
    }

    // Triage domains
    if (TRIAGE_DOMAINS.has(domain)) {
      return { tier: 'triage', source: 'default' };
    }

    // Ignore domains
    if (IGNORE_DOMAINS.has(domain)) {
      return { tier: 'ignore', source: 'default' };
    }

    // Unknown domains default to log_only to avoid silent data loss
    return { tier: 'log_only', source: 'default' };
  }
}

// ---------- helpers ----------

/** Extract the HA domain from an entity_id (the part before the first dot). */
function extractDomain(entityId: string): string {
  const dotIndex = entityId.indexOf('.');
  return dotIndex > 0 ? entityId.slice(0, dotIndex) : entityId;
}
