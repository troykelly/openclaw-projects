/**
 * Tests for the HA Connector lifecycle manager.
 * Issue #1636, parent #1603.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import type { Connection } from '../../src/api/geolocation/types.ts';
import { ProviderLifecycleManager } from '../../src/ha-connector/lifecycle.ts';
import type { HaEventRouter } from '../../src/api/geolocation/ha-event-router.ts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockPool(rows: Record<string, unknown>[] = []): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows } as QueryResult),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pool;
}

function createMockConnection(connected = true): Connection {
  return {
    disconnect: vi.fn().mockResolvedValue(undefined),
    addEntities: vi.fn(),
    removeEntities: vi.fn(),
    isConnected: vi.fn().mockReturnValue(connected),
  };
}

function createMockRouter(): HaEventRouter {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    dispatch: vi.fn().mockResolvedValue(undefined),
    notifyConnect: vi.fn().mockResolvedValue(undefined),
    notifyDisconnect: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(new Map()),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as HaEventRouter;
}

const MOCK_PROVIDER_ROW = {
  id: 'prov-1',
  provider_type: 'home_assistant',
  label: 'Home HA',
  config: { url: 'https://ha.example.com' },
  credentials: Buffer.from('fake-token'),
  status: 'active',
  owner_email: 'user@test.com',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProviderLifecycleManager', () => {
  let pool: Pool;
  let router: HaEventRouter;

  beforeEach(() => {
    pool = createMockPool([MOCK_PROVIDER_ROW]);
    router = createMockRouter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('queries active providers on start', async () => {
    const mockConn = createMockConnection();
    vi.doMock('../../src/api/geolocation/registry.ts', () => ({
      getProvider: vi.fn().mockReturnValue({
        connect: vi.fn().mockResolvedValue(mockConn),
      }),
    }));

    const mgr = new ProviderLifecycleManager(pool, router);
    // Override the internal connect to avoid real WebSocket
    mgr['connectProvider'] = vi.fn().mockResolvedValue(mockConn);

    await mgr.start();

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('geo_provider'),
      expect.anything(),
    );

    await mgr.shutdown();
  });

  it('reports health for connected providers', async () => {
    const mgr = new ProviderLifecycleManager(pool, router);
    const mockConn = createMockConnection(true);
    mgr['connectProvider'] = vi.fn().mockResolvedValue(mockConn);

    await mgr.start();

    const health = mgr.getHealth();
    expect(health.providers).toHaveLength(1);
    expect(health.providers[0].id).toBe('prov-1');
    expect(health.providers[0].connected).toBe(true);

    await mgr.shutdown();
  });

  it('reports health for disconnected providers', async () => {
    const mockConn = createMockConnection(false);
    const mgr = new ProviderLifecycleManager(pool, router);
    mgr['connectProvider'] = vi.fn().mockResolvedValue(mockConn);

    await mgr.start();

    const health = mgr.getHealth();
    expect(health.providers[0].connected).toBe(false);

    await mgr.shutdown();
  });

  it('handles no active providers gracefully', async () => {
    pool = createMockPool([]);
    const mgr = new ProviderLifecycleManager(pool, router);
    await mgr.start();

    const health = mgr.getHealth();
    expect(health.providers).toHaveLength(0);

    await mgr.shutdown();
  });

  it('disconnects all providers on shutdown', async () => {
    const mockConn = createMockConnection();
    const mgr = new ProviderLifecycleManager(pool, router);
    mgr['connectProvider'] = vi.fn().mockResolvedValue(mockConn);

    await mgr.start();
    await mgr.shutdown();

    expect(mockConn.disconnect).toHaveBeenCalled();
    expect(router.shutdown).toHaveBeenCalled();
  });

  it('handles connect failure gracefully', async () => {
    const mgr = new ProviderLifecycleManager(pool, router);
    mgr['connectProvider'] = vi.fn().mockRejectedValue(new Error('Connection refused'));

    // Should not throw
    await mgr.start();

    const health = mgr.getHealth();
    expect(health.providers[0].connected).toBe(false);
    expect(health.providers[0].error).toContain('Connection refused');

    await mgr.shutdown();
  });

  it('reconciles on config change', async () => {
    const mockConn = createMockConnection();
    const mgr = new ProviderLifecycleManager(pool, router);
    mgr['connectProvider'] = vi.fn().mockResolvedValue(mockConn);

    await mgr.start();
    expect(mgr.getHealth().providers).toHaveLength(1);

    // Simulate config change: provider removed
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
    await mgr.reconcile();

    expect(mockConn.disconnect).toHaveBeenCalled();
    expect(mgr.getHealth().providers).toHaveLength(0);

    await mgr.shutdown();
  });

  it('connects new provider on reconcile', async () => {
    // Start with no providers
    pool = createMockPool([]);
    const mockConn = createMockConnection();
    const mgr = new ProviderLifecycleManager(pool, router);
    mgr['connectProvider'] = vi.fn().mockResolvedValue(mockConn);

    await mgr.start();
    expect(mgr.getHealth().providers).toHaveLength(0);

    // Reconcile: new provider appears
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [MOCK_PROVIDER_ROW] });
    await mgr.reconcile();

    expect(mgr.getHealth().providers).toHaveLength(1);
    expect(mgr.getHealth().providers[0].connected).toBe(true);

    await mgr.shutdown();
  });

  it('isRunning returns correct state', async () => {
    const mgr = new ProviderLifecycleManager(pool, router);
    mgr['connectProvider'] = vi.fn().mockResolvedValue(createMockConnection());

    expect(mgr.isRunning()).toBe(false);
    await mgr.start();
    expect(mgr.isRunning()).toBe(true);
    await mgr.shutdown();
    expect(mgr.isRunning()).toBe(false);
  });

  it('getConnection returns active connection by provider ID', async () => {
    const mockConn = createMockConnection();
    const mgr = new ProviderLifecycleManager(pool, router);
    mgr['connectProvider'] = vi.fn().mockResolvedValue(mockConn);

    await mgr.start();

    expect(mgr.getConnection('prov-1')).toBe(mockConn);
    expect(mgr.getConnection('nonexistent')).toBeUndefined();

    await mgr.shutdown();
  });
});
