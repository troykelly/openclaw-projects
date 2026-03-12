/**
 * @vitest-environment jsdom
 *
 * Tests for NamespaceProvider auth gating (issue #2469).
 *
 * Verifies that NamespaceProvider does NOT call /me/grants when the user
 * is not authenticated, preventing infinite redirect loops on the login page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

// ── Mocks ──────────────────────────────────────────────────────────

// Mock user-context with controllable state
const mockUserState = {
  email: null as string | null,
  isLoading: false,
  isAuthenticated: false,
  logout: vi.fn(),
  signalAuthenticated: vi.fn(),
};

vi.mock('@/ui/contexts/user-context', () => ({
  useUser: () => ({ ...mockUserState }),
  useUserEmail: () => mockUserState.email,
  UserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock api-client: track calls to apiClient.get
vi.mock('@/ui/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/lib/api-client')>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn() },
  };
});

import { apiClient as mockedApiClient } from '@/ui/lib/api-client';
const mockApiGet = mockedApiClient.get as ReturnType<typeof vi.fn>;

import { NamespaceProvider, useNamespace } from '@/ui/contexts/namespace-context';

// ── Helpers ────────────────────────────────────────────────────────

function clearBootstrapData(): void {
  const el = document.getElementById('app-bootstrap');
  if (el) el.remove();
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <NamespaceProvider>{children}</NamespaceProvider>
    </QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('NamespaceProvider auth gating (#2469)', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
    mockApiGet.mockReset();
    mockUserState.email = null;
    mockUserState.isLoading = false;
    mockUserState.isAuthenticated = false;
  });

  it('does NOT call /me/grants when user is not authenticated', async () => {
    // No bootstrap data → would normally trigger API fetch
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

    // Wait for the effect to settle
    await waitFor(() => {
      expect(result.current.isNamespaceReady).toBe(true);
    });

    // /me/grants should NOT have been called
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('does NOT call /me/grants while auth is still loading', async () => {
    mockUserState.isLoading = true;
    const { Wrapper } = createWrapper();

    renderHook(() => useNamespace(), { wrapper: Wrapper });

    // Give effects time to run
    await new Promise((r) => setTimeout(r, 50));

    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('calls /me/grants when user IS authenticated and no bootstrap data', async () => {
    mockUserState.email = 'test@example.com';
    mockUserState.isAuthenticated = true;
    mockUserState.isLoading = false;

    mockApiGet.mockResolvedValueOnce({
      namespace_grants: [{ namespace: 'test', access: 'readwrite', is_home: true }],
      active_namespaces: ['test'],
    });

    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isNamespaceReady).toBe(true);
    });

    expect(mockApiGet).toHaveBeenCalledWith('/me/grants');
    expect(result.current.grants).toEqual([
      { namespace: 'test', access: 'readwrite', is_home: true },
    ]);
  });

  it('sets isNamespaceReady=true immediately for unauthenticated users', async () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isNamespaceReady).toBe(true);
    });

    // Should be ready with empty grants, not stuck loading
    expect(result.current.grants).toEqual([]);
  });
});
