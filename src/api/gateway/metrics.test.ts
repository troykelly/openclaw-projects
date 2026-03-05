/**
 * Tests for gateway WebSocket metrics.
 * Issue #2164 — Structured logging and metrics for gateway WebSocket lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  gwConnectAttempts,
  gwReconnects,
  gwEventsReceived,
  gwChatEventsRouted,
  gwDuplicateEventsSuppressed,
  gwAuthFailures,
  gwChatDispatchWs,
  gwChatDispatchHttp,
  getGatewayMetrics,
} from './metrics.ts';

describe('gateway metrics', () => {
  // Note: Counter instances are module-level singletons, so values accumulate
  // across tests within the same vitest run. We test relative increments.

  it('getGatewayMetrics returns all counter values', () => {
    const snapshot = getGatewayMetrics();
    expect(snapshot).toEqual(expect.objectContaining({
      connect_attempts: expect.any(Number),
      reconnects: expect.any(Number),
      events_received: expect.any(Number),
      chat_events_routed: expect.any(Number),
      duplicate_events_suppressed: expect.any(Number),
      auth_failures: expect.any(Number),
      chat_dispatch_ws: expect.any(Number),
      chat_dispatch_http: expect.any(Number),
    }));
  });

  it('connect_attempts increments on inc()', () => {
    const before = gwConnectAttempts.get();
    gwConnectAttempts.inc();
    expect(gwConnectAttempts.get()).toBe(before + 1);
  });

  it('reconnects increments on inc()', () => {
    const before = gwReconnects.get();
    gwReconnects.inc();
    expect(gwReconnects.get()).toBe(before + 1);
  });

  it('events_received increments on inc()', () => {
    const before = gwEventsReceived.get();
    gwEventsReceived.inc();
    expect(gwEventsReceived.get()).toBe(before + 1);
  });

  it('chat_events_routed increments on inc()', () => {
    const before = gwChatEventsRouted.get();
    gwChatEventsRouted.inc();
    expect(gwChatEventsRouted.get()).toBe(before + 1);
  });

  it('duplicate_events_suppressed increments on inc()', () => {
    const before = gwDuplicateEventsSuppressed.get();
    gwDuplicateEventsSuppressed.inc();
    expect(gwDuplicateEventsSuppressed.get()).toBe(before + 1);
  });

  it('auth_failures increments on inc()', () => {
    const before = gwAuthFailures.get();
    gwAuthFailures.inc();
    expect(gwAuthFailures.get()).toBe(before + 1);
  });

  it('chat_dispatch_ws increments on inc()', () => {
    const before = gwChatDispatchWs.get();
    gwChatDispatchWs.inc();
    expect(gwChatDispatchWs.get()).toBe(before + 1);
  });

  it('chat_dispatch_http increments on inc()', () => {
    const before = gwChatDispatchHttp.get();
    gwChatDispatchHttp.inc();
    expect(gwChatDispatchHttp.get()).toBe(before + 1);
  });

  it('getGatewayMetrics reflects counter increments', () => {
    const before = getGatewayMetrics();
    gwConnectAttempts.inc();
    gwChatDispatchWs.inc();
    const after = getGatewayMetrics();
    expect(after.connect_attempts).toBe(before.connect_attempts + 1);
    expect(after.chat_dispatch_ws).toBe(before.chat_dispatch_ws + 1);
  });
});
