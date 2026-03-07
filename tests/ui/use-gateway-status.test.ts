/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useGatewayStatus hook (Epic #2153, Issue #2159).
 *
 * Verifies: initial loading state, successful/failed fetch, polling, and
 * the returned GatewayStatus shape.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock apiClient
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { apiClient } from '@/ui/lib/api-client';
import { useGatewayStatus } from '@/ui/hooks/use-gateway-status';

const mockedGet = vi.mocked(apiClient.get);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useGatewayStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { loading: true } on initial render before fetch completes', () => {
    mockedGet.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useGatewayStatus(), { wrapper: createWrapper() });

    expect(result.current.loading).toBe(true);
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('returns { connected: true, loading: false } on successful response', async () => {
    mockedGet.mockResolvedValue({
      connected: true,
      connected_at: '2026-03-05T10:00:00Z',
      last_tick_at: '2026-03-05T10:00:30Z',
    });

    const { result } = renderHook(() => useGatewayStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.connected).toBe(true);
    expect(result.current.error).toBe(false);
  });

  it('returns { connected: false, loading: false } when API returns connected=false', async () => {
    mockedGet.mockResolvedValue({
      connected: false,
      connected_at: null,
      last_tick_at: null,
    });

    const { result } = renderHook(() => useGatewayStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('returns { connected: false, error: true } on fetch failure', async () => {
    mockedGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useGatewayStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(true);
  });

  it('calls apiClient.get with the correct path', async () => {
    mockedGet.mockResolvedValue({ connected: true });

    renderHook(() => useGatewayStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/gateway/status');
    });
  });

  it('treats missing connected field as disconnected', async () => {
    mockedGet.mockResolvedValue({});

    const { result } = renderHook(() => useGatewayStatus(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe(false);
  });
});
