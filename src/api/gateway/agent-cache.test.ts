/**
 * Unit tests for AgentCache.
 * Issue #2157 — Live agent discovery via gateway WS.
 *
 * TDD: These tests are written FIRST, before the implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AgentCache } from './agent-cache.ts';
import type { GatewayConnectionService } from './connection.ts';
import type { AgentPresenceTracker } from './presence-tracker.ts';
import type { Pool } from 'pg';

/** Create a mock GatewayConnectionService. */
function createMockConnection(overrides?: Partial<GatewayConnectionService>) {
  return {
    getStatus: vi.fn(() => ({ connected: false, gateway_url: null, connected_at: null, last_tick_at: null })),
    request: vi.fn(),
    onEvent: vi.fn(),
    initialize: vi.fn(),
    shutdown: vi.fn(),
    ...overrides,
  } as unknown as GatewayConnectionService;
}

/** Create a mock presence tracker. */
function createMockPresenceTracker(statuses?: Record<string, string>): AgentPresenceTracker {
  return {
    getStatus: vi.fn((agentId: string) => statuses?.[agentId] ?? 'unknown'),
    getAllStatuses: vi.fn(() => new Map(Object.entries(statuses ?? {}))),
    handleEvent: vi.fn(),
    onDisconnect: vi.fn(),
    startPruning: vi.fn(),
    shutdown: vi.fn(),
  } as unknown as AgentPresenceTracker;
}

/** DB row shape from gateway_agent_cache table. */
interface GatewayAgentCacheRow {
  agent_id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_default: boolean;
}

/** Create a mock pg Pool with gateway_agent_cache rows. */
function createMockPool(rows: GatewayAgentCacheRow[] = []) {
  return {
    query: vi.fn(() => Promise.resolve({ rows })),
  } as unknown as Pool;
}

