/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useChatWebSocket hook (Epic #1940, Issue #1951).
 *
 * Validates WebSocket lifecycle: ticket acquisition, connection,
 * message handling, reconnection with exponential backoff, and cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/ui/lib/api-client.ts', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

vi.mock('@/ui/lib/api-config.ts', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:3000'),
  getWsBaseUrl: vi.fn(() => 'ws://localhost:3000'),
}));

vi.mock('@/ui/lib/auth-manager.ts', () => ({
  getAccessToken: vi.fn(() => 'test-jwt-token'),
}));

import { apiClient } from '@/ui/lib/api-client.ts';
import { useChatWebSocket, type ChatWsStatus, type ChatWsEvent } from '@/ui/hooks/use-chat-websocket.ts';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

interface MockWsInstance {
  url: string;
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

let mockWsInstances: MockWsInstance[] = [];

class MockWebSocket {
  url: string;
  readyState = 0; // CONNECTING
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    mockWsInstances.push(this as unknown as MockWsInstance);
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockWsInstances = [];
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Replace global WebSocket
  vi.stubGlobal('WebSocket', MockWebSocket);

  // Default: ticket endpoint returns a ticket
  vi.mocked(apiClient.post).mockResolvedValue({ ticket: 'test-ticket-123', expires_in: 30 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: simulate WS open
// ---------------------------------------------------------------------------

function simulateOpen(ws: MockWsInstance): void {
  ws.readyState = 1;
  ws.onopen?.(new Event('open'));
}

function simulateMessage(ws: MockWsInstance, data: Record<string, unknown>): void {
  ws.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
}

function simulateClose(ws: MockWsInstance, code = 1006, reason = ''): void {
  ws.readyState = 3;
  ws.onclose?.(new CloseEvent('close', { code, reason }));
}

function simulateError(ws: MockWsInstance): void {
  ws.onerror?.(new Event('error'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChatWebSocket', () => {
  const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('should start in disconnected status', () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent, enabled: false }),
    );
    expect(result.current.status).toBe('disconnected');
  });

  it('should obtain ticket and connect when enabled', async () => {
    const onEvent = vi.fn();

    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent }),
    );

    // Let the ticket request resolve
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(apiClient.post).toHaveBeenCalledWith('/api/chat/ws/ticket', {
      session_id: sessionId,
    });

    // A WebSocket should have been created
    expect(mockWsInstances).toHaveLength(1);
    expect(mockWsInstances[0].url).toContain('ws://localhost:3000/api/chat/ws');
    expect(mockWsInstances[0].url).toContain('ticket=test-ticket-123');
    expect(mockWsInstances[0].url).toContain(`session_id=${sessionId}`);

