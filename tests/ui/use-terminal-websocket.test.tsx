/**
 * @vitest-environment jsdom
 *
 * Tests for useTerminalWebSocket hook.
 * Issue #2072: Fatal close codes should not trigger reconnection.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalWebSocket } from '@/ui/hooks/use-terminal-websocket.ts';

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

interface MockWebSocket {
  url: string;
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

let mockInstances: MockWebSocket[] = [];

class MockWebSocketClass {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocketClass.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    mockInstances.push(this as unknown as MockWebSocket);
  }
}

vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: () => 'https://api.example.com',
  getWsBaseUrl: () => 'wss://api.example.com',
}));

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: () => 'test-jwt-token',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latestMockWs(): MockWebSocket {
  return mockInstances[mockInstances.length - 1];
}

function simulateOpen(ws: MockWebSocket): void {
  ws.readyState = MockWebSocketClass.OPEN;
  ws.onopen?.(new Event('open'));
}

function simulateClose(ws: MockWebSocket, code: number, reason = ''): void {
  ws.readyState = MockWebSocketClass.CLOSED;
  const event = new CloseEvent('close', { code, reason, wasClean: code === 1000 });
  ws.onclose?.(event);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTerminalWebSocket', () => {
  beforeEach(() => {
    mockInstances = [];
    vi.useFakeTimers();
    // Install mock WebSocket globally
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocketClass as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects with correct URL including token', () => {
    renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'abc-123',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    expect(mockInstances).toHaveLength(1);
    expect(latestMockWs().url).toBe(
      'wss://api.example.com/terminal/sessions/abc-123/attach?token=test-jwt-token',
    );
  });

  it('sets status to connected on open', () => {
    const { result } = renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'abc-123',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    expect(result.current.status).toBe('connecting');

    act(() => simulateOpen(latestMockWs()));

    expect(result.current.status).toBe('connected');
  });

  it('sets status to terminated on normal close (1000)', () => {
    const { result } = renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'abc-123',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));
    act(() => simulateClose(latestMockWs(), 1000, 'Session ended'));

    expect(result.current.status).toBe('terminated');
    // Should NOT schedule reconnection
    expect(mockInstances).toHaveLength(1);
  });

  it('does NOT reconnect on fatal close codes 4400-4499 (Issue #2072)', () => {
    const fatalCodes = [4400, 4401, 4404, 4499];

    for (const code of fatalCodes) {
      mockInstances = [];

      const { result, unmount } = renderHook(() =>
        useTerminalWebSocket({
          sessionId: 'abc-123',
          onData: vi.fn(),
          enabled: true,
        }),
      );

      act(() => simulateOpen(latestMockWs()));
      act(() => simulateClose(latestMockWs(), code, 'Fatal error'));

      expect(result.current.status).toBe('error');

      // Advance past reconnection delay — should NOT create new WebSocket
      act(() => vi.advanceTimersByTime(5000));
      expect(mockInstances).toHaveLength(1);

      unmount();
    }
  });

  it('DOES reconnect on server error close codes (4500+)', () => {
    const { result } = renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'abc-123',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));
    act(() => simulateClose(latestMockWs(), 4502, 'Worker unavailable'));

    expect(result.current.status).toBe('disconnected');

    // Advance past initial reconnection delay (1000ms)
    act(() => vi.advanceTimersByTime(1100));

    // Should have created a new WebSocket for reconnection
    expect(mockInstances).toHaveLength(2);
  });

  it('reconnects with exponential backoff', () => {
    renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'abc-123',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    // First connection fails with server error
    act(() => simulateOpen(latestMockWs()));
    act(() => simulateClose(latestMockWs(), 4500, 'gRPC error'));
    expect(mockInstances).toHaveLength(1);

    // After 1000ms: first reconnect
    act(() => vi.advanceTimersByTime(1100));
    expect(mockInstances).toHaveLength(2);

    // Second failure
    act(() => simulateClose(latestMockWs(), 4500, 'gRPC error'));

    // After 2000ms: second reconnect (doubled delay)
    act(() => vi.advanceTimersByTime(1500));
    expect(mockInstances).toHaveLength(2); // Not yet
    act(() => vi.advanceTimersByTime(600));
    expect(mockInstances).toHaveLength(3);
  });

  it('stops reconnecting on manual disconnect', () => {
    const { result } = renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'abc-123',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));
    act(() => result.current.disconnect());

    expect(result.current.status).toBe('disconnected');

    // Advance timers — should NOT reconnect
    act(() => vi.advanceTimersByTime(60000));
    // Only the initial connection
    expect(mockInstances).toHaveLength(1);
  });
});
