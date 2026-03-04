// @vitest-environment jsdom
/**
 * Tests for terminal emulator WebSocket wiring (Issues #2088, #2089).
 *
 * Verifies that:
 * - onEvent is forwarded from the hook to the parent component (#2088)
 * - Initial terminal dimensions are sent after WebSocket connects (#2089)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalWebSocket } from '@/ui/hooks/use-terminal-websocket';

// Mock dependencies
vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: () => 'https://api.example.com',
}));

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: () => 'test-token',
}));

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType = 'blob';
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  url: string;

  constructor(url: string) {
    this.url = url;
    // Auto-open after microtask
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    });
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  _receive(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as unknown as MessageEvent);
  }
}

let mockWsInstance: MockWebSocket | null = null;

beforeEach(() => {
  mockWsInstance = null;
  vi.stubGlobal(
    'WebSocket',
    class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        mockWsInstance = this;
      }
    },
  );
  (globalThis.WebSocket as unknown as typeof MockWebSocket).OPEN = MockWebSocket.OPEN;
  (globalThis.WebSocket as unknown as typeof MockWebSocket).CONNECTING = MockWebSocket.CONNECTING;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('terminal emulator wiring', () => {
  it('calls onStatusChange with "connected" when WebSocket opens (#2089)', async () => {
    const onData = vi.fn();
    const onStatusChange = vi.fn();
    renderHook(() => useTerminalWebSocket({ sessionId: 'test-id', onData, onStatusChange }));

    await vi.waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('connected', undefined));
    expect(onStatusChange).toHaveBeenCalledWith('connecting', undefined);
  });

  it('sends resize message when WebSocket opens (#2089)', async () => {
    const onData = vi.fn();
    renderHook(() => useTerminalWebSocket({ sessionId: 'test-id', onData }));
    await vi.waitFor(() => expect(mockWsInstance?.readyState).toBe(MockWebSocket.OPEN));

    // The hook's resize function sends JSON when socket is open
    const { result } = renderHook(() =>
      useTerminalWebSocket({ sessionId: 'test-id-2', onData }),
    );

    await vi.waitFor(() => expect(result.current.status).toBe('connected'));

    // Call resize while connected — should send
    act(() => {
      result.current.resize(120, 40);
    });

    // Find the send call with resize data
    const wsCalls = mockWsInstance!.send.mock.calls;
    const resizeCall = wsCalls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('"type":"resize"'),
    );
    expect(resizeCall).toBeDefined();
    const parsed = JSON.parse(resizeCall![0] as string);
    expect(parsed).toEqual({ type: 'resize', cols: 120, rows: 40 });
  });

  it('forwards onEvent callback to hook (#2088)', async () => {
    const onData = vi.fn();
    const onEvent = vi.fn();
    renderHook(() => useTerminalWebSocket({ sessionId: 'test-id', onData, onEvent }));
    await vi.waitFor(() => expect(mockWsInstance?.readyState).toBe(MockWebSocket.OPEN));

    const eventMsg = JSON.stringify({
      type: 'event',
      event: { type: 'status_change', message: 'attached', session_id: 'test-id', host_key: null },
    });

    act(() => {
      mockWsInstance!._receive(eventMsg);
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'status_change',
      message: 'attached',
      session_id: 'test-id',
      host_key: null,
    });
    expect(onData).not.toHaveBeenCalled();
  });

  it('does not call onEvent when callback is not provided (#2088)', async () => {
    const onData = vi.fn();
    // No onEvent provided
    renderHook(() => useTerminalWebSocket({ sessionId: 'test-id', onData }));
    await vi.waitFor(() => expect(mockWsInstance?.readyState).toBe(MockWebSocket.OPEN));

    const eventMsg = JSON.stringify({
      type: 'event',
      event: { type: 'status_change', message: 'attached' },
    });

    // Should not throw
    act(() => {
      mockWsInstance!._receive(eventMsg);
    });

    // Event should not be passed to onData
    expect(onData).not.toHaveBeenCalled();
  });
});
