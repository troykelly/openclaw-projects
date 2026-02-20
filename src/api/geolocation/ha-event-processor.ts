/**
 * Home Assistant event processor plugin interface.
 *
 * Defines the contract for processors that handle HA state_changed events,
 * plus entity filtering with glob support via picomatch.
 *
 * Issue #1441.
 */

import picomatch from 'picomatch';

// ---------- HA state change ----------

/** Structured representation of a Home Assistant state_changed event. */
export interface HaStateChange {
  entity_id: string;
  domain: string;
  old_state: string | null;
  new_state: string;
  old_attributes: Record<string, unknown>;
  new_attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id: string | null;
    user_id: string | null;
  };
}

// ---------- entity filter ----------

/** Filter criteria for selecting HA entities to process. */
export interface HaEntityFilter {
  /** Allow only entities in these domains (e.g. ["device_tracker", "person"]). */
  domains?: string[];
  /** Reject entities in these domains even if otherwise matched. */
  excludeDomains?: string[];
  /** Glob patterns matched against full entity_id (e.g. ["sensor.bermuda_*"]). */
  entityPatterns?: string[];
  /** Exact entity IDs to match. */
  entityIds?: string[];
}

// ---------- processor config ----------

/** Configuration for an event processor plugin. */
export interface HaEventProcessorConfig {
  /** Unique processor identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Entity filter controlling which events this processor receives. */
  filter: HaEntityFilter;
  /** Dispatch mode: individual per-event calls or batched. */
  mode: 'individual' | 'batched';
  /** Batch window in milliseconds (only used when mode is "batched"). */
  batchWindowMs?: number;
}

// ---------- processor interface ----------

/** Plugin interface for processing Home Assistant state_changed events. */
export interface HaEventProcessor {
  /** Return the processor's static configuration. */
  getConfig(): HaEventProcessorConfig;

  /** Called when a WebSocket connection to HA is established. */
  onConnect?(haUrl: string): Promise<void>;

  /** Called when the WebSocket connection to HA is lost. */
  onDisconnect?(reason: string): Promise<void>;

  /** Called for each matching state change in "individual" mode. */
  onStateChange?(change: HaStateChange, namespace: string): Promise<void>;

  /** Called with a batch of matching state changes in "batched" mode. */
  onStateChangeBatch?(changes: HaStateChange[], namespace: string): Promise<void>;

  /** Return true if the processor is healthy and ready to receive events. */
  healthCheck(): Promise<boolean>;

  /** Gracefully shut down the processor, releasing resources. */
  shutdown(): Promise<void>;
}

// ---------- matchesFilter ----------

/**
 * Extract the HA domain from an entity_id (the part before the first dot).
 */
function extractDomain(entityId: string): string {
  const dotIndex = entityId.indexOf('.');
  return dotIndex > 0 ? entityId.slice(0, dotIndex) : entityId;
}

/**
 * Determine whether an entity_id passes a filter.
 *
 * Matching logic (OR across positive criteria, AND with excludeDomains veto):
 * 1. If excludeDomains includes the entity's domain, reject immediately.
 * 2. If no positive criteria (domains, entityPatterns, entityIds) are specified, accept.
 * 3. Otherwise, accept if the entity matches ANY of: domains, entityPatterns, entityIds.
 */
export function matchesFilter(entityId: string, filter: HaEntityFilter): boolean {
  const domain = extractDomain(entityId);

  // Veto: excluded domains always reject
  if (filter.excludeDomains && filter.excludeDomains.includes(domain)) {
    return false;
  }

  const hasDomains = filter.domains !== undefined;
  const hasPatterns = filter.entityPatterns !== undefined;
  const hasIds = filter.entityIds !== undefined;

  // No positive criteria → accept everything (that wasn't excluded)
  if (!hasDomains && !hasPatterns && !hasIds) {
    return true;
  }

  // Domain match
  if (hasDomains && filter.domains!.includes(domain)) {
    return true;
  }

  // Glob pattern match
  if (hasPatterns) {
    for (const pattern of filter.entityPatterns!) {
      if (picomatch.isMatch(entityId, pattern)) {
        return true;
      }
    }
  }

  // Exact entity ID match
  if (hasIds && filter.entityIds!.includes(entityId)) {
    return true;
  }

  return false;
}