describe('AgentCache', () => {
  let cache: AgentCache;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Cache behaviour ────────────────────────────────────────────────

  it('returns cached result within 30s TTL', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn().mockResolvedValue({
        agents: [{ id: 'agent-1', name: 'Agent 1' }],
      }),
    });
    const tracker = createMockPresenceTracker();
    const pool = createMockPool();
    cache = new AgentCache(conn, tracker);

    // First call — hits gateway
    const result1 = await cache.getAgents(pool, 'ns1');
    expect(conn.request).toHaveBeenCalledTimes(1);
    expect(result1).toHaveLength(1);

    // Advance 10 seconds (within TTL)
    vi.advanceTimersByTime(10000);

    // Second call — returns cached, no new request
    const result2 = await cache.getAgents(pool, 'ns1');
    expect(conn.request).toHaveBeenCalledTimes(1);
    expect(result2).toEqual(result1);
  });

  it('refreshes from gateway after TTL expires', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn()
        .mockResolvedValueOnce({ agents: [{ id: 'agent-1', name: 'Agent 1' }] })
        .mockResolvedValueOnce({ agents: [{ id: 'agent-1', name: 'Agent 1' }, { id: 'agent-2', name: 'Agent 2' }] }),
    });
    const tracker = createMockPresenceTracker();
    const pool = createMockPool();
    cache = new AgentCache(conn, tracker);

    await cache.getAgents(pool, 'ns1');
    expect(conn.request).toHaveBeenCalledTimes(1);

    // Advance past 30s TTL
    vi.advanceTimersByTime(31000);

    const result2 = await cache.getAgents(pool, 'ns1');
    expect(conn.request).toHaveBeenCalledTimes(2);
    expect(result2).toHaveLength(2);
  });

  it('returns empty array when cache is empty and WS unavailable', async () => {
    const conn = createMockConnection(); // connected: false
    const tracker = createMockPresenceTracker();
    const pool = createMockPool([]); // no DB agents either
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result).toEqual([]);
  });

  it('invalidate() causes next call to re-fetch', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn().mockResolvedValue({
        agents: [{ id: 'agent-1', name: 'Agent 1' }],
      }),
    });
    const tracker = createMockPresenceTracker();
    const pool = createMockPool();
    cache = new AgentCache(conn, tracker);

    await cache.getAgents(pool, 'ns1');
    expect(conn.request).toHaveBeenCalledTimes(1);

    cache.invalidate();

    await cache.getAgents(pool, 'ns1');
    expect(conn.request).toHaveBeenCalledTimes(2);
  });

  it('refresh() populates cache eagerly', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn().mockResolvedValue({
        agents: [{ id: 'agent-1', name: 'Agent 1' }],
      }),
    });
    const tracker = createMockPresenceTracker();
    const pool = createMockPool();
    cache = new AgentCache(conn, tracker);

    await cache.refresh();

    // Now getAgents should return cached without making another request
    const result = await cache.getAgents(pool, 'ns1');
    expect(conn.request).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  // ── Fallback to DB ────────────────────────────────────────────────

  it('falls back to DB query when WS not connected', async () => {
    const conn = createMockConnection(); // connected: false
    const tracker = createMockPresenceTracker();
    const pool = createMockPool([
      { agent_id: 'db-agent-1', display_name: 'Agent 1', avatar_url: null, is_default: true },
      { agent_id: 'db-agent-2', display_name: 'Agent 2', avatar_url: null, is_default: false },
    ]);
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(pool.query).toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('db-agent-1');
  });

  it('DB fallback returns status: "unknown" for all agents', async () => {
    const conn = createMockConnection(); // connected: false
    const tracker = createMockPresenceTracker();
    const pool = createMockPool([
      { agent_id: 'db-agent-1', display_name: null, avatar_url: null, is_default: false },
    ]);
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result[0].status).toBe('unknown');
  });

  it('returns empty array (not null/throw) when both WS and DB return nothing', async () => {
    const conn = createMockConnection(); // connected: false
    const tracker = createMockPresenceTracker();
    const pool = createMockPool([]); // no agents
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  // ── Live data mapping ─────────────────────────────────────────────

  it('maps gateway AgentSummary to { id, name, status }', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn().mockResolvedValue({
        agents: [
          { id: 'agent-1', name: 'Agent One', status: 'active' },
        ],
      }),
    });
    const tracker = createMockPresenceTracker({ 'agent-1': 'online' });
    const pool = createMockPool();
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result[0]).toEqual({
      id: 'agent-1',
      name: 'Agent One',
      display_name: null,
      avatar_url: null,
      is_default: false,
      status: 'online',
    });
  });

  it('maps unknown status field to "unknown"', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn().mockResolvedValue({
        agents: [
          { id: 'agent-1', name: 'Agent One' }, // no status field from gateway
        ],
      }),
    });
    // Tracker also has no info
    const tracker = createMockPresenceTracker();
    const pool = createMockPool();
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result[0].status).toBe('unknown');
  });

  // ── Includes presence tracker status ──────────────────────────────

  it('includes status from presence tracker in returned agents', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn().mockResolvedValue({
        agents: [
          { id: 'agent-1', name: 'Agent One' },
          { id: 'agent-2', name: 'Agent Two' },
        ],
      }),
    });
    const tracker = createMockPresenceTracker({
      'agent-1': 'busy',
      // agent-2 not in tracker
    });
    const pool = createMockPool();
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result[0].status).toBe('busy');
    expect(result[1].status).toBe('unknown');
  });

  // ── Error handling ────────────────────────────────────────────────

  it('handles agents.list request error gracefully (falls back to DB)', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn().mockRejectedValue(new Error('Gateway error')),
    });
    const tracker = createMockPresenceTracker();
    const pool = createMockPool([
      { agent_id: 'db-agent-1', display_name: null, avatar_url: null, is_default: false },
    ]);
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('db-agent-1');
    expect(result[0].status).toBe('unknown');
  });

  it('handles empty agents.list response gracefully', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn().mockResolvedValue({ agents: [] }),
    });
    const tracker = createMockPresenceTracker();
    const pool = createMockPool();
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result).toEqual([]);
  });

  it('cache cleared on WS disconnect (via invalidate)', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn()
        .mockReturnValueOnce({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })
        .mockReturnValueOnce({ connected: false, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null }),
      request: vi.fn().mockResolvedValue({
        agents: [{ id: 'agent-1', name: 'Agent 1' }],
      }),
    });
    const tracker = createMockPresenceTracker();
    const pool = createMockPool([
      { agent_id: 'db-agent-1', display_name: null, avatar_url: null, is_default: false },
    ]);
    cache = new AgentCache(conn, tracker);

    // First call - from gateway
    const result1 = await cache.getAgents(pool, 'ns1');
    expect(result1).toHaveLength(1);
    expect(result1[0].id).toBe('agent-1');

    // Simulate disconnect
    cache.invalidate();

    // Second call - WS is disconnected now, falls back to DB
    const result2 = await cache.getAgents(pool, 'ns1');
    expect(result2).toHaveLength(1);
    expect(result2[0].id).toBe('db-agent-1');
  });

  // ── Issue #2242: DB fallback queries gateway_agent_cache ─────────

  it('DB fallback queries gateway_agent_cache table (not chat_session)', async () => {
    const conn = createMockConnection(); // connected: false
    const tracker = createMockPresenceTracker();
    const pool = createMockPool([
      { agent_id: 'cached-agent-1', display_name: 'Cached Agent', avatar_url: 'https://example.com/a.png', is_default: true },
    ]);
    cache = new AgentCache(conn, tracker);

    await cache.getAgents(pool, 'ns1');

    // Verify the SQL queries gateway_agent_cache, not chat_session
    const queryCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    const sql = queryCall[0] as string;
    expect(sql).toContain('gateway_agent_cache');
    expect(sql).not.toContain('chat_session');
  });

  it('DB fallback returns display_name, avatar_url, and is_default', async () => {
    const conn = createMockConnection(); // connected: false
    const tracker = createMockPresenceTracker();
    const pool = createMockPool([
      { agent_id: 'agent-1', display_name: 'My Agent', avatar_url: 'https://example.com/avatar.png', is_default: true },
      { agent_id: 'agent-2', display_name: null, avatar_url: null, is_default: false },
    ]);
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      id: 'agent-1',
      name: 'agent-1',
      display_name: 'My Agent',
      avatar_url: 'https://example.com/avatar.png',
      is_default: true,
      status: 'unknown',
    });

    expect(result[1]).toEqual({
      id: 'agent-2',
      name: 'agent-2',
      display_name: null,
      avatar_url: null,
      is_default: false,
      status: 'unknown',
    });
  });

  it('DB fallback returns empty array when gateway_agent_cache has no rows', async () => {
    const conn = createMockConnection(); // connected: false
    const tracker = createMockPresenceTracker();
    const pool = createMockPool([]); // empty gateway_agent_cache
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });

  // ── Issue #2242: Gateway enrichment preserves extra fields ───────

  it('gateway enrichment includes display_name, avatar_url, is_default', async () => {
    const conn = createMockConnection({
      getStatus: vi.fn(() => ({ connected: true, gateway_url: 'ws://gw', connected_at: null, last_tick_at: null })),
      request: vi.fn().mockResolvedValue({
        agents: [
          { id: 'agent-1', name: 'Agent One', display_name: 'Display One', avatar_url: 'https://example.com/one.png', is_default: true },
          { id: 'agent-2', name: 'Agent Two' }, // no extra fields
        ],
      }),
    });
    const tracker = createMockPresenceTracker({ 'agent-1': 'online' });
    const pool = createMockPool();
    cache = new AgentCache(conn, tracker);

    const result = await cache.getAgents(pool, 'ns1');
    expect(result[0]).toEqual({
      id: 'agent-1',
      name: 'Agent One',
      display_name: 'Display One',
      avatar_url: 'https://example.com/one.png',
      is_default: true,
      status: 'online',
    });

    // Missing fields default to null/false
    expect(result[1]).toEqual({
      id: 'agent-2',
      name: 'Agent Two',
      display_name: null,
      avatar_url: null,
      is_default: false,
      status: 'unknown',
    });
  });
});
