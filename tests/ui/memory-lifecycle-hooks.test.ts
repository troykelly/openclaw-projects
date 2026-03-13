/**
 * @vitest-environment jsdom
 *
 * Tests for memory lifecycle mutation hooks.
 * Issue #2449: Digest results view + reaper activity log + new hooks.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDigestMemories } from '@/ui/hooks/mutations/use-digest-memories';
import { useReapMemories } from '@/ui/hooks/mutations/use-reap-memories';
import { useBulkSupersede } from '@/ui/hooks/mutations/use-bulk-supersede';

const originalFetch = globalThis.fetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { Wrapper, queryClient };
}

function mockFetchSuccess(data: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status,
    statusText: 'OK',
    json: async () => data,
  });
}

function mockFetchError(message: string, status = 400) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Bad Request',
    json: async () => ({ message }),
  });
}

describe('useDigestMemories', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends correct request body', async () => {
    const digestResponse = {
      total_memories: 10,
      clusters: [
        {
          topic: 'Architecture',
          centroid_id: 'mem-1',
          size: 3,
          avg_similarity: 0.85,
          time_span: { start: '2025-01-01', end: '2025-06-01' },
          memory_ids: ['mem-1', 'mem-2', 'mem-3'],
          memories: [],
        },
      ],
      orphans: [],
    };
    mockFetchSuccess(digestResponse);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDigestMemories(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ namespace: 'default', min_cluster_size: 2 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(digestResponse);

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain('/memories/digest');
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.namespace).toBe('default');
    expect(body.min_cluster_size).toBe(2);
  });

  it('handles loading state', async () => {
    mockFetchSuccess({ total_memories: 0, clusters: [], orphans: [] });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDigestMemories(), { wrapper: Wrapper });

    expect(result.current.isPending).toBe(false);

    act(() => {
      result.current.mutate({});
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('handles error state', async () => {
    mockFetchError('Digest failed', 500);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDigestMemories(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useReapMemories', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('handles dry-run response', async () => {
    const reapResponse = {
      reaped_count: 5,
      dry_run: true,
      soft_delete: true,
      reaped_ids: ['m1', 'm2', 'm3', 'm4', 'm5'],
    };
    mockFetchSuccess(reapResponse);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useReapMemories(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ dry_run: true, namespace: 'default' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.dry_run).toBe(true);
    expect(result.current.data?.reaped_count).toBe(5);
  });

  it('handles loading state', async () => {
    mockFetchSuccess({ reaped_count: 0, dry_run: false, soft_delete: true, reaped_ids: [] });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useReapMemories(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({});
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('handles error state', async () => {
    mockFetchError('Reap failed', 500);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useReapMemories(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useBulkSupersede', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends correct request body', async () => {
    const supersedeResponse = {
      superseded_count: 3,
      target_id: 'target-1',
      superseded_ids: ['mem-1', 'mem-2', 'mem-3'],
    };
    mockFetchSuccess(supersedeResponse);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBulkSupersede(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        source_ids: ['mem-1', 'mem-2', 'mem-3'],
        target_id: 'target-1',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.superseded_count).toBe(3);
  });

  it('handles errors', async () => {
    mockFetchError('Target memory not found', 404);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBulkSupersede(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        source_ids: ['mem-1'],
        target_id: 'nonexistent',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Target memory not found');
  });
});
