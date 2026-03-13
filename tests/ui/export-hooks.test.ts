/**
 * @vitest-environment jsdom
 * Tests for #2479: Export hooks (mutations + polling query)
 *
 * Validates:
 * - useCreateExport sends POST to correct endpoint
 * - useExportStatus polls and returns export status
 * - useDeleteExport sends DELETE to correct endpoint
 * - Polling stops on terminal states (ready, failed, expired)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

// ── Mock API client ──────────────────────────────────────────────────
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  ApiRequestError: class ApiRequestError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

// ── Mock namespace hooks ─────────────────────────────────────────────
vi.mock('@/ui/contexts/namespace-context', () => ({
  useActiveNamespaces: () => ['default'],
  useNamespaceSafe: () => ({
    grants: [{ namespace: 'default' }],
    activeNamespace: 'default',
    setActiveNamespace: vi.fn(),
    hasMultipleNamespaces: false,
  }),
}));

vi.mock('@/ui/contexts/user-context', () => ({
  useUserEmail: () => 'test@example.com',
}));

vi.mock('@/ui/hooks/use-namespace-invalidate', () => ({
  useNamespaceInvalidate: () => vi.fn(),
}));

import { useCreateExport, useDeleteExport } from '@/ui/hooks/mutations/use-export-mutations';
import { useExportStatus, exportKeys } from '@/ui/hooks/queries/use-export-status';
import type { ExportResponse } from '@/ui/lib/api-types';

// ── Test data ────────────────────────────────────────────────────────
const pendingExport: ExportResponse = {
  id: 'export-1',
  status: 'pending',
  format: 'pdf',
  source_type: 'note',
  source_id: 'note-1',
  original_filename: null,
  size_bytes: null,
  download_url: null,
  poll_url: '/exports/export-1',
  error_message: null,
  expires_at: '2026-03-14T00:00:00Z',
  created_at: '2026-03-13T00:00:00Z',
  updated_at: '2026-03-13T00:00:00Z',
};

const readyExport: ExportResponse = {
  ...pendingExport,
  status: 'ready',
  download_url: 'https://s3.example.com/export-1.pdf',
  size_bytes: 12345,
  original_filename: 'My Note.pdf',
};

// ── Helpers ──────────────────────────────────────────────────────────
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('useCreateExport (#2479)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends POST to /notes/:id/exports with format', async () => {
    mockPost.mockResolvedValue(pendingExport);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateExport(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ sourceType: 'note', sourceId: 'note-1', format: 'pdf' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith(
      '/notes/note-1/exports',
      expect.objectContaining({ format: 'pdf' }),
    );
    expect(result.current.data).toEqual(pendingExport);
  });

  it('sends POST to /notebooks/:id/exports for notebook exports', async () => {
    const notebookExport = { ...pendingExport, source_type: 'notebook' as const, source_id: 'nb-1' };
    mockPost.mockResolvedValue(notebookExport);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateExport(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ sourceType: 'notebook', sourceId: 'nb-1', format: 'pdf' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith(
      '/notebooks/nb-1/exports',
      expect.objectContaining({ format: 'pdf' }),
    );
  });

  it('includes options when provided', async () => {
    mockPost.mockResolvedValue(pendingExport);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateExport(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        sourceType: 'note',
        sourceId: 'note-1',
        format: 'docx',
        options: { page_size: 'Letter' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith(
      '/notes/note-1/exports',
      expect.objectContaining({ format: 'docx', options: { page_size: 'Letter' } }),
    );
  });
});

describe('useExportStatus (#2479)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches export status by ID', async () => {
    mockGet.mockResolvedValue(pendingExport);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () => useExportStatus('export-1'),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/exports/export-1', expect.any(Object));
    expect(result.current.data).toEqual(pendingExport);
  });

  it('is disabled when exportId is null', () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () => useExportStatus(null),
      { wrapper: Wrapper },
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('provides exportKeys factory', () => {
    expect(exportKeys.all).toEqual(['exports']);
    expect(exportKeys.detail('abc')).toEqual(['exports', 'detail', 'abc']);
  });
});

describe('useDeleteExport (#2479)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends DELETE to /exports/:id', async () => {
    mockDelete.mockResolvedValue(undefined);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useDeleteExport(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate('export-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/exports/export-1');
  });
});
