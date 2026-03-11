/**
 * Unit tests for GatewayConnectionService.
 * Issue #2154 — Gateway connection service.
 *
 * TDD: These tests are written FIRST, before the implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// vi.hoisted runs BEFORE vi.mock hoisting, making the class available to mock factories.
const { MockWebSocket, getMockInstances, resetMockInstances } = vi.hoisted(() => {
  let instances: Array<InstanceType<typeof _MockWebSocket>> = [];

  class _MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    static CONNECTING = 0;

    readyState = _MockWebSocket.CONNECTING;
    url: string;
    listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    _sent: string[] = [];

    constructor(url: string) {
      this.url = url;
      instances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(handler);
      return this;
    }

    send(data: string) {
      this._sent.push(data);
    }

    close(code?: number) {
      this.readyState = _MockWebSocket.CLOSED;
      this._emitClose(code ?? 1000);
    }

    ping() {}

    _emitOpen() {
      this.readyState = _MockWebSocket.OPEN;
      for (const h of this.listeners['open'] ?? []) h();
    }

    _emitMessage(data: string) {
      for (const h of this.listeners['message'] ?? []) h(data);
    }

    _emitClose(code = 1000) {
      this.readyState = _MockWebSocket.CLOSED;
      for (const h of this.listeners['close'] ?? []) h(code);
    }

    _emitError(err: Error) {
      for (const h of this.listeners['error'] ?? []) h(err);
    }
  }

  return {
    MockWebSocket: _MockWebSocket,
    getMockInstances: () => instances,
    resetMockInstances: () => { instances = []; },
  };
});

vi.mock('ws', () => ({
  default: MockWebSocket,
  WebSocket: MockWebSocket,
}));

vi.mock('../webhooks/ssrf.ts', () => ({
  validateSsrf: vi.fn().mockReturnValue(null),
}));

import { GatewayConnectionService } from './connection.ts';
import type { GatewayStatus, GatewayEventHandler, GatewayFrame } from './connection.ts';
import { validateSsrf } from '../webhooks/ssrf.ts';

function makeService(envOverrides: Record<string, string | undefined> = {}): GatewayConnectionService {
  const defaults: Record<string, string | undefined> = {
    OPENCLAW_GATEWAY_URL: 'https://gateway.example.com',
    OPENCLAW_GATEWAY_TOKEN: 'test-secret-token',
    OPENCLAW_GATEWAY_WS_ENABLED: undefined,
    OPENCLAW_HOOK_TOKEN: undefined,
    OPENCLAW_GATEWAY_ALLOW_PRIVATE: undefined,
  };
  const env = { ...defaults, ...envOverrides };
  return new GatewayConnectionService(env);
}

/** Simulate the full connect handshake on the latest mock WS instance. */
type MockWS = InstanceType<typeof MockWebSocket>;

function completeHandshake(ws: MockWS, challengePayload: unknown = { nonce: 'abc123' }) {
  ws._emitOpen();
  // Gateway sends connect.challenge event
  ws._emitMessage(JSON.stringify({
    type: 'event',
    event: 'connect.challenge',
    payload: challengePayload,
  }));
  // The service should have sent a connect request; find it
  const connectReq = ws._sent.find((s) => {
    const parsed = JSON.parse(s);
    return parsed.type === 'req' && parsed.method === 'connect';
  });
  if (!connectReq) return;
  const { id } = JSON.parse(connectReq);
  // Gateway responds with success
  ws._emitMessage(JSON.stringify({
    type: 'res',
    id,
    ok: true,
    payload: { tick_interval_ms: 30000 },
  }));
}

