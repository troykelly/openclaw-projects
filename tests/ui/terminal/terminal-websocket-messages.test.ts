// @vitest-environment jsdom
/**
 * Tests for terminal WebSocket message handling (Issue #2087).
 *
 * Verifies that:
 * - Binary frames (ArrayBuffer) are decoded as UTF-8 and passed to onData
 * - JSON event frames are parsed and passed to onEvent, not onData
 * - Non-JSON text frames are passed to onData
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalWebSocket } from '@/ui/hooks/use-terminal-websocket';

/**
 * Helper: create an ArrayBuffer from a string in the current realm.
 * Node's native TextEncoder produces ArrayBuffers from Node's global,
 * which fail `instanceof ArrayBuffer` in jsdom's global. This helper
 * creates the buffer directly in the test realm so `instanceof` works.
 */
function stringToArrayBuffer(str: string): ArrayBuffer {
  const buf = new ArrayBuffer(str.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < str.length; i++) view[i] = str.charCodeAt(i);
  return buf;
}

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

  // Test helper: simulate receiving a message.
  // Uses a plain object cast instead of `new MessageEvent(...)` to avoid
  // cross-realm issues where jsdom's MessageEvent may not preserve the
  // ArrayBuffer prototype from Node's global, causing `instanceof` to fail.
  _receive(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as unknown as MessageEvent);
  }
}

let mockWsInstance: MockWebSocket | null = null;

beforeEach(() => {
  mockWsInstance = null;
  vi.stubGlobal('WebSocket', class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      mockWsInstance = this;
    }
  });
  // Copy static values to the global mock
  (globalThis.WebSocket as unknown as typeof MockWebSocket).OPEN = MockWebSocket.OPEN;
  (globalThis.WebSocket as unknown as typeof MockWebSocket).CONNECTING = MockWebSocket.CONNECTING;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('terminal WebSocket message handling', () => {
  it('sets binaryType to arraybuffer', async () => {
    const onData = vi.fn();
    renderHook(() => useTerminalWebSocket({ sessionId: 'test-id', onData }));
    await vi.waitFor(() => expect(mockWsInstance).not.toBeNull());
    expect(mockWsInstance!.binaryType).toBe('arraybuffer');
  });

  it('decodes binary ArrayBuffer as UTF-8 terminal data', async () => {
    const onData = vi.fn();
    renderHook(() => useTerminalWebSocket({ sessionId: 'test-id', onData }));
    await vi.waitFor(() => expect(mockWsInstance?.readyState).toBe(MockWebSocket.OPEN));

    const buffer = stringToArrayBuffer('$ hello world\r\n');

    act(() => {
      mockWsInstance!._receive(buffer);
    });

    expect(onData).toHaveBeenCalledWith('$ hello world\r\n');
  });

  it('passes JSON event messages to onEvent, not onData', async () => {
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

  it('passes non-JSON text strings to onData', async () => {
    const onData = vi.fn();
    const onEvent = vi.fn();
    renderHook(() => useTerminalWebSocket({ sessionId: 'test-id', onData, onEvent }));
    await vi.waitFor(() => expect(mockWsInstance?.readyState).toBe(MockWebSocket.OPEN));

    act(() => {
      mockWsInstance!._receive('plain text from server');
    });

    expect(onData).toHaveBeenCalledWith('plain text from server');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('passes non-event JSON strings to onData', async () => {
    const onData = vi.fn();
    const onEvent = vi.fn();
    renderHook(() => useTerminalWebSocket({ sessionId: 'test-id', onData, onEvent }));
    await vi.waitFor(() => expect(mockWsInstance?.readyState).toBe(MockWebSocket.OPEN));

    act(() => {
      mockWsInstance!._receive('{"some":"other","json":"data"}');
    });

    expect(onData).toHaveBeenCalledWith('{"some":"other","json":"data"}');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('handles binary data with ANSI escape sequences', async () => {
    const onData = vi.fn();
    renderHook(() => useTerminalWebSocket({ sessionId: 'test-id', onData }));
    await vi.waitFor(() => expect(mockWsInstance?.readyState).toBe(MockWebSocket.OPEN));

    const ansiText = '\x1b[32mgreen text\x1b[0m\r\n';
    const buffer = stringToArrayBuffer(ansiText);

    act(() => {
      mockWsInstance!._receive(buffer);
    });

    expect(onData).toHaveBeenCalledWith(ansiText);
  });
});
