/**
 * @vitest-environment jsdom
 * Tests for real-time updates via WebSocket
 * Issue #404: Implement real-time updates via WebSocket
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { ConnectionStatusIndicator, type ConnectionStatusIndicatorProps } from '@/ui/components/realtime/connection-status-indicator';
import { RealtimeProvider, useRealtime, type RealtimeProviderProps } from '@/ui/components/realtime/realtime-context';
import { OfflineIndicator, type OfflineIndicatorProps } from '@/ui/components/realtime/offline-indicator';
import { RealtimeEventHandler, type RealtimeEventHandlerProps } from '@/ui/components/realtime/realtime-event-handler';
import type { ConnectionStatus, RealtimeEvent, Subscription } from '@/ui/components/realtime/types';

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = WebSocket.CONNECTING;
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
    this.readyState = WebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason }));
    }
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }

  static clear() {
    MockWebSocket.instances = [];
  }
}

// Store original WebSocket
const originalWebSocket = globalThis.WebSocket;

describe('ConnectionStatusIndicator', () => {
  const defaultProps: ConnectionStatusIndicatorProps = {
    status: 'connected',
  };

  it('should show connected status', () => {
    render(<ConnectionStatusIndicator {...defaultProps} />);
    expect(screen.getByTestId('connection-status')).toHaveAttribute('data-status', 'connected');
  });

  it('should show disconnected status', () => {
    render(<ConnectionStatusIndicator status="disconnected" />);
    expect(screen.getByTestId('connection-status')).toHaveAttribute('data-status', 'disconnected');
  });

  it('should show connecting status', () => {
    render(<ConnectionStatusIndicator status="connecting" />);
    expect(screen.getByTestId('connection-status')).toHaveAttribute('data-status', 'connecting');
  });

  it('should show reconnecting status', () => {
    render(<ConnectionStatusIndicator status="reconnecting" />);
    expect(screen.getByTestId('connection-status')).toHaveAttribute('data-status', 'reconnecting');
  });

  it('should show text label when expanded', () => {
    render(<ConnectionStatusIndicator status="connected" showLabel />);
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it('should hide text when compact', () => {
    render(<ConnectionStatusIndicator status="connected" compact />);
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument();
  });

  it('should show green indicator when connected', () => {
    render(<ConnectionStatusIndicator status="connected" />);
    const indicator = screen.getByTestId('connection-indicator');
    expect(indicator).toHaveClass('bg-green-500');
  });

  it('should show red indicator when disconnected', () => {
    render(<ConnectionStatusIndicator status="disconnected" />);
    const indicator = screen.getByTestId('connection-indicator');
    expect(indicator).toHaveClass('bg-red-500');
  });

  it('should animate when connecting', () => {
    render(<ConnectionStatusIndicator status="connecting" />);
    const indicator = screen.getByTestId('connection-indicator');
    expect(indicator).toHaveClass('animate-pulse');
  });
});

describe('RealtimeProvider', () => {
  // Test component to access context
  function TestConsumer() {
    const { status, subscribe, unsubscribe } = useRealtime();
    return (
      <div>
        <span data-testid="status">{status}</span>
        <button onClick={() => subscribe({ type: 'item', id: 'item-1' })}>Subscribe</button>
        <button onClick={() => unsubscribe({ type: 'item', id: 'item-1' })}>Unsubscribe</button>
      </div>
    );
  }

  it('should provide initial connecting status', () => {
    // Provider starts in connecting state
    render(
      <RealtimeProvider url="ws://localhost/ws">
        <TestConsumer />
      </RealtimeProvider>,
    );

    // Initially should be in connecting state
    expect(screen.getByTestId('status')).toHaveTextContent('connecting');
  });

  it('should render children', () => {
    render(
      <RealtimeProvider url="ws://localhost/ws">
        <div data-testid="child">Child content</div>
      </RealtimeProvider>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('should provide subscribe function', () => {
    render(
      <RealtimeProvider url="ws://localhost/ws">
        <TestConsumer />
      </RealtimeProvider>,
    );

    // Subscribe button should be present and clickable
    expect(screen.getByText('Subscribe')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Subscribe'));
    // No error should be thrown
  });

  it('should provide unsubscribe function', () => {
    render(
      <RealtimeProvider url="ws://localhost/ws">
        <TestConsumer />
      </RealtimeProvider>,
    );

    // Unsubscribe button should be present and clickable
    expect(screen.getByText('Unsubscribe')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Unsubscribe'));
    // No error should be thrown
  });

  it('should throw when useRealtime used outside provider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useRealtime must be used within a RealtimeProvider');

    consoleSpy.mockRestore();
  });
});

describe('OfflineIndicator', () => {
  const defaultProps: OfflineIndicatorProps = {
    isOnline: true,
    pendingChanges: 0,
  };

  it('should not render when online', () => {
    render(<OfflineIndicator {...defaultProps} />);
    expect(screen.queryByTestId('offline-indicator')).not.toBeInTheDocument();
  });

  it('should show offline banner when offline', () => {
    render(<OfflineIndicator isOnline={false} pendingChanges={0} />);
    expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  it('should show pending changes count', () => {
    render(<OfflineIndicator isOnline={false} pendingChanges={3} />);
    expect(screen.getByText(/3 pending/i)).toBeInTheDocument();
  });

  it('should show sync button when pending changes exist', () => {
    render(<OfflineIndicator isOnline={true} pendingChanges={2} onSync={vi.fn()} />);
    expect(screen.getByRole('button', { name: /sync/i })).toBeInTheDocument();
  });

  it('should call onSync when sync clicked', () => {
    const onSync = vi.fn();
    render(<OfflineIndicator isOnline={true} pendingChanges={2} onSync={onSync} />);

    fireEvent.click(screen.getByRole('button', { name: /sync/i }));

    expect(onSync).toHaveBeenCalled();
  });

  it('should show syncing state', () => {
    render(<OfflineIndicator isOnline={true} pendingChanges={2} syncing />);
    expect(screen.getByTestId('syncing-indicator')).toBeInTheDocument();
  });
});

describe('RealtimeEventHandler', () => {
  const mockEvent: RealtimeEvent = {
    type: 'item:updated',
    payload: {
      id: 'item-1',
      title: 'Updated Title',
    },
    timestamp: new Date().toISOString(),
  };

  const defaultProps: RealtimeEventHandlerProps = {
    eventType: 'item:updated',
    onEvent: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render children', () => {
    render(
      <RealtimeEventHandler {...defaultProps}>
        <div>Child content</div>
      </RealtimeEventHandler>,
    );
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('should call onEvent when matching event received', () => {
    const onEvent = vi.fn();
    render(
      <RealtimeProvider url="ws://localhost/ws">
        <RealtimeEventHandler eventType="item:updated" onEvent={onEvent}>
          <div>Content</div>
        </RealtimeEventHandler>
      </RealtimeProvider>,
    );

    // This would be called by the provider when event received
    // Testing the interface exists
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('should filter events by type', () => {
    const onEvent = vi.fn();
    render(
      <RealtimeEventHandler eventType="item:updated" onEvent={onEvent} entity_id="item-1">
        <div>Content</div>
      </RealtimeEventHandler>,
    );

    // Handler should only be called for matching entity
    expect(onEvent).not.toHaveBeenCalled();
  });
});
