/**
 * @vitest-environment jsdom
 * Tests for RealtimeProvider JWT authentication integration.
 * Issue #1334: WebSocket auth via JWT query parameter.
 *
 * Tests that the RealtimeProvider:
 * - Appends access token as query parameter when getAccessToken returns a token
 * - Reconnects when token changes (via onTokenChange callback)
 * - Works without token (when auth is not needed)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

import { RealtimeProvider, useRealtime } from '@/ui/components/realtime/realtime-context';

// Mock WebSocket with static constants matching the real WebSocket API
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = 0; // CONNECTING
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn();

  simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = 3; // CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason }));
    }
  }

  static clear() {
    MockWebSocket.instances = [];
  }
}

// Helper component to access context
function StatusDisplay() {
  const { status } = useRealtime();
  return <span data-testid="status">{status}</span>;
}

describe('RealtimeProvider JWT Auth', () => {
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    MockWebSocket.clear();
    originalWebSocket = globalThis.WebSocket;
    // Replace WebSocket on both globalThis and window (jsdom)
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    if (typeof window !== 'undefined') {
      (window as Record<string, unknown>).WebSocket = MockWebSocket;
    }
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    if (typeof window !== 'undefined') {
      (window as Record<string, unknown>).WebSocket = originalWebSocket;
    }
  });

  it('appends token as query parameter to WebSocket URL', () => {
    render(
      <RealtimeProvider url="ws://localhost/api/ws" getAccessToken={() => 'my-jwt-token'}>
        <StatusDisplay />
      </RealtimeProvider>,
    );

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost/api/ws?token=my-jwt-token');
  });

  it('does not append token param when getAccessToken returns null', () => {
    render(
      <RealtimeProvider url="ws://localhost/api/ws" getAccessToken={() => null}>
        <StatusDisplay />
      </RealtimeProvider>,
    );

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost/api/ws');
  });

  it('does not append token param when getAccessToken is not provided', () => {
    render(
      <RealtimeProvider url="ws://localhost/api/ws">
        <StatusDisplay />
      </RealtimeProvider>,
    );

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost/api/ws');
  });

  it('preserves existing query parameters when appending token', () => {
    render(
      <RealtimeProvider url="ws://localhost/api/ws?debug=1" getAccessToken={() => 'my-token'}>
        <StatusDisplay />
      </RealtimeProvider>,
    );

    expect(MockWebSocket.instances.length).toBe(1);
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost/api/ws?debug=1&token=my-token');
  });

  it('reconnects when onTokenRefreshed is called', async () => {
    let tokenRefreshedCallback: (() => void) | undefined;

    render(
      <RealtimeProvider
        url="ws://localhost/api/ws"
        getAccessToken={() => 'new-token'}
        onTokenRefreshed={(cb) => {
          tokenRefreshedCallback = cb;
          return () => { tokenRefreshedCallback = undefined; };
        }}
      >
        <StatusDisplay />
      </RealtimeProvider>,
    );

    expect(MockWebSocket.instances.length).toBe(1);
    const firstWs = MockWebSocket.instances[0];

    // Simulate the first connection opening
    act(() => {
      firstWs.simulateOpen();
    });

    expect(screen.getByTestId('status')).toHaveTextContent('connected');

    // Trigger token refresh
    act(() => {
      tokenRefreshedCallback?.();
    });

    // Old connection should be closed
    expect(firstWs.close).toHaveBeenCalledWith(4000, 'Token refreshed');

    // A new connection should be created with the new token
    expect(MockWebSocket.instances.length).toBe(2);
    expect(MockWebSocket.instances[1].url).toBe('ws://localhost/api/ws?token=new-token');
  });

  it('cleans up onTokenRefreshed subscription on unmount', () => {
    let cleanupFn: (() => void) | undefined;
    const unsubscribe = vi.fn(() => { cleanupFn = undefined; });

    const { unmount } = render(
      <RealtimeProvider
        url="ws://localhost/api/ws"
        getAccessToken={() => 'token'}
        onTokenRefreshed={(cb) => {
          cleanupFn = () => cb();
          return unsubscribe;
        }}
      >
        <StatusDisplay />
      </RealtimeProvider>,
    );

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
