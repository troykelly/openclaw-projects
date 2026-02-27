import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type { HaEventRouter } from '../../../src/api/geolocation/ha-event-router.ts';
import { ProviderLifecycleManager } from '../../../src/ha-connector/lifecycle.ts';

describe('ProviderLifecycleManager.reconcile', () => {
  let mockPool: Pool;
  let mockRouter: HaEventRouter;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
    } as unknown as Pool;

    mockRouter = {
      dispatch: vi.fn(),
      notifyConnect: vi.fn(),
      notifyDisconnect: vi.fn(),
      shutdown: vi.fn(),
      register: vi.fn(),
    } as unknown as HaEventRouter;
  });

  it('reconnects provider when config changes', async () => {
    const lifecycle = new ProviderLifecycleManager(mockPool, mockRouter);

    // First call returns initial config
    (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{
        id: 'p1',
        provider_type: 'home_assistant',
        label: 'HA',
        config: { url: 'https://old.ha' },
        credentials: null,
        status: 'active',
        owner_email: 'user@test.com',
      }],
    });

    // Mock connectProvider to avoid real WS
    const connectSpy = vi
      .spyOn(lifecycle as never as { connectProvider: () => Promise<unknown> }, 'connectProvider')
      .mockResolvedValue({
        disconnect: vi.fn(),
        addEntities: vi.fn(),
        removeEntities: vi.fn(),
        isConnected: () => true,
      });
    vi.spyOn(lifecycle as never as { updateStatus: () => Promise<void> }, 'updateStatus').mockResolvedValue(undefined);

    await lifecycle.start();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // Reconcile with changed config
    (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{
        id: 'p1',
        provider_type: 'home_assistant',
        label: 'HA',
        config: { url: 'https://new.ha' },
        credentials: null,
        status: 'active',
        owner_email: 'user@test.com',
      }],
    });

    await lifecycle.reconcile();
    // Should have reconnected (removed + added = 2 total connect calls)
    expect(connectSpy).toHaveBeenCalledTimes(2);
  });

  it('does not reconnect when config is unchanged', async () => {
    const lifecycle = new ProviderLifecycleManager(mockPool, mockRouter);

    const row = {
      id: 'p1',
      provider_type: 'home_assistant',
      label: 'HA',
      config: { url: 'https://same.ha' },
      credentials: null,
      status: 'active',
      owner_email: 'user@test.com',
    };

    (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [row] });

    const connectSpy = vi
      .spyOn(lifecycle as never as { connectProvider: () => Promise<unknown> }, 'connectProvider')
      .mockResolvedValue({
        disconnect: vi.fn(),
        addEntities: vi.fn(),
        removeEntities: vi.fn(),
        isConnected: () => true,
      });
    vi.spyOn(lifecycle as never as { updateStatus: () => Promise<void> }, 'updateStatus').mockResolvedValue(undefined);

    await lifecycle.start();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // Reconcile with same config — should NOT reconnect
    (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [row] });

    await lifecycle.reconcile();
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });
});
