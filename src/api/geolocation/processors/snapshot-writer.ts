// NOTE: Intentionally unwired — pending #1603 (HA Connector Container)

/**
 * Daily state snapshot writer for Home Assistant.
 *
 * Captures a daily summary of HA entity states via the REST API,
 * compresses into structured domain/climate/people summaries,
 * and upserts into ha_state_snapshots.
 *
 * Issue #1470.
 */

import type { Pool } from 'pg';

// ---------- HA REST API types ----------

/** A single entity state from the HA REST API GET /api/states response. */
export interface HaEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

// ---------- Snapshot structures ----------

/** Per-domain breakdown of entity states. */
export interface DomainStats {
  total: number;
  on: number;
  off: number;
  unavailable: number;
}

/** A single notable state worth highlighting. */
export interface NotableState {
  entity_id: string;
  state: string;
  reason: string;
}

/** Climate entity summary. */
export interface ClimateInfo {
  current_temp: number;
  target_temp: number;
  mode: string;
}

/** Full daily state snapshot. */
export interface StateSnapshot {
  entity_count: number;
  active_count: number;
  domain_summary: Record<string, DomainStats>;
  notable_states: NotableState[];
  people_home: string[];
  climate: Record<string, ClimateInfo>;
}

// ---------- Constants ----------

/** States that indicate an entity is "on" or active. */
const ACTIVE_STATES = new Set(['on', 'open', 'home', 'playing', 'heat', 'cool', 'auto']);

/** States considered "off" or inactive. */
const OFF_STATES = new Set(['off', 'closed', 'not_home', 'idle', 'standby', 'paused']);

/** States considered unavailable. */
const UNAVAILABLE_STATES = new Set(['unavailable', 'unknown']);

/** Notable state thresholds and conditions. */
const NOTABLE_BATTERY_THRESHOLD = 20;
const NOTABLE_TEMP_HIGH = 35;
const NOTABLE_TEMP_LOW = 5;

// ---------- Helpers ----------

/**
 * Extract the HA domain from an entity_id (the part before the first dot).
 */
function extractDomain(entityId: string): string {
  const dotIndex = entityId.indexOf('.');
  return dotIndex > 0 ? entityId.slice(0, dotIndex) : entityId;
}

/**
 * Determine whether an entity state counts as "active" in the last 24 hours.
 */
function isRecentlyActive(entity: HaEntityState, cutoff: Date): boolean {
  const lastChanged = new Date(entity.last_changed);
  return lastChanged >= cutoff;
}

/**
 * Detect notable states that are worth highlighting in the snapshot.
 * Notable conditions include:
 * - Battery sensors below threshold
 * - Temperature sensors at extreme values
 * - Entities stuck in unavailable state
 */
export function detectNotableStates(entities: HaEntityState[]): NotableState[] {
  const notable: NotableState[] = [];

  for (const entity of entities) {
    const domain = extractDomain(entity.entity_id);
    const stateValue = entity.state;

    // Battery sensors below threshold
    if (domain === 'sensor' && entity.entity_id.includes('battery')) {
      const level = Number(stateValue);
      if (!Number.isNaN(level) && level < NOTABLE_BATTERY_THRESHOLD) {
        notable.push({
          entity_id: entity.entity_id,
          state: stateValue,
          reason: `Battery low (${level}%)`,
        });
      }
    }

    // Temperature sensors at extreme values
    if (domain === 'sensor' && entity.entity_id.includes('temperature')) {
      const temp = Number(stateValue);
      if (!Number.isNaN(temp)) {
        if (temp > NOTABLE_TEMP_HIGH) {
          notable.push({
            entity_id: entity.entity_id,
            state: stateValue,
            reason: `High temperature (${temp})`,
          });
        } else if (temp < NOTABLE_TEMP_LOW) {
          notable.push({
            entity_id: entity.entity_id,
            state: stateValue,
            reason: `Low temperature (${temp})`,
          });
        }
      }
    }

    // Entities stuck in unavailable state (exclude unknown domains)
    if (stateValue === 'unavailable' && domain !== 'sensor') {
      notable.push({
        entity_id: entity.entity_id,
        state: stateValue,
        reason: 'Entity unavailable',
      });
    }
  }

  return notable;
}

/**
 * Compress a list of HA entity states into a structured snapshot.
 */
