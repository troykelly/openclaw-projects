/**
 * AgentCache — TTL cache for agents.list results from gateway WS.
 * Issue #2157 — Live agent discovery via gateway WebSocket.
 *
 * When the gateway WS is connected, queries agents.list and caches
 * the result for 30 seconds. Falls back to DB query when WS is unavailable.
 */

import type { Pool } from 'pg';
import type { GatewayConnectionService } from './connection.ts';
import type { AgentPresenceTracker, AgentStatus } from './presence-tracker.ts';

// ── Types ────────────────────────────────────────────────────────────

export interface CachedAgent {
  id: string;
  name: string;
  display_name: string | null;
  avatar_url: string | null;
  is_default: boolean;
  status: AgentStatus;
}

interface GatewayAgentSummary {
  id: string;
  name: string;
  display_name?: string | null;
  avatar_url?: string | null;
  is_default?: boolean;
  status?: string;
}

interface AgentsListResponse {
  agents: GatewayAgentSummary[];
}

// ── Constants ────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000; // 30 seconds

// ── Cache ────────────────────────────────────────────────────────────

export class AgentCache {
  private cachedAgents: GatewayAgentSummary[] | null = null;
  private cachedAt = 0;
  private connection: GatewayConnectionService;
  private presenceTracker: AgentPresenceTracker;

  constructor(connection: GatewayConnectionService, presenceTracker: AgentPresenceTracker) {
    this.connection = connection;
    this.presenceTracker = presenceTracker;
  }

  /**
   * Get the list of agents. Prefers live gateway data, falls back to DB.
   * Issue #2242: Accepts namespace array for multi-namespace read access.
   * @param pool - Database connection pool for fallback query
   * @param namespaces - Namespace(s) to filter DB results
   */
  async getAgents(pool: Pool, namespaces: string[] | string): Promise<CachedAgent[]> {
    const status = this.connection.getStatus();

    if (status.connected) {
      // Try gateway first
      try {
        return await this._getFromGateway();
      } catch {
        // Fall through to DB
      }
    }

    // Normalize to array for DB query
    const nsArray = Array.isArray(namespaces) ? namespaces : [namespaces];
    return this._getFromDb(pool, nsArray);
  }

  /** Eagerly refresh cache from gateway. Safe to call; errors are logged and ignored. */
  async refresh(): Promise<void> {
    try {
      const status = this.connection.getStatus();
      if (!status.connected) return;

      const response = await this.connection.request<AgentsListResponse>('agents.list', {});
      const agents = Array.isArray(response?.agents) ? response.agents : [];
      this.cachedAgents = agents;
      this.cachedAt = Date.now();
    } catch {
      // Best-effort refresh
    }
  }

  /** Clear the cache. Called on WS disconnect. */
  invalidate(): void {
    this.cachedAgents = null;
    this.cachedAt = 0;
  }

  // ── Private ────────────────────────────────────────────────────────

  private async _getFromGateway(): Promise<CachedAgent[]> {
    const now = Date.now();

    // Return cached if within TTL
    if (this.cachedAgents !== null && now - this.cachedAt < CACHE_TTL_MS) {
      return this._enrichWithPresence(this.cachedAgents);
    }

    // Fetch fresh
    const response = await this.connection.request<AgentsListResponse>('agents.list', {});
    const agents = Array.isArray(response?.agents) ? response.agents : [];
    this.cachedAgents = agents;
    this.cachedAt = Date.now();

    return this._enrichWithPresence(agents);
  }

  private async _getFromDb(pool: Pool, namespaces: string[]): Promise<CachedAgent[]> {
    try {
      const result = await pool.query(
        `SELECT agent_id, display_name, avatar_url, is_default
         FROM gateway_agent_cache
         WHERE namespace = ANY($1::text[])
         ORDER BY is_default DESC, agent_id`,
        [namespaces],
      );

      return result.rows.map((row: { agent_id: string; display_name: string | null; avatar_url: string | null; is_default: boolean }) => ({
        id: row.agent_id,
        name: row.agent_id,
        display_name: row.display_name ?? null,
        avatar_url: row.avatar_url ?? null,
        is_default: row.is_default ?? false,
        status: 'unknown' as AgentStatus,
      }));
    } catch {
      return [];
    }
  }

  private _enrichWithPresence(agents: GatewayAgentSummary[]): CachedAgent[] {
    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      display_name: agent.display_name ?? null,
      avatar_url: agent.avatar_url ?? null,
      is_default: agent.is_default ?? false,
      status: this.presenceTracker.getStatus(agent.id),
    }));
  }
}
