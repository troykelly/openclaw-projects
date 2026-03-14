/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useSymphonyWebSocket hook reconnect logic (Issue #2564).
 *
 * Validates: no reconnect on close code 4001, no connection when token is null,
 * connectRef pattern prevents stale closure, auth_timeout message handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockGetAccessToken = vi.fn<[], string | null>(() => 'test-jwt-token');

vi.mock('@/ui/lib/api-config.ts', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('@/ui/lib/auth-manager.ts', () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

const stableQueryClient = { invalidateQueries: vi.fn() };
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => stableQueryClient,
}));

vi.mock('@/ui/hooks/queries/use-symphony.ts', () => ({
  symphonyKeys: {
    status: () => ['symphony', 'status'],
    queue: () => ['symphony', 'queue'],
  },
}));

import { useSymphonyWebSocket } from '@/ui/hooks/use-symphony-websocket.ts';

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

class MockWebSocket implements MockWsInstance {
  url: string;
  readyState = 0; // CONNECTING
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    // Mark as closed so `connect` guard doesn't skip
    this.readyState = MockWebSocket.CLOSED;
  });

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    mockWsInstances.push(this);
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockWsInstances = [];
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockGetAccessToken.mockReturnValue('test-jwt-token');
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function getLatestWs(): MockWsInstance {
  return mockWsInstances[mockWsInstances.length - 1];
}

/** Simulate WS open + auth success in one act batch. */
function openAndAuth(ws: MockWsInstance) {
  ws.readyState = MockWebSocket.OPEN;
  ws.onopen?.(new Event('open'));
  ws.onmessage?.(new MessageEvent('message', {
    data: JSON.stringify({ type: 'auth_success' }),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSymphonyWebSocket', () => {
  describe('close code 4001 — no reconnect', () => {
    it('does not reconnect when server closes with code 4001', () => {
      const { result } = renderHook(() => useSymphonyWebSocket({ enabled: true }));

      // React may double-mount in strict mode; use latest WS
      const ws = getLatestWs();
      const countAfterMount = mockWsInstances.length;

      act(() => openAndAuth(ws));
      expect(result.current.status).toBe('connected');

      // Server closes with 4001 (auth failure)
      act(() => {
        ws.readyState = MockWebSocket.CLOSED;
        ws.onclose?.(new CloseEvent('close', { code: 4001, reason: 'Authentication timeout' }));
      });

      expect(result.current.status).toBe('error');

      // Advance time well past any reconnect delay — should NOT create new WS
      act(() => { vi.advanceTimersByTime(60_000); });

      // No new WebSocket should have been created after the 4001 close
      expect(mockWsInstances.length).toBe(countAfterMount);
    });

    it('reconnects on normal close codes (e.g. 1006)', () => {
      const { result } = renderHook(() => useSymphonyWebSocket({ enabled: true }));

      const ws = getLatestWs();
      const countAfterMount = mockWsInstances.length;

      act(() => openAndAuth(ws));
      expect(result.current.status).toBe('connected');

      // Server closes with 1006 (abnormal closure — should trigger reconnect)
      act(() => {
        ws.readyState = MockWebSocket.CLOSED;
        ws.onclose?.(new CloseEvent('close', { code: 1006 }));
      });

      expect(result.current.status).toBe('disconnected');

      // Advance past initial reconnect delay (1s)
      act(() => { vi.advanceTimersByTime(1500); });

      // A new WebSocket should have been created
      expect(mockWsInstances.length).toBe(countAfterMount + 1);
    });
  });

  describe('no token — no connection attempt', () => {
    it('sets error status when getAccessToken() returns null', () => {
      mockGetAccessToken.mockReturnValue(null);

      const { result } = renderHook(() => useSymphonyWebSocket({ enabled: true }));

      // Should not have created any WebSocket
      expect(mockWsInstances.length).toBe(0);
      expect(result.current.status).toBe('error');
    });

    it('connects when token becomes available via reconnect()', () => {
      mockGetAccessToken.mockReturnValue(null);

      const { result } = renderHook(() => useSymphonyWebSocket({ enabled: true }));
      expect(mockWsInstances.length).toBe(0);
      expect(result.current.status).toBe('error');

      // Token becomes available
      mockGetAccessToken.mockReturnValue('fresh-jwt');

      act(() => result.current.reconnect());

      // Should have created exactly one new WebSocket
      expect(mockWsInstances.length).toBe(1);
      expect(result.current.status).toBe('connecting');
    });
  });

  describe('auth_timeout message handling', () => {
    it('sets error and prevents reconnect on auth_timeout message', () => {
      const { result } = renderHook(() => useSymphonyWebSocket({ enabled: true }));

      const ws = getLatestWs();

      // Open connection (don't fully auth yet)
      act(() => {
        ws.readyState = MockWebSocket.OPEN;
        ws.onopen?.(new Event('open'));
      });

      expect(result.current.status).toBe('authenticating');

      // Backend sends auth_timeout before closing
      act(() => {
        ws.onmessage?.(new MessageEvent('message', {
          data: JSON.stringify({ type: 'auth_timeout', error: 'Authentication timeout' }),
        }));
      });

      expect(result.current.status).toBe('error');
      expect(ws.close).toHaveBeenCalled();
    });
  });

  describe('connectRef pattern — stale closure prevention', () => {
    it('uses latest connect via connectRef in reconnect timeout', () => {
      const { result } = renderHook(() => useSymphonyWebSocket({ enabled: true }));

      const ws1 = getLatestWs();
      const countAfterMount = mockWsInstances.length;

      act(() => openAndAuth(ws1));

      // Simulate a normal close — triggers reconnect timeout
      act(() => {
        ws1.readyState = MockWebSocket.CLOSED;
        ws1.onclose?.(new CloseEvent('close', { code: 1006 }));
      });

      // Advance past reconnect delay
      act(() => { vi.advanceTimersByTime(1500); });

      // New WebSocket should be created via connectRef
      expect(mockWsInstances.length).toBe(countAfterMount + 1);
      const ws2 = getLatestWs();
      expect(ws2.url).toContain('/symphony/feed');
    });
  });

  describe('manual disconnect', () => {
    it('does not reconnect after manual disconnect()', () => {
      const { result } = renderHook(() => useSymphonyWebSocket({ enabled: true }));

      const ws = getLatestWs();
      const countAfterMount = mockWsInstances.length;

      act(() => openAndAuth(ws));

      act(() => result.current.disconnect());

      expect(result.current.status).toBe('disconnected');

      // Advance time — should not reconnect
      act(() => { vi.advanceTimersByTime(60_000); });

      expect(mockWsInstances.length).toBe(countAfterMount);
    });
  });
});
