/**
 * Tests for TanStack Query mutation hooks.
 *
 * Verifies mutation behaviour, cache invalidation, and optimistic updates.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUpdateWorkItem } from '../../src/ui/hooks/mutations/use-update-work-item.ts';
import { useDeleteWorkItem } from '../../src/ui/hooks/mutations/use-delete-work-item.ts';
import { useCreateMemory } from '../../src/ui/hooks/mutations/use-create-memory.ts';
import { useUpdateMemory } from '../../src/ui/hooks/mutations/use-update-memory.ts';
import { useUpdateContact } from '../../src/ui/hooks/mutations/use-update-contact.ts';
import { workItemKeys } from '../../src/ui/hooks/queries/use-work-items.ts';
import type { WorkItemDetail } from '../../src/ui/lib/api-types.ts';

const originalFetch = globalThis.fetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: queryClient }, children);

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

describe('useUpdateWorkItem', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should update a work item', async () => {
    const updated = { id: 'abc', title: 'Updated', status: 'in_progress', priority: 'P2', kind: 'issue', created_at: '2026-01-01', updated_at: '2026-01-01' };
    mockFetchSuccess(updated);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ id: 'abc', body: { title: 'Updated', status: 'in_progress' } });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(updated);
  });

  it('should apply optimistic update to detail cache', async () => {
    const original: WorkItemDetail = {
      id: 'abc',
      title: 'Original',
      status: 'open',
      priority: 'P2',
      kind: 'issue',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };

    // Use a deferred promise to control when the server responds
    let resolveRequest: ((value: unknown) => void) | undefined;
    const serverPromise = new Promise((resolve) => {
      resolveRequest = resolve;
    });

    globalThis.fetch = vi.fn().mockImplementation(() => serverPromise);

    const { Wrapper, queryClient } = createWrapper();

    // Seed the cache with the original data
    queryClient.setQueryData(workItemKeys.detail('abc'), original);

    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper: Wrapper });

    // Trigger the mutation
    await act(async () => {
      result.current.mutate({ id: 'abc', body: { title: 'Optimistic Title' } });
      // Allow the onMutate handler to run by yielding to microtasks
      await Promise.resolve();
    });

    // Verify optimistic update was applied before server responds
    const cached = queryClient.getQueryData<WorkItemDetail>(workItemKeys.detail('abc'));
    expect(cached?.title).toBe('Optimistic Title');

    // Now let the server respond
    resolveRequest!({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ...original, title: 'Server Updated' }),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('should roll back optimistic update on error', async () => {
    const original: WorkItemDetail = {
      id: 'abc',
      title: 'Original',
      status: 'open',
      priority: 'P2',
      kind: 'issue',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };

    // Track the cache state through onError to verify rollback
    let rolledBackValue: WorkItemDetail | undefined;

    // Use a deferred promise to control timing
    let resolveRequest: ((value: unknown) => void) | undefined;
    const serverPromise = new Promise((resolve) => {
      resolveRequest = resolve;
    });

    globalThis.fetch = vi.fn().mockImplementation(() => serverPromise);

    // Use a QueryClient with longer GC time so data survives invalidation
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 300_000 },
        mutations: { retry: false },
      },
    });

    const Wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: queryClient }, children);

    // Seed the cache
    queryClient.setQueryData(workItemKeys.detail('abc'), original);

    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper: Wrapper });

    // Trigger the mutation
    await act(async () => {
      result.current.mutate(
        {
          id: 'abc',
          body: { status: 'in_progress' },
        },
        {
          onError: () => {
            // Capture the state right after onError rolls back
            rolledBackValue = queryClient.getQueryData<WorkItemDetail>(workItemKeys.detail('abc'));
          },
        },
      );
      await Promise.resolve();
    });

    // Verify optimistic update was applied
    const optimistic = queryClient.getQueryData<WorkItemDetail>(workItemKeys.detail('abc'));
    expect(optimistic?.status).toBe('in_progress');

    // Now let the server respond with an error
    resolveRequest!({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ message: 'Update failed' }),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Verify the rollback happened (captured in onError callback)
    expect(rolledBackValue?.status).toBe('open');
    expect(rolledBackValue?.title).toBe('Original');
  });
});

describe('useDeleteWorkItem', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should delete a work item and invalidate queries', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      json: async () => {
        throw new Error('no body');
      },
    });

    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteWorkItem(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ id: 'del-1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: workItemKeys.all }));
  });
});

describe('useCreateMemory', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should create a memory and invalidate queries', async () => {
    const created = { id: 'm1', title: 'Note', content: 'Details', created_at: '2026-01-01', updated_at: '2026-01-01' };
    mockFetchSuccess(created, 201);

    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateMemory(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        work_item_id: 'wi-1',
        body: { title: 'Note', content: 'Details' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe('useUpdateMemory', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should update a memory', async () => {
    const updated = { id: 'm1', title: 'Updated Note', content: 'Updated', created_at: '2026-01-01', updated_at: '2026-01-02' };
    mockFetchSuccess(updated);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateMemory(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        id: 'm1',
        body: { title: 'Updated Note' },
        work_item_id: 'wi-1',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(updated);
  });
});

describe('useUpdateContact', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should update a contact and invalidate queries', async () => {
    const updated = { id: 'c1', display_name: 'Jane Doe', notes: null, created_at: '2026-01-01', endpoints: [] };
    mockFetchSuccess(updated);

    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateContact(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        id: 'c1',
        body: { display_name: 'Jane Doe' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
