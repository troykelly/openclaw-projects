/**
 * Tests for HA event router — dispatch, batching, error isolation, lifecycle.
 * Issue #1443.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HaEventRouter } from './ha-event-router.ts';
import type {
  HaEventProcessor,
  HaEventProcessorConfig,
  HaStateChange,
} from './ha-event-processor.ts';

// ---------- helpers ----------

function makeChange(entityId: string, overrides?: Partial<HaStateChange>): HaStateChange {
  const domain = entityId.split('.')[0];
  return {
    entity_id: entityId,
    domain,
    old_state: null,
    new_state: 'on',
    old_attributes: {},
    new_attributes: {},
    last_changed: '2026-02-20T00:00:00Z',
    last_updated: '2026-02-20T00:00:00Z',
    context: { id: 'ctx-1', parent_id: null, user_id: null },
    ...overrides,
  };
}

function makeProcessor(
  config: Partial<HaEventProcessorConfig> & { id: string },
  handlers?: {
    onStateChange?: (change: HaStateChange, ns: string) => Promise<void>;
    onStateChangeBatch?: (changes: HaStateChange[], ns: string) => Promise<void>;
    onConnect?: (url: string) => Promise<void>;
    onDisconnect?: (reason: string) => Promise<void>;
    healthCheck?: () => Promise<boolean>;
    shutdown?: () => Promise<void>;
  },
): HaEventProcessor {
  const defaults: HaEventProcessorConfig = {
    id: config.id,
    name: config.name ?? config.id,
    filter: config.filter ?? {},
    mode: config.mode ?? 'individual',
    batchWindowMs: config.batchWindowMs,
  };

  return {
    getConfig: () => defaults,
    onStateChange: handlers?.onStateChange ?? vi.fn().mockResolvedValue(undefined),
    onStateChangeBatch: handlers?.onStateChangeBatch ?? vi.fn().mockResolvedValue(undefined),
    onConnect: handlers?.onConnect ?? vi.fn().mockResolvedValue(undefined),
    onDisconnect: handlers?.onDisconnect ?? vi.fn().mockResolvedValue(undefined),
    healthCheck: handlers?.healthCheck ?? vi.fn().mockResolvedValue(true),
    shutdown: handlers?.shutdown ?? vi.fn().mockResolvedValue(undefined),
  };
}

// ---------- tests ----------

describe('HaEventRouter', () => {
  let router: HaEventRouter;

  beforeEach(() => {
    vi.useFakeTimers();
    router = new HaEventRouter();
  });

  afterEach(async () => {
    await router.shutdown();
    vi.useRealTimers();
  });

  describe('dispatch to individual processor', () => {
    it('delivers matching events via onStateChange', async () => {
      const onStateChange = vi.fn().mockResolvedValue(undefined);
      const proc = makeProcessor(
        { id: 'geo', filter: { domains: ['device_tracker'] }, mode: 'individual' },
        { onStateChange },
      );
      router.register(proc);

      const change = makeChange('device_tracker.phone');
      await router.dispatch(change, 'default');

      expect(onStateChange).toHaveBeenCalledOnce();
      expect(onStateChange).toHaveBeenCalledWith(change, 'default');
    });

    it('does not deliver non-matching events', async () => {
      const onStateChange = vi.fn().mockResolvedValue(undefined);
      const proc = makeProcessor(
        { id: 'geo', filter: { domains: ['device_tracker'] }, mode: 'individual' },
        { onStateChange },
      );
      router.register(proc);

      await router.dispatch(makeChange('light.kitchen'), 'default');

      expect(onStateChange).not.toHaveBeenCalled();
    });
  });

  describe('dispatch to batched processor', () => {
    it('buffers events and flushes on timer', async () => {
      const onStateChangeBatch = vi.fn().mockResolvedValue(undefined);
      const proc = makeProcessor(
        {
          id: 'batch-proc',
          filter: { domains: ['sensor'] },
          mode: 'batched',
          batchWindowMs: 500,
        },
        { onStateChangeBatch },
      );
      router.register(proc);

      await router.dispatch(makeChange('sensor.temp_1'), 'default');
      await router.dispatch(makeChange('sensor.temp_2'), 'default');

      // Not yet flushed
      expect(onStateChangeBatch).not.toHaveBeenCalled();

      // Advance timer past batch window
      vi.advanceTimersByTime(600);
      // Allow flush promise to resolve
      await vi.runAllTimersAsync();

      expect(onStateChangeBatch).toHaveBeenCalledOnce();
      expect(onStateChangeBatch.mock.calls[0][0]).toHaveLength(2);
      expect(onStateChangeBatch.mock.calls[0][1]).toBe('default');
    });

    it('isolates batches by namespace to prevent cross-namespace leakage', async () => {
      const onStateChangeBatch = vi.fn().mockResolvedValue(undefined);
      const proc = makeProcessor(
        {
          id: 'batch-proc',
          filter: { domains: ['sensor'] },
          mode: 'batched',
          batchWindowMs: 500,
        },
        { onStateChangeBatch },
      );
      router.register(proc);

      // Dispatch events for two different namespaces within the same batch window
      await router.dispatch(makeChange('sensor.temp_1'), 'tenant-a');
      await router.dispatch(makeChange('sensor.temp_2'), 'tenant-b');
      await router.dispatch(makeChange('sensor.temp_3'), 'tenant-a');

      // Not yet flushed
      expect(onStateChangeBatch).not.toHaveBeenCalled();

      // Advance timer past batch window
      vi.advanceTimersByTime(600);
      await vi.runAllTimersAsync();

      // Should flush TWO separate batches — one per namespace
      expect(onStateChangeBatch).toHaveBeenCalledTimes(2);

      // Find which call was for which namespace
      const calls = onStateChangeBatch.mock.calls as [HaStateChange[], string][];
      const tenantACalls = calls.filter((c) => c[1] === 'tenant-a');
      const tenantBCalls = calls.filter((c) => c[1] === 'tenant-b');

      expect(tenantACalls).toHaveLength(1);
      expect(tenantBCalls).toHaveLength(1);

      // tenant-a got 2 events, tenant-b got 1
      expect(tenantACalls[0][0]).toHaveLength(2);
      expect(tenantBCalls[0][0]).toHaveLength(1);
    });

    it('does not flush non-matching events', async () => {
      const onStateChangeBatch = vi.fn().mockResolvedValue(undefined);
      const proc = makeProcessor(
        {
          id: 'batch-proc',
          filter: { domains: ['sensor'] },
          mode: 'batched',
          batchWindowMs: 500,
        },
        { onStateChangeBatch },
      );
      router.register(proc);

      await router.dispatch(makeChange('light.kitchen'), 'default');

      vi.advanceTimersByTime(600);
      await vi.runAllTimersAsync();

      expect(onStateChangeBatch).not.toHaveBeenCalled();
    });
  });

  describe('filter matching', () => {
    it('only matching processors receive events', async () => {
      const geoHandler = vi.fn().mockResolvedValue(undefined);
      const lightHandler = vi.fn().mockResolvedValue(undefined);

      const geoProc = makeProcessor(
        { id: 'geo', filter: { domains: ['device_tracker'] }, mode: 'individual' },
        { onStateChange: geoHandler },
      );
      const lightProc = makeProcessor(
        { id: 'lights', filter: { domains: ['light'] }, mode: 'individual' },
        { onStateChange: lightHandler },
      );

      router.register(geoProc);
      router.register(lightProc);

      await router.dispatch(makeChange('device_tracker.phone'), 'default');

      expect(geoHandler).toHaveBeenCalledOnce();
      expect(lightHandler).not.toHaveBeenCalled();
    });
  });

  describe('error isolation', () => {
    it('one processor throwing does not affect others', async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error('processor crash'));
      const successHandler = vi.fn().mockResolvedValue(undefined);

      const failingProc = makeProcessor(
        { id: 'failing', filter: {}, mode: 'individual' },
        { onStateChange: failingHandler },
      );
      const successProc = makeProcessor(
        { id: 'success', filter: {}, mode: 'individual' },
        { onStateChange: successHandler },
      );

      router.register(failingProc);
      router.register(successProc);

      // Should not throw even though one processor fails
      await router.dispatch(makeChange('device_tracker.phone'), 'default');

      expect(failingHandler).toHaveBeenCalledOnce();
      expect(successHandler).toHaveBeenCalledOnce();
    });
  });

  describe('batch flush on shutdown', () => {
    it('flushes pending batches before calling processor.shutdown', async () => {
      const callOrder: string[] = [];
      const onStateChangeBatch = vi.fn().mockImplementation(async () => {
        callOrder.push('batch');
      });
      const shutdown = vi.fn().mockImplementation(async () => {
        callOrder.push('shutdown');
      });

      const proc = makeProcessor(
        {
          id: 'batch-proc',
          filter: { domains: ['sensor'] },
          mode: 'batched',
          batchWindowMs: 5000,
        },
        { onStateChangeBatch, shutdown },
      );
      router.register(proc);

      await router.dispatch(makeChange('sensor.temp_1'), 'default');

      // Shutdown before timer fires
      await router.shutdown();

      expect(onStateChangeBatch).toHaveBeenCalledOnce();
      expect(shutdown).toHaveBeenCalledOnce();
      expect(callOrder).toEqual(['batch', 'shutdown']);
    });
  });

  describe('health check', () => {
    it('returns per-processor health status', async () => {
      const healthyProc = makeProcessor(
        { id: 'healthy', filter: {}, mode: 'individual' },
        { healthCheck: vi.fn().mockResolvedValue(true) },
      );
      const unhealthyProc = makeProcessor(
        { id: 'unhealthy', filter: {}, mode: 'individual' },
        { healthCheck: vi.fn().mockResolvedValue(false) },
      );

      router.register(healthyProc);
      router.register(unhealthyProc);

      const status = await router.healthCheck();
      expect(status.get('healthy')).toBe(true);
      expect(status.get('unhealthy')).toBe(false);
    });

    it('treats health check errors as unhealthy', async () => {
      const errorProc = makeProcessor(
        { id: 'error', filter: {}, mode: 'individual' },
        { healthCheck: vi.fn().mockRejectedValue(new Error('check failed')) },
      );

      router.register(errorProc);

      const status = await router.healthCheck();
      expect(status.get('error')).toBe(false);
    });
  });

  describe('register / unregister', () => {
    it('unregistered processor no longer receives events', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const proc = makeProcessor(
        { id: 'removable', filter: {}, mode: 'individual' },
        { onStateChange: handler },
      );
      router.register(proc);

      await router.dispatch(makeChange('device_tracker.phone'), 'default');
      expect(handler).toHaveBeenCalledOnce();

      router.unregister('removable');

      await router.dispatch(makeChange('device_tracker.phone'), 'default');
      // Still only called once — no additional calls after unregister
      expect(handler).toHaveBeenCalledOnce();
    });

    it('throws when registering duplicate processor ID', () => {
      const proc1 = makeProcessor({ id: 'dup', filter: {}, mode: 'individual' });
      const proc2 = makeProcessor({ id: 'dup', filter: {}, mode: 'individual' });

      router.register(proc1);
      expect(() => router.register(proc2)).toThrow('dup');
    });
  });

  describe('notifyConnect / notifyDisconnect', () => {
    it('calls onConnect on all processors', async () => {
      const connect1 = vi.fn().mockResolvedValue(undefined);
      const connect2 = vi.fn().mockResolvedValue(undefined);

      router.register(makeProcessor({ id: 'p1', filter: {} }, { onConnect: connect1 }));
      router.register(makeProcessor({ id: 'p2', filter: {} }, { onConnect: connect2 }));

      await router.notifyConnect('wss://ha.example.com');

      expect(connect1).toHaveBeenCalledWith('wss://ha.example.com');
      expect(connect2).toHaveBeenCalledWith('wss://ha.example.com');
    });

    it('calls onDisconnect on all processors', async () => {
      const disconnect1 = vi.fn().mockResolvedValue(undefined);
      const disconnect2 = vi.fn().mockResolvedValue(undefined);

      router.register(makeProcessor({ id: 'p1', filter: {} }, { onDisconnect: disconnect1 }));
      router.register(makeProcessor({ id: 'p2', filter: {} }, { onDisconnect: disconnect2 }));

      await router.notifyDisconnect('connection lost');

      expect(disconnect1).toHaveBeenCalledWith('connection lost');
      expect(disconnect2).toHaveBeenCalledWith('connection lost');
    });
  });
});