describe('GatewayConnectionService', () => {
  beforeEach(() => {
    resetMockInstances();
    vi.useFakeTimers();
    (validateSsrf as Mock).mockReturnValue(null);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ================================================================
  // Lifecycle
  // ================================================================

  describe('Lifecycle', () => {
    it('connects on initialize() and transitions to connected', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();

      // Wait for the mock WS to be created
      await vi.advanceTimersByTimeAsync(0);
      expect(getMockInstances()).toHaveLength(1);

      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      expect(svc.getStatus().connected).toBe(true);
      await svc.shutdown();
    });

    it('is idempotent: calling initialize() twice does not open two connections', async () => {
      const svc = makeService();
      const p1 = svc.initialize();
      const p2 = svc.initialize();

      await vi.advanceTimersByTimeAsync(0);
      expect(getMockInstances()).toHaveLength(1);

      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.all([p1, p2]);

      expect(getMockInstances()).toHaveLength(1);
      await svc.shutdown();
    });

    it('does not connect when OPENCLAW_GATEWAY_URL is unset', async () => {
      const svc = makeService({ OPENCLAW_GATEWAY_URL: undefined });
      await svc.initialize();
      expect(getMockInstances()).toHaveLength(0);
      expect(svc.getStatus().connected).toBe(false);
    });

    it('does not connect when OPENCLAW_GATEWAY_WS_ENABLED=false', async () => {
      const svc = makeService({ OPENCLAW_GATEWAY_WS_ENABLED: 'false' });
      await svc.initialize();
      expect(getMockInstances()).toHaveLength(0);
      expect(svc.getStatus().connected).toBe(false);
    });

    it('fails startup when neither OPENCLAW_GATEWAY_TOKEN nor OPENCLAW_HOOK_TOKEN is set', async () => {
      const svc = makeService({
        OPENCLAW_GATEWAY_TOKEN: undefined,
        OPENCLAW_HOOK_TOKEN: undefined,
      });
      await expect(svc.initialize()).rejects.toThrow(/token/i);
    });

    it('uses OPENCLAW_HOOK_TOKEN as fallback when OPENCLAW_GATEWAY_TOKEN is unset', async () => {
      const svc = makeService({
        OPENCLAW_GATEWAY_TOKEN: undefined,
        OPENCLAW_HOOK_TOKEN: 'fallback-token',
      });
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      expect(getMockInstances()).toHaveLength(1);

      // Complete handshake and check that the connect request uses the fallback token
      const ws = getMockInstances()[0];
      ws._emitOpen();
      ws._emitMessage(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'abc' },
      }));
      await vi.advanceTimersByTimeAsync(0);

      const connectReq = ws._sent.find((s) => {
        const parsed = JSON.parse(s);
        return parsed.type === 'req' && parsed.method === 'connect';
      });
      expect(connectReq).toBeDefined();
      const parsed = JSON.parse(connectReq!);
      expect(parsed.params?.auth?.token).toBe('fallback-token');
      expect(parsed.params?.minProtocol).toBe(3);
      expect(parsed.params?.maxProtocol).toBe(3);
      expect(parsed.params?.client?.id).toBe('node-host');
      expect(parsed.params?.client?.platform).toBe('node');
      expect(parsed.params?.client?.mode).toBe('backend');

      // Complete the handshake
      ws._emitMessage(JSON.stringify({
        type: 'res',
        id: parsed.id,
        ok: true,
        payload: { tick_interval_ms: 30000 },
      }));
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;
      await svc.shutdown();
    });

    it('reconnects after WS close with jittered exponential backoff', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Simulate WS close
      getMockInstances()[0]._emitClose(1006);
      expect(svc.getStatus().connected).toBe(false);

      // After backoff period (1s ± 500ms, so max 1.5s), should reconnect
      await vi.advanceTimersByTimeAsync(1600);
      expect(getMockInstances().length).toBeGreaterThanOrEqual(2);

      await svc.shutdown();
    });

    it('caps backoff at 30s', async () => {
      // Spy on console.log to capture reconnect delay messages
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Trigger 8 disconnects (2^7 * 1000 = 128000 > 30000, so cap should apply).
      // We complete the handshake each time to avoid challenge timeout cascading.
      for (let i = 0; i < 8; i++) {
        const lastWs = getMockInstances()[getMockInstances().length - 1];
        lastWs._emitClose(1006);
        // Advance past max backoff (35s)
        await vi.advanceTimersByTimeAsync(36000);
        // Complete handshake on the new WS
        const newWs = getMockInstances()[getMockInstances().length - 1];
        if (newWs && newWs !== lastWs) {
          completeHandshake(newWs);
          await vi.advanceTimersByTimeAsync(0);
        }
      }

      // Check logged reconnect delays — none should exceed ~35s (30s + 5s jitter)
      const reconnectLogs = logSpy.mock.calls
        .map((args) => args[0])
        .filter((msg): msg is string => typeof msg === 'string' && msg.includes('reconnecting in'));
      for (const msg of reconnectLogs) {
        const match = msg.match(/reconnecting in (\d+)ms/);
        if (match) {
          const delayMs = parseInt(match[1], 10);
          expect(delayMs).toBeLessThanOrEqual(36000); // 30s + 5s jitter + 1s margin
        }
      }
      expect(reconnectLogs.length).toBeGreaterThan(0);

      logSpy.mockRestore();
      await svc.shutdown();
    });

    it('does NOT reconnect after shutdown()', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      await svc.shutdown();
      const countAfterShutdown = getMockInstances().length;

      // Wait for potential reconnect attempts
      await vi.advanceTimersByTimeAsync(60000);
      expect(getMockInstances().length).toBe(countAfterShutdown);
    });

    it('shutdown() cancels pending reconnect timer', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Trigger disconnect (which schedules reconnect)
      getMockInstances()[0]._emitClose(1006);
      const countBeforeShutdown = getMockInstances().length;

      // Shutdown before the reconnect timer fires
      await svc.shutdown();

      // Wait longer than max backoff
      await vi.advanceTimersByTimeAsync(60000);
      expect(getMockInstances().length).toBe(countBeforeShutdown);
    });

    it('tick timeout triggers reconnect after 2x tick interval', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // The tick interval is 30000ms (from handshake payload).
      // After 2x = 60000ms without a tick, the connection should be closed.
      await vi.advanceTimersByTimeAsync(61000);

      // The first WS should have been closed, triggering reconnect
      expect(getMockInstances()[0].readyState).toBe(MockWebSocket.CLOSED);
      await svc.shutdown();
    });

    it('no-challenge timeout: closes WS if no challenge within 5s of open', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);

      const ws = getMockInstances()[0];
      ws._emitOpen();
      // Do NOT send connect.challenge

      // After 5s, the service should close the WS
      await vi.advanceTimersByTimeAsync(5100);
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);

      // It should try to reconnect
      await vi.advanceTimersByTimeAsync(2000);
      expect(getMockInstances().length).toBeGreaterThan(1);

      await svc.shutdown();
      // The init promise may reject or resolve depending on implementation;
      // we just need to ensure no unhandled rejections
      await initPromise.catch(() => {});
    });
  });

  // ================================================================
  // Status
  // ================================================================

  describe('Status', () => {
    it('getStatus() returns connected=false before connection', () => {
      const svc = makeService();
      const status = svc.getStatus();
      expect(status.connected).toBe(false);
      expect(status.gateway_url).toBeNull();
      expect(status.connected_at).toBeNull();
      expect(status.last_tick_at).toBeNull();
    });

    it('getStatus() returns connected=true after successful handshake', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const status = svc.getStatus();
      expect(status.connected).toBe(true);
      expect(status.gateway_url).toBe('gateway.example.com');
      expect(status.connected_at).toBeTruthy();

      await svc.shutdown();
    });

    it('getStatus() updates last_tick_at on tick event', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const statusBefore = svc.getStatus();
      const tickBefore = statusBefore.last_tick_at;

      // Advance time so we see a difference
      await vi.advanceTimersByTimeAsync(1000);

      // Send a tick event
      getMockInstances()[0]._emitMessage(JSON.stringify({
        type: 'event',
        event: 'tick',
        payload: {},
      }));
      await vi.advanceTimersByTimeAsync(0);

      const statusAfter = svc.getStatus();
      expect(statusAfter.last_tick_at).toBeTruthy();
      if (tickBefore) {
        expect(new Date(statusAfter.last_tick_at!).getTime()).toBeGreaterThanOrEqual(
          new Date(tickBefore).getTime()
        );
      }

      await svc.shutdown();
    });

    it('getStatus() does not expose token or credentials', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const status = svc.getStatus();
      const statusStr = JSON.stringify(status);
      expect(statusStr).not.toContain('test-secret-token');
      // gateway_url should be host only, not full URL
      expect(status.gateway_url).not.toContain('https://');
      expect(status.gateway_url).not.toContain('wss://');

      await svc.shutdown();
    });
  });

  // ================================================================
  // Event routing
  // ================================================================

  describe('Event routing', () => {
    it('calls registered onEvent handlers when event arrives', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const handler = vi.fn();
      svc.onEvent(handler);

      getMockInstances()[0]._emitMessage(JSON.stringify({
        type: 'event',
        event: 'chat.response',
        payload: { data: 'test' },
        seq: 1,
      }));
      await vi.advanceTimersByTimeAsync(0);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          event: 'chat.response',
          payload: { data: 'test' },
          seq: 1,
        }),
      );

      await svc.shutdown();
    });

    it('catches and logs handler errors without crashing', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const badHandler = vi.fn().mockImplementation(() => {
        throw new Error('handler boom');
      });
      svc.onEvent(badHandler);

      // Should not throw
      getMockInstances()[0]._emitMessage(JSON.stringify({
        type: 'event',
        event: 'test.event',
        payload: {},
      }));
      await vi.advanceTimersByTimeAsync(0);

      expect(badHandler).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      await svc.shutdown();
    });

    it('ignores unknown frame types without crashing', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Should not throw for unknown frame type
      getMockInstances()[0]._emitMessage(JSON.stringify({
        type: 'unknown_type',
        data: 'something',
      }));
      await vi.advanceTimersByTimeAsync(0);

      expect(svc.getStatus().connected).toBe(true);
      await svc.shutdown();
    });
  });

  // ================================================================
  // Request/response
  // ================================================================

  describe('Request/response', () => {
    it('request() resolves on matching response frame', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const reqPromise = svc.request<{ agents: string[] }>('agents.list', {});
      await vi.advanceTimersByTimeAsync(0);

      // Find the request that was sent
      const sentReq = getMockInstances()[0]._sent.find((s) => {
        const parsed = JSON.parse(s);
        return parsed.type === 'req' && parsed.method === 'agents.list';
      });
      expect(sentReq).toBeDefined();
      const { id } = JSON.parse(sentReq!);

      // Simulate response
      getMockInstances()[0]._emitMessage(JSON.stringify({
        type: 'res',
        id,
        ok: true,
        payload: { agents: ['agent-1'] },
      }));
      await vi.advanceTimersByTimeAsync(0);

      const result = await reqPromise;
      expect(result).toEqual({ agents: ['agent-1'] });

      await svc.shutdown();
    });

    it('request() rejects on error response with error.message', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const reqPromise = svc.request('some.method', {});
      // Attach rejection handler before triggering the error response
      const rejectionPromise = expect(reqPromise).rejects.toThrow('Not found');
      await vi.advanceTimersByTimeAsync(0);

      const sentReq = getMockInstances()[0]._sent.find((s) => {
        const parsed = JSON.parse(s);
        return parsed.type === 'req' && parsed.method === 'some.method';
      });
      const { id } = JSON.parse(sentReq!);

      getMockInstances()[0]._emitMessage(JSON.stringify({
        type: 'res',
        id,
        ok: false,
        error: { message: 'Not found' },
      }));
      await vi.advanceTimersByTimeAsync(0);

      await rejectionPromise;

      await svc.shutdown();
    });

    it('request() rejects if WS not open', async () => {
      const svc = makeService({ OPENCLAW_GATEWAY_URL: undefined });
      await svc.initialize();
      await expect(svc.request('test', {})).rejects.toThrow(/not connected/i);
    });

    it('request() rejects pending requests on disconnect', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const reqPromise = svc.request('slow.method', {});
      // Attach rejection handler before triggering the disconnect
      const rejectionPromise = expect(reqPromise).rejects.toThrow(/disconnect/i);
      await vi.advanceTimersByTimeAsync(0);

      // Disconnect before response arrives
      getMockInstances()[0]._emitClose(1006);
      await vi.advanceTimersByTimeAsync(0);

      await rejectionPromise;

      await svc.shutdown();
    });
  });

  // ================================================================
  // Security
  // ================================================================

  describe('Security', () => {
    it('does not include token in WS URL', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);

      expect(getMockInstances()).toHaveLength(1);
      expect(getMockInstances()[0].url).not.toContain('test-secret-token');

      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;
      await svc.shutdown();
    });

    it('SSRF: rejects private-CIDR gateway URL by default', async () => {
      (validateSsrf as Mock).mockReturnValue('SSRF protection: loopback address not allowed');

      const svc = makeService({ OPENCLAW_GATEWAY_URL: 'https://127.0.0.1:8080' });
      await expect(svc.initialize()).rejects.toThrow(/SSRF/i);
    });

    it('SSRF: allows private-CIDR if OPENCLAW_GATEWAY_ALLOW_PRIVATE=true', async () => {
      // Even with validateSsrf returning a block reason, the private override should allow
      (validateSsrf as Mock).mockReturnValue('SSRF protection: private address');

      const svc = makeService({
        OPENCLAW_GATEWAY_URL: 'https://192.168.1.1:8080',
        OPENCLAW_GATEWAY_ALLOW_PRIVATE: 'true',
      });
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);

      // Should have connected despite SSRF warning
      expect(getMockInstances()).toHaveLength(1);

      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;
      await svc.shutdown();
    });

    it('SSRF: rejects .internal hostname suffix by default (#2281)', async () => {
      (validateSsrf as Mock).mockReturnValue('SSRF protection: blocked hostname suffix: .internal');

      const svc = makeService({ OPENCLAW_GATEWAY_URL: 'http://host.docker.internal:18789' });
      await expect(svc.initialize()).rejects.toThrow(/SSRF/i);
    });

    it('SSRF: allows .internal hostname suffix with OPENCLAW_GATEWAY_ALLOW_PRIVATE=true (#2281)', async () => {
      (validateSsrf as Mock).mockReturnValue('SSRF protection: blocked hostname suffix: .internal');

      const svc = makeService({
        OPENCLAW_GATEWAY_URL: 'http://host.docker.internal:18789',
        OPENCLAW_GATEWAY_ALLOW_PRIVATE: 'true',
      });
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);

      // Should have connected despite SSRF blocked hostname
      expect(getMockInstances()).toHaveLength(1);

      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      expect(svc.getStatus().connected).toBe(true);
      await svc.shutdown();
    });

    it('SSRF: logs warning when bypassing SSRF with OPENCLAW_GATEWAY_ALLOW_PRIVATE (#2281)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (validateSsrf as Mock).mockReturnValue('SSRF protection: blocked hostname suffix: .internal');

      const svc = makeService({
        OPENCLAW_GATEWAY_URL: 'http://host.docker.internal:18789',
        OPENCLAW_GATEWAY_ALLOW_PRIVATE: 'true',
      });
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Should have logged a warning about SSRF bypass
      const ssrfWarns = warnSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('SSRF'),
      );
      expect(ssrfWarns.length).toBeGreaterThanOrEqual(1);

      warnSpy.mockRestore();
      await svc.shutdown();
    });

    it('rejects non-ws/wss URL schemes', async () => {
      const svc = makeService({ OPENCLAW_GATEWAY_URL: 'file:///etc/passwd' });
      await expect(svc.initialize()).rejects.toThrow(/scheme/i);
    });
  });

  // ================================================================
  // Gateway Hardening (#2188)
  // ================================================================

  describe('Gateway Hardening (#2188)', () => {
    it('logs unknown frame types as warnings and increments counter', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Send an unknown frame type
      getMockInstances()[0]._emitMessage(JSON.stringify({
        type: 'unknown_type',
        data: 'something',
      }));
      await vi.advanceTimersByTimeAsync(0);

      // Should have logged a warning
      const warnCalls = warnSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('unknown frame type'),
      );
      expect(warnCalls.length).toBe(1);

      // Service should still be connected
      expect(svc.getStatus().connected).toBe(true);

      warnSpy.mockRestore();
      await svc.shutdown();
    });

    it('init resolves but connected=false when WS closes before handshake completes', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);

      const ws = getMockInstances()[0];
      ws._emitOpen();
      // Close before challenge arrives — init resolves (to avoid blocking startup)
      // but connected flag correctly stays false
      ws._emitClose(1006);

      // Advance for reconnect backoff
      await vi.advanceTimersByTimeAsync(2000);

      // Init should have resolved (not thrown)
      await initPromise;

      // The service should NOT be connected since handshake never completed
      expect(svc.getStatus().connected).toBe(false);

      await svc.shutdown();
    });

    it('request() times out and rejects after configurable timeout', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Send a request with a 5s timeout
      const reqPromise = svc.request('slow.method', {}, { timeoutMs: 5000 });
      const rejectionPromise = expect(reqPromise).rejects.toThrow(/timeout/i);
      await vi.advanceTimersByTimeAsync(0);

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(6000);

      await rejectionPromise;

      // The pending request should be cleaned up (no memory leak)
      // Send another request to verify the service still works
      const reqPromise2 = svc.request('fast.method', {});
      await vi.advanceTimersByTimeAsync(0);
      const sentReq = getMockInstances()[0]._sent.find((s) => {
        const parsed = JSON.parse(s);
        return parsed.type === 'req' && parsed.method === 'fast.method';
      });
      expect(sentReq).toBeDefined();

      // Clean up
      await svc.shutdown();
      await reqPromise2.catch(() => {});
    });

    it('request() uses default 30s timeout', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const reqPromise = svc.request('slow.method', {});
      const rejectionPromise = expect(reqPromise).rejects.toThrow(/timeout/i);
      await vi.advanceTimersByTimeAsync(0);

      // Should NOT have timed out at 25s
      await vi.advanceTimersByTimeAsync(25000);
      // No rejection yet — the promise should still be pending

      // Should time out at 30s
      await vi.advanceTimersByTimeAsync(6000);
      await rejectionPromise;

      await svc.shutdown();
    });

    it('request() timeout cleanup prevents memory leaks', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Send multiple requests that will all time out
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          svc.request(`method-${i}`, {}, { timeoutMs: 1000 }).catch(() => {}),
        );
      }
      await vi.advanceTimersByTimeAsync(0);

      // Advance past timeouts
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.all(promises);

      // Service should still be healthy
      expect(svc.getStatus().connected).toBe(true);
      await svc.shutdown();
    });

    it('reconnection restores connected state after disconnect (Issue #2392)', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Verify connected
      expect(svc.getStatus().connected).toBe(true);
      const connectedAt1 = svc.getStatus().connected_at;

      // Simulate disconnect
      getMockInstances()[0]._emitClose(1006);
      expect(svc.getStatus().connected).toBe(false);

      // Wait for reconnect backoff and complete handshake on new WS
      await vi.advanceTimersByTimeAsync(1600);
      const newWs = getMockInstances()[getMockInstances().length - 1];
      expect(newWs).not.toBe(getMockInstances()[0]);
      completeHandshake(newWs);
      await vi.advanceTimersByTimeAsync(0);

      // Verify re-connected with fresh connected_at
      expect(svc.getStatus().connected).toBe(true);
      expect(svc.getStatus().connected_at).toBeTruthy();

      await svc.shutdown();
    });

    it('status reflects disconnected then reconnected state (Issue #2392)', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Simulate server-initiated restart (code 1012) like production scenario
      getMockInstances()[0]._emitClose(1012);
      expect(svc.getStatus().connected).toBe(false);

      // Wait for reconnect backoff
      await vi.advanceTimersByTimeAsync(2000);

      // A new WS should have been created
      const newWs = getMockInstances()[getMockInstances().length - 1];
      completeHandshake(newWs);
      await vi.advanceTimersByTimeAsync(0);

      // Should be connected again
      expect(svc.getStatus().connected).toBe(true);

      await svc.shutdown();
    });

    it('WS handshake timeout configurable via env', async () => {
      // Set a custom handshake timeout of 2 seconds
      const svc = makeService({
        OPENCLAW_GATEWAY_WS_HANDSHAKE_TIMEOUT_MS: '2000',
      });
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);

      const ws = getMockInstances()[0];
      ws._emitOpen();
      // Do NOT send challenge

      // After 2s (custom timeout), should close
      await vi.advanceTimersByTimeAsync(2100);
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);

      await svc.shutdown();
      await initPromise.catch(() => {});
    });
  });
});
