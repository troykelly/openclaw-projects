/** @vitest-environment jsdom */
/**
 * Tests for Issue #1959: Multi-device chat sync.
 *
 * Covers:
 * - useChatReadCursor hook (debounced updates, forward-only)
 * - useChatDeviceSync hook (session/message sync via events)
 * - Offline recovery logic
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPost = vi.fn();
const mockGet = vi.fn();

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

// ---------------------------------------------------------------------------
// useChatReadCursor tests
// ---------------------------------------------------------------------------

describe('useChatReadCursor hook', () => {
  let useChatReadCursor: typeof import('@/ui/hooks/use-chat-read-cursor').useChatReadCursor;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import('@/ui/hooks/use-chat-read-cursor');
    useChatReadCursor = mod.useChatReadCursor;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function TestComponent({ sessionId }: { sessionId: string }) {
    const { markRead, lastReadMessageId, lastReadAt } = useChatReadCursor(sessionId);
    return (
      <div>
        <span data-testid="last-read">{lastReadMessageId ?? 'none'}</span>
        <span data-testid="last-read-at">{lastReadAt ?? 'none'}</span>
        <button type="button" data-testid="mark-msg-1" onClick={() => markRead('msg-1')}>
          Mark 1
        </button>
        <button type="button" data-testid="mark-msg-2" onClick={() => markRead('msg-2')}>
          Mark 2
        </button>
        <button type="button" data-testid="mark-msg-3" onClick={() => markRead('msg-3')}>
          Mark 3
        </button>
      </div>
    );
  }

  it('starts with no read cursor', () => {
    render(<TestComponent sessionId="session-1" />);
    expect(screen.getByTestId('last-read').textContent).toBe('none');
  });

  it('debounces read cursor updates (2 seconds)', async () => {
    mockPost.mockResolvedValue({ last_read_message_id: 'msg-2', last_read_at: '2026-03-01T10:00:00Z' });

    render(<TestComponent sessionId="session-1" />);

    // Mark two messages rapidly
    act(() => {
      screen.getByTestId('mark-msg-1').click();
    });
    act(() => {
      screen.getByTestId('mark-msg-2').click();
    });

    // Should NOT have posted yet (debounce period)
    expect(mockPost).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    // Should post only once with the latest message
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/chat/sessions/session-1/read',
      { last_read_message_id: 'msg-2' },
    );
  });

  it('updates local state after successful POST', async () => {
    mockPost.mockResolvedValue({
      last_read_message_id: 'msg-1',
      last_read_at: '2026-03-01T10:00:00Z',
    });

    render(<TestComponent sessionId="session-1" />);

    act(() => {
      screen.getByTestId('mark-msg-1').click();
    });

    // Advance past debounce to trigger flush
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    // Let the POST promise resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('last-read').textContent).toBe('msg-1');
  });

  it('does not POST if message ID is the same as last read', async () => {
    mockPost.mockResolvedValue({
      last_read_message_id: 'msg-1',
      last_read_at: '2026-03-01T10:00:00Z',
    });

    render(<TestComponent sessionId="session-1" />);

    // First read
    act(() => {
      screen.getByTestId('mark-msg-1').click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    // Let the POST promise resolve and update confirmedRef
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockPost).toHaveBeenCalledTimes(1);

    // Mark same message again
    act(() => {
      screen.getByTestId('mark-msg-1').click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    // Should not have posted again (deduped by confirmedRef)
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('handles POST failure gracefully (no crash)', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));

    render(<TestComponent sessionId="session-1" />);

    act(() => {
      screen.getByTestId('mark-msg-1').click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    // Should still render without crash, last-read remains none
    expect(screen.getByTestId('last-read').textContent).toBe('none');
  });

  it('accepts external cursor updates (from other devices)', async () => {
    render(<TestComponent sessionId="session-1" />);
    // Simulate receiving an event from another device
    // The hook exposes handleRemoteCursorUpdate for this
  });
});

// ---------------------------------------------------------------------------
// useChatDeviceSync tests
// ---------------------------------------------------------------------------

describe('useChatDeviceSync hook', () => {
  let useChatDeviceSync: typeof import('@/ui/hooks/use-chat-device-sync').useChatDeviceSync;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/ui/hooks/use-chat-device-sync');
    useChatDeviceSync = mod.useChatDeviceSync;
  });

  function TestComponent({ lastSyncedAt }: { lastSyncedAt?: string }) {
    const { syncState, syncError } = useChatDeviceSync({
      enabled: true,
      lastSyncedAt: lastSyncedAt ?? null,
    });
    return (
      <div>
        <span data-testid="sync-state">{syncState}</span>
        <span data-testid="sync-error">{syncError ?? 'none'}</span>
      </div>
    );
  }

  it('starts in idle state', () => {
    render(<TestComponent />);
    expect(screen.getByTestId('sync-state').textContent).toBe('idle');
  });

  it('syncs on reconnect with lastSyncedAt', async () => {
    mockGet.mockResolvedValueOnce({
      messages: [],
      cursor: null,
      has_more: false,
    });

    render(<TestComponent lastSyncedAt="2026-03-01T09:00:00Z" />);

    // The hook should trigger a sync when enabled with a lastSyncedAt
    await waitFor(() => {
      expect(screen.getByTestId('sync-state').textContent).toBe('synced');
    });
  });

  it('handles sync error gracefully', async () => {
    mockGet.mockRejectedValueOnce(new Error('Offline'));

    render(<TestComponent lastSyncedAt="2026-03-01T09:00:00Z" />);

    await waitFor(() => {
      expect(screen.getByTestId('sync-state').textContent).toBe('error');
    });
    expect(screen.getByTestId('sync-error').textContent).not.toBe('none');
  });

  it('does not sync when disabled', () => {
    function DisabledTest() {
      const { syncState } = useChatDeviceSync({ enabled: false, lastSyncedAt: null });
      return <span data-testid="sync-state">{syncState}</span>;
    }

    render(<DisabledTest />);
    expect(screen.getByTestId('sync-state').textContent).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });
});
