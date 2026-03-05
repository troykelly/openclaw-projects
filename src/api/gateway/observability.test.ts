/**
 * Tests for gateway WebSocket observability — structured logging and metrics integration.
 * Issue #2164 — Structured logging and metrics for gateway WebSocket lifecycle.
 *
 * Verifies that:
 * - Critical log lines are emitted with correct prefixes
 * - Token values are never logged
 * - Metric counters increment at the right lifecycle points
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// ── Mock WebSocket ──────────────────────────────────────────────────
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
import {
  gwConnectAttempts,
  gwReconnects,
  gwEventsReceived,
  gwAuthFailures,
} from './metrics.ts';

type MockWS = InstanceType<typeof MockWebSocket>;

function makeService(envOverrides: Record<string, string | undefined> = {}): GatewayConnectionService {
  const defaults: Record<string, string | undefined> = {
    OPENCLAW_GATEWAY_URL: 'https://gateway.example.com',
    OPENCLAW_GATEWAY_TOKEN: 'super-secret-token-value',
    OPENCLAW_GATEWAY_WS_ENABLED: undefined,
    OPENCLAW_HOOK_TOKEN: undefined,
    OPENCLAW_GATEWAY_ALLOW_PRIVATE: undefined,
  };
  return new GatewayConnectionService({ ...defaults, ...envOverrides });
}

function completeHandshake(ws: MockWS) {
  ws._emitOpen();
  ws._emitMessage(JSON.stringify({
    type: 'event',
    event: 'connect.challenge',
    payload: { nonce: 'abc123' },
  }));
  const connectReq = ws._sent.find((s) => {
    const parsed = JSON.parse(s);
    return parsed.type === 'req' && parsed.method === 'connect';
  });
  if (!connectReq) return;
  const { id } = JSON.parse(connectReq);
  ws._emitMessage(JSON.stringify({
    type: 'res',
    id,
    ok: true,
    payload: { tick_interval_ms: 30000 },
  }));
}

describe('GatewayWS Observability', () => {
  let logSpy: Mock;
  let warnSpy: Mock;

  beforeEach(() => {
    resetMockInstances();
    vi.useFakeTimers();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Structured Logging ──────────────────────────────────────────

  describe('structured logging', () => {
    it('logs [GatewayWS] connecting when initialize called', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const connectingLog = logSpy.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('[GatewayWS] connecting'),
      );
      expect(connectingLog).toBeDefined();
      await svc.shutdown();
    });

    it('logs [GatewayWS] connected after handshake', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const connectedLog = logSpy.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0] === '[GatewayWS] connected',
      );
      expect(connectedLog).toBeDefined();
      await svc.shutdown();
    });

    it('logs [GatewayWS] disconnected with code on close', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      const ws = getMockInstances()[0];
      completeHandshake(ws);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Trigger disconnect
      ws._emitClose(1006);

      const disconnectedLog = logSpy.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('[GatewayWS] disconnected'),
      );
      expect(disconnectedLog).toBeDefined();
      expect(disconnectedLog![0]).toContain('code 1006');
      await svc.shutdown();
    });

    it('logs [GatewayWS] reconnecting with delay and attempt number', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      const ws = getMockInstances()[0];
      completeHandshake(ws);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Trigger disconnect to cause reconnect
      ws._emitClose(1006);

      const reconnectLog = logSpy.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('[GatewayWS] reconnecting in') &&
          call[0].includes('attempt'),
      );
      expect(reconnectLog).toBeDefined();
      await svc.shutdown();
    });

    it('never logs token values in any log line', async () => {
      const TOKEN = 'super-secret-token-value';
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      const ws = getMockInstances()[0];
      completeHandshake(ws);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      // Trigger disconnect to also test reconnect logs
      ws._emitClose(1006);
      await vi.advanceTimersByTimeAsync(0);

      // Check all console.log, console.warn, console.error calls
      const allLogs = [
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...(console.error as Mock).mock.calls,
      ];

      for (const call of allLogs) {
        const logStr = call.map(String).join(' ');
        expect(logStr).not.toContain(TOKEN);
      }

      await svc.shutdown();
    });
  });

  // ── Metrics Counters ────────────────────────────────────────────

  describe('metrics counters', () => {
    it('gwConnectAttempts increments on connect', async () => {
      const before = gwConnectAttempts.get();
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      completeHandshake(getMockInstances()[0]);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      expect(gwConnectAttempts.get()).toBeGreaterThan(before);
      await svc.shutdown();
    });

    it('gwReconnects increments on reconnect (not first connect)', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      const ws = getMockInstances()[0];
      completeHandshake(ws);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const beforeReconnects = gwReconnects.get();

      // Trigger disconnect to schedule reconnect
      ws._emitClose(1006);
      await vi.advanceTimersByTimeAsync(0);

      expect(gwReconnects.get()).toBeGreaterThan(beforeReconnects);
      await svc.shutdown();
    });

    it('gwEventsReceived increments on each event', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      const ws = getMockInstances()[0];
      completeHandshake(ws);
      await vi.advanceTimersByTimeAsync(0);
      await initPromise;

      const before = gwEventsReceived.get();

      // Send a tick event (it's an event that goes through _handleEvent)
      ws._emitMessage(JSON.stringify({
        type: 'event',
        event: 'tick',
      }));
      await vi.advanceTimersByTimeAsync(0);

      expect(gwEventsReceived.get()).toBeGreaterThan(before);
      await svc.shutdown();
    });

    it('gwAuthFailures increments on connect rejection', async () => {
      const svc = makeService();
      const initPromise = svc.initialize();
      await vi.advanceTimersByTimeAsync(0);
      const ws = getMockInstances()[0];

      ws._emitOpen();
      // Send challenge
      ws._emitMessage(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'abc123' },
      }));
      await vi.advanceTimersByTimeAsync(0);

      const before = gwAuthFailures.get();

      // Find connect request and reject it
      const connectReq = ws._sent.find((s) => {
        const parsed = JSON.parse(s);
        return parsed.type === 'req' && parsed.method === 'connect';
      });
      const { id } = JSON.parse(connectReq!);
      ws._emitMessage(JSON.stringify({
        type: 'res',
        id,
        ok: false,
        error: { message: 'Invalid token' },
      }));
      await vi.advanceTimersByTimeAsync(0);

      // The close from the rejection will resolve the init promise
      await initPromise;

      expect(gwAuthFailures.get()).toBeGreaterThan(before);
      await svc.shutdown();
    });
  });
});
