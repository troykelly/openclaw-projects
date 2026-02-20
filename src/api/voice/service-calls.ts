/**
 * Structured service call validation and security.
 * Validates, filters, and enforces allowlists for service calls.
 *
 * Issue #1437 — Structured service call protocol.
 * Epic #1431.
 */

import type { Pool } from 'pg';
import type { ServiceCall, VoiceAgentConfigRow, EntityInfo, AreaInfo } from './types.ts';
import { DEFAULT_SAFE_DOMAINS, BLOCKED_SERVICES } from './types.ts';

/**
 * Validate and filter service calls against the allowlist.
 *
 * - Rejects calls to blocked services (always blocked regardless of allowlist).
 * - Filters calls to only allowed domains.
 * - Returns the filtered list (may be empty if all calls were rejected).
 */
export function validateServiceCalls(
  calls: ServiceCall[],
  allowedDomains: string[],
): ServiceCall[] {
  return calls.filter((call) => {
    // Validate structure first
    if (!isValidServiceCall(call)) {
      console.warn('[VoiceServiceCalls] Invalid service call structure');
      return false;
    }

    // Check if explicitly blocked
    const fullService = `${call.domain}.${call.service}`;
    if (BLOCKED_SERVICES.includes(fullService)) {
      console.warn(`[VoiceServiceCalls] Blocked service call: ${fullService}`);
      return false;
    }

    // Check domain allowlist
    if (!allowedDomains.includes(call.domain)) {
      console.warn(`[VoiceServiceCalls] Domain not in allowlist: ${call.domain}`);
      return false;
    }

    return true;
  });
}

/**
 * Get the service call allowlist for a namespace.
 * Falls back to default safe domains if no config exists.
 */
export async function getServiceAllowlist(
  pool: Pool,
  namespace: string,
): Promise<string[]> {
  const result = await pool.query<Pick<VoiceAgentConfigRow, 'service_allowlist'>>(
    'SELECT service_allowlist FROM voice_agent_config WHERE namespace = $1',
    [namespace],
  );

  if (result.rows.length === 0 || !result.rows[0].service_allowlist) {
    return [...DEFAULT_SAFE_DOMAINS];
  }

  return result.rows[0].service_allowlist;
}

/**
 * Validate a single service call structure.
 * Ensures required fields are present and well-typed.
 */
export function isValidServiceCall(call: unknown): call is ServiceCall {
  if (typeof call !== 'object' || call === null) return false;
  const obj = call as Record<string, unknown>;
  if (typeof obj.domain !== 'string' || obj.domain.length === 0) return false;
  if (typeof obj.service !== 'string' || obj.service.length === 0) return false;
  // target and data are optional
  if (obj.target !== undefined && (typeof obj.target !== 'object' || obj.target === null)) return false;
  if (obj.data !== undefined && (typeof obj.data !== 'object' || obj.data === null)) return false;
  return true;
}

/**
 * Format entity context for agent consumption.
 * Produces a compact summary of entity states for inclusion in agent prompts.
 */
export function formatEntityContext(
  entities: EntityInfo[],
  areas?: AreaInfo[],
): Record<string, unknown> {
  const areaMap = new Map<string, string>();
  if (areas) {
    for (const area of areas) {
      areaMap.set(area.area_id, area.name);
    }
  }

  // Group entities by domain for compact representation
  const byDomain: Record<string, Array<{
    entity_id: string;
    state: string;
    name?: string;
    area?: string;
  }>> = {};

  for (const entity of entities) {
    if (!byDomain[entity.domain]) {
      byDomain[entity.domain] = [];
    }
    byDomain[entity.domain].push({
      entity_id: entity.entity_id,
      state: entity.state,
      name: entity.friendly_name,
      area: entity.area_id ? areaMap.get(entity.area_id) ?? entity.area_id : undefined,
    });
  }

  return {
    entity_count: entities.length,
    area_count: areas?.length ?? 0,
    domains: byDomain,
  };
}

/**
 * Validate entity context message structure.
 */
export function isValidEntityContext(entities: unknown): entities is EntityInfo[] {
  if (!Array.isArray(entities)) return false;
  return entities.every((e) => {
    if (typeof e !== 'object' || e === null) return false;
    const obj = e as Record<string, unknown>;
    return (
      typeof obj.entity_id === 'string' &&
      typeof obj.domain === 'string' &&
      typeof obj.state === 'string'
    );
  });
}
