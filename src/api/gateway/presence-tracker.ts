/**
 * AgentPresenceTracker — tracks agent online/busy/offline status from gateway events.
 * Issue #2158 — Agent presence tracking.
 *
 * Gateway Event Discovery Notes:
 * The OpenClaw gateway source was not available locally during implementation.
 * This tracker handles two event patterns:
 *
 * 1. Explicit presence events (preferred):
 *    - agent.online  → { agent_id: string }  → status = "online"
 *    - agent.busy    → { agent_id: string }  → status = "busy"
 *    - agent.offline → { agent_id: string }  → status = "offline"
 *
 * 2. Inferred presence from chat events (fallback):
 *    - chat.delta  → sessionKey "agent:{agentId}:agent_chat:{threadId}" → "busy"
 *    - chat.final  → sessionKey "agent:{agentId}:agent_chat:{threadId}" → "online"
 *    - chat.aborted → same pattern → "online"
 *    - chat.error  → same pattern → "online"
 */

import type { GatewayEventFrame } from './connection.ts';
import { getRealtimeHub } from '../realtime/hub.ts';

// ── Types ────────────────────────────────────────────────────────────

export type AgentStatus = 'online' | 'busy' | 'offline' | 'unknown';

interface AgentEntry {
  status: AgentStatus;
  updatedAt: number;
}

// ── Constants ────────────────────────────────────────────────────────

const MAX_ENTRIES = 1000;
const STALENESS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PRUNE_TTL_MS = 10 * 60 * 1000;    // 10 minutes
const PRUNE_INTERVAL_MS = 60 * 1000;    // 60 seconds

/** Pattern: "agent:{agentId}:agent_chat:{threadId}" */
const SESSION_KEY_RE = /^agent:([^:]+):agent_chat:/;

// ── Tracker ──────────────────────────────────────────────────────────

export class AgentPresenceTracker {
  private agents = new Map<string, AgentEntry>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  /** Handle a gateway event frame. */
  handleEvent(frame: GatewayEventFrame): void {
    const eventName = frame.event;

    // Explicit agent presence events
    if (eventName.startsWith('agent.')) {
      const agentId = this._extractAgentId(frame.payload);
      if (!agentId) return;

      const status = this._mapExplicitEvent(eventName);
      if (status) {
        this._setStatus(agentId, status);
      }
      return;
    }

    // Inferred presence from chat events
    if (eventName.startsWith('chat.')) {
      const agentId = this._extractAgentIdFromSessionKey(frame.payload);
      if (!agentId) return;

      const status = this._mapChatEvent(eventName);
      if (status) {
        this._setStatus(agentId, status);
      }
    }
  }

  /** Called when the gateway WS disconnects. Sets all agents to "unknown". */
  onDisconnect(): void {
    const now = Date.now();
    for (const [agentId, entry] of this.agents) {
      if (entry.status !== 'unknown') {
        entry.status = 'unknown';
        entry.updatedAt = now;
        this._emitStatusChanged(agentId, 'unknown');
      }
    }
  }

  /** Get the status of a specific agent. Returns "unknown" if not tracked or stale. */
  getStatus(agentId: string): AgentStatus {
    const entry = this.agents.get(agentId);
    if (!entry) return 'unknown';

    // TTL staleness check
    if (Date.now() - entry.updatedAt > STALENESS_TTL_MS) {
      return 'unknown';
    }

    return entry.status;
  }

  /** Get all non-evicted agent statuses (does NOT apply staleness filter). */
  getAllStatuses(): Map<string, AgentStatus> {
    const result = new Map<string, AgentStatus>();
    for (const [agentId, entry] of this.agents) {
      result.set(agentId, entry.status);
    }
    return result;
  }

  /** Start the periodic pruning interval. */
  startPruning(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => this._prune(), PRUNE_INTERVAL_MS);
  }

  /** Shutdown the tracker, clearing the prune interval. */
  shutdown(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────

  private _setStatus(agentId: string, status: AgentStatus): void {
    const existing = this.agents.get(agentId);
    const now = Date.now();

    if (existing && existing.status === status) {
      // Same status — just update timestamp, no emission
      existing.updatedAt = now;
      return;
    }

    this.agents.set(agentId, { status, updatedAt: now });

    // Enforce bounded map
    if (this.agents.size > MAX_ENTRIES) {
      this._evictOldest();
    }

    this._emitStatusChanged(agentId, status);
  }

  private _evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.agents) {
      if (entry.updatedAt < oldestTime) {
        oldestTime = entry.updatedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.agents.delete(oldestKey);
    }
  }

  private _prune(): void {
    const cutoff = Date.now() - PRUNE_TTL_MS;
    for (const [key, entry] of this.agents) {
      if (entry.updatedAt < cutoff) {
        this.agents.delete(key);
      }
    }
  }

  private _emitStatusChanged(agentId: string, status: AgentStatus): void {
    try {
      getRealtimeHub().emit(
        'agent:status_changed' as never,
        { agent_id: agentId, status },
        undefined,
      );
    } catch {
      // Best-effort — don't let emission failures affect event processing
    }
  }

  private _extractAgentId(payload: unknown): string | null {
    if (payload && typeof payload === 'object' && 'agent_id' in payload) {
      const id = (payload as { agent_id: unknown }).agent_id;
      return typeof id === 'string' && id.length > 0 ? id : null;
    }
    return null;
  }

  private _extractAgentIdFromSessionKey(payload: unknown): string | null {
    if (payload && typeof payload === 'object' && 'sessionKey' in payload) {
      const key = (payload as { sessionKey: unknown }).sessionKey;
      if (typeof key === 'string') {
        const match = SESSION_KEY_RE.exec(key);
        return match?.[1] ?? null;
      }
    }
    return null;
  }

  private _mapExplicitEvent(eventName: string): AgentStatus | null {
    switch (eventName) {
      case 'agent.online': return 'online';
      case 'agent.busy': return 'busy';
      case 'agent.offline': return 'offline';
      default: return null;
    }
  }

  private _mapChatEvent(eventName: string): AgentStatus | null {
    switch (eventName) {
      case 'chat.delta': return 'busy';
      case 'chat.final':
      case 'chat.aborted':
      case 'chat.error': return 'online';
      default: return null;
    }
  }
}
