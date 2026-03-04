/**
 * @vitest-environment jsdom
 *
 * Tests for Phase 1 fixes (Epic #2130):
 * - #2120: Fatal close codes capture event.reason
 * - #2100: Host key info from events (not heuristic)
 * - #2112: Fatal errors hide Retry button, show closeReason
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalWebSocket, isFatalCloseCode } from '@/ui/hooks/use-terminal-websocket';

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

interface MockWebSocket {
  url: string;
  readyState: number;
  binaryType: string;
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
  binaryType = 'blob';
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

describe('Phase 1: #2120 — isFatalCloseCode', () => {
  it('returns true for codes in 4400-4499 range', () => {
    expect(isFatalCloseCode(4400)).toBe(true);
    expect(isFatalCloseCode(4401)).toBe(true);
    expect(isFatalCloseCode(4404)).toBe(true);
    expect(isFatalCloseCode(4499)).toBe(true);
  });

  it('returns false for codes outside fatal range', () => {
    expect(isFatalCloseCode(1000)).toBe(false);
    expect(isFatalCloseCode(1006)).toBe(false);
    expect(isFatalCloseCode(4500)).toBe(false);
    expect(isFatalCloseCode(4399)).toBe(false);
  });
});

describe('Phase 1: #2120 — Close reason capture', () => {
  beforeEach(() => {
    mockInstances = [];
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocketClass as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('captures close reason on fatal close (4401)', () => {
    const onStatusChange = vi.fn();
    const { result } = renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'test-1',
        onData: vi.fn(),
        onStatusChange,
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));
    act(() => simulateClose(latestMockWs(), 4401, 'Authentication failed'));

    expect(result.current.status).toBe('error');
    expect(result.current.closeReason).toBe('Authentication failed');
    expect(onStatusChange).toHaveBeenCalledWith('error', 'Authentication failed');
  });

  it('captures close reason on normal close (1000)', () => {
    const { result } = renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'test-1',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));
    act(() => simulateClose(latestMockWs(), 1000, 'Session ended'));

    expect(result.current.status).toBe('terminated');
    expect(result.current.closeReason).toBe('Session ended');
  });

  it('provides default reason when event.reason is empty on fatal close', () => {
    const { result } = renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'test-1',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));
    act(() => simulateClose(latestMockWs(), 4404, ''));

    expect(result.current.status).toBe('error');
    expect(result.current.closeReason).toBe('Connection failed (code 4404)');
  });

  it('clears closeReason on reconnect', () => {
    const { result } = renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'test-1',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));
    act(() => simulateClose(latestMockWs(), 4401, 'Auth failed'));
    expect(result.current.closeReason).toBe('Auth failed');

    act(() => result.current.reconnect());
    expect(result.current.closeReason).toBeNull();
  });
});

describe('Phase 1: #2112 — Fatal errors do not trigger auto-reconnect', () => {
  beforeEach(() => {
    mockInstances = [];
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocketClass as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fatal close (4400) does not auto-reconnect', () => {
    renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'test-1',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));
    act(() => simulateClose(latestMockWs(), 4400, 'Bad request'));

    // Advance past all reconnection delays — should NOT create new WS
    act(() => vi.advanceTimersByTime(60000));
    expect(mockInstances).toHaveLength(1);
  });

  it('non-fatal close (4500+) DOES auto-reconnect', () => {
    renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'test-1',
        onData: vi.fn(),
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));
    act(() => simulateClose(latestMockWs(), 4502, 'Worker unavailable'));

    // Advance past reconnection delay
    act(() => vi.advanceTimersByTime(1100));
    expect(mockInstances).toHaveLength(2);
  });
});

describe('Phase 1: #2100 — Host key event parsing', () => {
  beforeEach(() => {
    mockInstances = [];
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).WebSocket = MockWebSocketClass as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('passes structured host_key info via onEvent', () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useTerminalWebSocket({
        sessionId: 'test-1',
        onData: vi.fn(),
        onEvent,
        enabled: true,
      }),
    );

    act(() => simulateOpen(latestMockWs()));

    // Simulate a host key event from the server
    const eventMsg = JSON.stringify({
      type: 'event',
      event: {
        type: 'status_change',
        message: 'pending_host_verification',
        session_id: 'test-1',
        host_key: {
          host: '192.168.1.10',
          port: 22,
          key_type: 'ssh-ed25519',
          fingerprint: 'SHA256:abcdef1234',
          public_key: 'AAAA...',
        },
      },
    });

    act(() => {
      latestMockWs().onmessage?.({ data: eventMsg } as unknown as MessageEvent);
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status_change',
        host_key: expect.objectContaining({
          host: '192.168.1.10',
          key_type: 'ssh-ed25519',
          fingerprint: 'SHA256:abcdef1234',
        }),
      }),
    );
  });
});