export function compressStates(entities: HaEntityState[]): StateSnapshot {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const domainSummary: Record<string, DomainStats> = {};
  const peopleHome: string[] = [];
  const climate: Record<string, ClimateInfo> = {};
  let activeCount = 0;

  for (const entity of entities) {
    const domain = extractDomain(entity.entity_id);
    const state = entity.state;

    // Build domain summary
    if (!domainSummary[domain]) {
      domainSummary[domain] = { total: 0, on: 0, off: 0, unavailable: 0 };
    }
    const ds = domainSummary[domain];
    ds.total++;

    if (ACTIVE_STATES.has(state)) {
      ds.on++;
    } else if (OFF_STATES.has(state)) {
      ds.off++;
    } else if (UNAVAILABLE_STATES.has(state)) {
      ds.unavailable++;
    }
    // Numeric or other states are counted in total but not in on/off/unavailable

    // Count recently active entities
    if (isRecentlyActive(entity, cutoff)) {
      activeCount++;
    }

    // Track people who are home
    if (domain === 'person' && state === 'home') {
      const name = typeof entity.attributes.friendly_name === 'string'
        ? entity.attributes.friendly_name
        : entity.entity_id;
      peopleHome.push(name);
    }

    // Extract climate information
    if (domain === 'climate') {
      const attrs = entity.attributes;
      const currentTemp = typeof attrs.current_temperature === 'number'
        ? attrs.current_temperature
        : 0;
      const targetTemp = typeof attrs.temperature === 'number'
        ? attrs.temperature
        : 0;
      const mode = typeof state === 'string' ? state : 'unknown';

      climate[entity.entity_id] = {
        current_temp: currentTemp,
        target_temp: targetTemp,
        mode,
      };
    }
  }

  const notableStates = detectNotableStates(entities);

  return {
    entity_count: entities.length,
    active_count: activeCount,
    domain_summary: domainSummary,
    notable_states: notableStates,
    people_home: peopleHome,
    climate,
  };
}

// ---------- HA REST client ----------

/**
 * Fetch all entity states from a Home Assistant instance via REST API.
 *
 * @param haUrl - Base URL of the HA instance (e.g. "http://homeassistant.local:8123")
 * @param token - Long-lived access token for HA authentication
 * @returns Array of entity states, or null if HA is unavailable
 */
/**
 * Validate that a HA base URL is safe to fetch from.
 * Restricts to http/https schemes and rejects empty or malformed URLs.
 */
function validateHaUrl(haUrl: string): string {
  const trimmed = haUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('HA URL is empty');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`HA URL is malformed: ${trimmed}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `HA URL has disallowed scheme "${parsed.protocol}" — only http: and https: are permitted`,
    );
  }

  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

export async function fetchHaStates(
  haUrl: string,
  token: string,
): Promise<HaEntityState[] | null> {
  let sanitizedBase: string;
  try {
    sanitizedBase = validateHaUrl(haUrl);
  } catch (err) {
    console.error('[snapshot-writer] Invalid HA URL:', err);
    return null;
  }

  const url = `${sanitizedBase}/api/states`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      console.error(
        `[snapshot-writer] HA REST API returned ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      console.error('[snapshot-writer] HA REST API returned non-array response');
      return null;
    }

    return data as HaEntityState[];
  } catch (err) {
    // Network error, timeout, or HA unavailable
    console.error('[snapshot-writer] Failed to fetch HA states:', err);
    return null;
  }
}

// ---------- Database upsert ----------

/**
 * Upsert a state snapshot into ha_state_snapshots.
 * Uses the (namespace, snapshot_date) unique constraint for ON CONFLICT.
 */
export async function upsertSnapshot(
  pool: Pool,
  namespace: string,
  snapshotDate: Date,
  snapshot: StateSnapshot,
): Promise<void> {
  await pool.query(
    `INSERT INTO ha_state_snapshots (
       namespace, snapshot_date, entity_count, active_count,
       domain_summary, notable_states
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (namespace, snapshot_date) DO UPDATE
       SET entity_count = EXCLUDED.entity_count,
           active_count = EXCLUDED.active_count,
           domain_summary = EXCLUDED.domain_summary,
           notable_states = EXCLUDED.notable_states`,
    [
      namespace,
      snapshotDate,
      snapshot.entity_count,
      snapshot.active_count,
      JSON.stringify(snapshot.domain_summary),
      JSON.stringify({
        notable_states: snapshot.notable_states,
        people_home: snapshot.people_home,
        climate: snapshot.climate,
      }),
    ],
  );
}

// ---------- SnapshotWriter ----------

/**
 * Captures daily state snapshots from Home Assistant.
 *
 * Fetches the full HA state via REST API, compresses to a structured
 * summary, and writes to ha_state_snapshots with upsert semantics.
 */
export class SnapshotWriter {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Capture a daily state snapshot for a namespace.
   *
   * Fetches current HA state via REST API, compresses to summary,
   * and upserts into ha_state_snapshots for today's date.
   *
   * Handles HA unavailability gracefully (logs warning, returns without error).
   *
   * @param namespace - The namespace to store the snapshot under
   * @param haUrl - Base URL of the HA instance
   * @param token - Long-lived access token
   */
  async captureDaily(namespace: string, haUrl: string, token: string): Promise<void> {
    const states = await fetchHaStates(haUrl, token);

    if (!states) {
      console.warn(
        `[snapshot-writer] Skipping daily snapshot for namespace "${namespace}" — HA unavailable`,
      );
      return;
    }

    const snapshot = compressStates(states);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await upsertSnapshot(this.pool, namespace, today, snapshot);
  }
}