    expect(result.current.status).toBe('connecting');
  });

  it('should update status to connected on WS open + connection:established', async () => {
    const onEvent = vi.fn();

    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = mockWsInstances[0];

    act(() => {
      simulateOpen(ws);
      simulateMessage(ws, {
        type: 'connection:established',
        connection_id: 'conn-1',
        session_id: sessionId,
      });
    });

    expect(result.current.status).toBe('connected');
  });

  it('should dispatch stream events to onEvent callback', async () => {
    const onEvent = vi.fn();

    renderHook(() => useChatWebSocket({ sessionId, onEvent }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = mockWsInstances[0];

    act(() => {
      simulateOpen(ws);
      simulateMessage(ws, {
        type: 'connection:established',
        connection_id: 'conn-1',
        session_id: sessionId,
      });
    });

    // Receive a stream:chunk
    act(() => {
      simulateMessage(ws, {
        type: 'stream:chunk',
        session_id: sessionId,
        message_id: 'msg-1',
        chunk: 'Hello ',
        seq: 0,
      });
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stream:chunk',
        session_id: sessionId,
        message_id: 'msg-1',
        chunk: 'Hello ',
        seq: 0,
      }),
    );

    // Receive stream:completed
    act(() => {
      simulateMessage(ws, {
        type: 'stream:completed',
        session_id: sessionId,
        message_id: 'msg-1',
        full_content: 'Hello World!',
      });
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stream:completed',
        message_id: 'msg-1',
        full_content: 'Hello World!',
      }),
    );
  });

  it('should dispatch stream:failed events', async () => {
    const onEvent = vi.fn();

    renderHook(() => useChatWebSocket({ sessionId, onEvent }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = mockWsInstances[0];
    act(() => {
      simulateOpen(ws);
      simulateMessage(ws, { type: 'connection:established', connection_id: 'c1', session_id: sessionId });
    });

    act(() => {
      simulateMessage(ws, {
        type: 'stream:failed',
        session_id: sessionId,
        message_id: 'msg-2',
        error: 'Agent timeout',
      });
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stream:failed',
        error: 'Agent timeout',
      }),
    );
  });

  it('should send typing indicator via sendTyping', async () => {
    const onEvent = vi.fn();

    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = mockWsInstances[0];
    act(() => {
      simulateOpen(ws);
      simulateMessage(ws, { type: 'connection:established', connection_id: 'c1', session_id: sessionId });
    });

    act(() => {
      result.current.sendTyping(true);
    });

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'typing', is_typing: true }),
    );
  });

  it('should send read cursor via sendReadCursor', async () => {
    const onEvent = vi.fn();

    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = mockWsInstances[0];
    act(() => {
      simulateOpen(ws);
      simulateMessage(ws, { type: 'connection:established', connection_id: 'c1', session_id: sessionId });
    });

    act(() => {
      result.current.sendReadCursor('msg-abc');
    });

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'read_cursor', last_read_message_id: 'msg-abc' }),
    );
  });

  it('should reconnect with exponential backoff on abnormal close', async () => {
    const onEvent = vi.fn();

    renderHook(() => useChatWebSocket({ sessionId, onEvent }));

    // Let the initial ticket request resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const ws1 = mockWsInstances[0];
    act(() => {
      simulateOpen(ws1);
      simulateMessage(ws1, { type: 'connection:established', connection_id: 'c1', session_id: sessionId });
    });

    // Simulate abnormal close (code 1006)
    act(() => {
      simulateClose(ws1, 1006);
    });

    // No new WS yet
    expect(mockWsInstances).toHaveLength(1);

    // Advance 1000ms (initial reconnect delay) — ticket should be re-fetched
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });

  it('should not reconnect on normal close (code 1000)', async () => {
    const onEvent = vi.fn();

    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const ws1 = mockWsInstances[0];
    act(() => {
      simulateOpen(ws1);
      simulateMessage(ws1, { type: 'connection:established', connection_id: 'c1', session_id: sessionId });
    });

    act(() => {
      simulateClose(ws1, 1000, 'Normal closure');
    });

    expect(result.current.status).toBe('terminated');

    // No reconnect timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // No new ticket request
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('should not reconnect on fatal close codes (4400-4499)', async () => {
    const onEvent = vi.fn();

    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      simulateOpen(ws);
      simulateMessage(ws, { type: 'connection:established', connection_id: 'c1', session_id: sessionId });
    });

    // Simulate auth failure close (4401)
    act(() => {
      simulateClose(ws, 4401, 'Invalid or expired ticket');
    });

    expect(result.current.status).toBe('error');

    // Should NOT schedule reconnect
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // No new ticket request
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('should handle manual disconnect', async () => {
    const onEvent = vi.fn();

    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = mockWsInstances[0];
    act(() => {
      simulateOpen(ws);
      simulateMessage(ws, { type: 'connection:established', connection_id: 'c1', session_id: sessionId });
    });

    act(() => {
      result.current.disconnect();
    });

    expect(ws.close).toHaveBeenCalled();
    expect(result.current.status).toBe('disconnected');
  });

  it('should handle ticket acquisition failure', async () => {
    const onEvent = vi.fn();
    const onStatusChange = vi.fn();

    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent, onStatusChange }),
    );

    // Let the rejected promise settle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Should transition to error state
    expect(result.current.status).toBe('error');
  });

  it('should clean up on unmount', async () => {
    const onEvent = vi.fn();

    const { unmount } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const ws = mockWsInstances[0];
    act(() => {
      simulateOpen(ws);
    });

    unmount();

    expect(ws.close).toHaveBeenCalled();
  });

  it('should not connect when enabled is false', async () => {
    const onEvent = vi.fn();

    renderHook(() =>
      useChatWebSocket({ sessionId, onEvent, enabled: false }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(mockWsInstances).toHaveLength(0);
  });

  it('should respond to server pings with pong', async () => {
    const onEvent = vi.fn();

    renderHook(() => useChatWebSocket({ sessionId, onEvent }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      simulateOpen(ws);
      simulateMessage(ws, { type: 'connection:established', connection_id: 'c1', session_id: sessionId });
    });

    act(() => {
      simulateMessage(ws, { type: 'ping' });
    });

    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
  });

  it('should handle reconnect method', async () => {
    const onEvent = vi.fn();

    const { result } = renderHook(() =>
      useChatWebSocket({ sessionId, onEvent }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const ws = mockWsInstances[0];
    act(() => {
      simulateOpen(ws);
      simulateMessage(ws, { type: 'connection:established', connection_id: 'c1', session_id: sessionId });
    });

    // Trigger manual reconnect
    await act(async () => {
      result.current.reconnect();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(ws.close).toHaveBeenCalled();
    // Should request a new ticket
    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });
});
