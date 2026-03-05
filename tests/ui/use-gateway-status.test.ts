/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useGatewayStatus hook (Epic #2153, Issue #2159).
 *
 * Verifies: initial loading state, successful/failed fetch, polling, unmount cleanup,
 * and re-poll on window focus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Mock the api-config module to provide a base URL
vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:3000/api'),
}));

import { useGatewayStatus } from '@/ui/hooks/use-gateway-status';

describe('useGatewayStatus', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns { loading: true } on initial render before fetch completes', () => {
    fetchSpy.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useGatewayStatus());

    expect(result.current.loading).toBe(true);
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('returns { connected: true, loading: false } on successful response', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ connected: true, connected_at: '2026-03-05T10:00:00Z', last_tick_at: '2026-03-05T10:00:30Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useGatewayStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.error).toBe(false);
  });

  it('returns { connected: false, loading: false } when API returns connected=false', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ connected: false, connected_at: null, last_tick_at: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useGatewayStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('returns { connected: false, error: true } on fetch failure', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useGatewayStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(true);
  });

  it('polls again after 30 seconds', async () => {
    vi.useFakeTimers();

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ connected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderHook(() => useGatewayStatus());

    // Flush initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance by 30 seconds
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('stops polling when component unmounts', async () => {
    vi.useFakeTimers();

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ connected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { unmount } = renderHook(() => useGatewayStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    unmount();

    // Advance by 30 seconds — should NOT trigger another fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('re-polls on window focus (visibilitychange)', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ connected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderHook(() => useGatewayStatus());

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // Simulate tab becoming visible
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('returns { connected: false, error: true } on non-ok HTTP response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    const { result } = renderHook(() => useGatewayStatus());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(true);
  });
});
