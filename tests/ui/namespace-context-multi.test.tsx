/**
 * @vitest-environment jsdom
 * Tests for multi-namespace context extensions (#2351, #2360).
 *
 * Validates:
 * - Multi-namespace selection state transitions
 * - toggleNamespace behaviour
 * - localStorage persistence and migration from old format
 * - isNamespaceReady flag for race prevention
 * - Query cancellation on namespace switch
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';

// Mock user-context so useUser() doesn't throw inside NamespaceProvider (#2469)
vi.mock('@/ui/contexts/user-context', () => ({
  useUser: () => ({ email: 'test@test.com', isLoading: false, isAuthenticated: true, logout: vi.fn(), signalAuthenticated: vi.fn() }),
  useUserEmail: () => 'test@test.com',
  UserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Partial mock for api-client: only mock apiClient.get, keep real setNamespaceResolver
vi.mock('@/ui/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ui/lib/api-client')>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn() },
  };
});
// Re-import after mock to get the mocked function reference
import { apiClient as mockedApiClient } from '@/ui/lib/api-client';
const mockApiGet = mockedApiClient.get as ReturnType<typeof vi.fn>;

import {
  NamespaceProvider,
  useNamespace,
  useActiveNamespace,
  useActiveNamespaces,
} from '@/ui/contexts/namespace-context';

// ── helpers ──────────────────────────────────────────────────────────

function setBootstrapData(data: Record<string, unknown>): void {
  let el = document.getElementById('app-bootstrap');
  if (!el) {
    el = document.createElement('script');
    el.id = 'app-bootstrap';
    el.type = 'application/json';
    document.body.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

function clearBootstrapData(): void {
  const el = document.getElementById('app-bootstrap');
  if (el) el.remove();
}

const MULTI_GRANTS = [
  { namespace: 'troy', access: 'readwrite', is_home: true },
  { namespace: 'household', access: 'readwrite', is_home: false },
  { namespace: 'team', access: 'readonly', is_home: false },
];

function createMultiWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  setBootstrapData({ namespace_grants: MULTI_GRANTS });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <NamespaceProvider>{children}</NamespaceProvider>
    </QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Multi-namespace context (#2351)', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
    mockApiGet.mockReset();
  });

  afterEach(() => {
    clearBootstrapData();
  });

  describe('activeNamespaces state', () => {
    it('initialises activeNamespaces as single-element array from home grant', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });
      expect(result.current.activeNamespaces).toEqual(['troy']);
      expect(result.current.activeNamespace).toBe('troy');
    });

    it('setActiveNamespaces updates multi-namespace selection', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      act(() => {
        result.current.setActiveNamespaces(['troy', 'household']);
      });

      expect(result.current.activeNamespaces).toEqual(['troy', 'household']);
      expect(result.current.activeNamespace).toBe('troy');
      expect(result.current.isMultiNamespaceMode).toBe(true);
    });

    it('setActiveNamespace sets single namespace and clears multi-select', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      act(() => {
        result.current.setActiveNamespaces(['troy', 'household']);
      });
      expect(result.current.isMultiNamespaceMode).toBe(true);

      act(() => {
        result.current.setActiveNamespace('household');
      });
      expect(result.current.activeNamespaces).toEqual(['household']);
      expect(result.current.activeNamespace).toBe('household');
      expect(result.current.isMultiNamespaceMode).toBe(false);
    });

    it('toggleNamespace adds a namespace to the active set', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      act(() => {
        result.current.toggleNamespace('household');
      });

      expect(result.current.activeNamespaces).toContain('troy');
      expect(result.current.activeNamespaces).toContain('household');
    });

    it('toggleNamespace removes a non-primary namespace from active set', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      act(() => {
        result.current.setActiveNamespaces(['troy', 'household']);
      });

      act(() => {
        result.current.toggleNamespace('household');
      });

      expect(result.current.activeNamespaces).toEqual(['troy']);
    });

    it('toggleNamespace cannot remove the primary (first) namespace', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      act(() => {
        result.current.setActiveNamespaces(['troy', 'household']);
      });

      act(() => {
        result.current.toggleNamespace('troy');
      });

      // troy should remain as it's the primary
      expect(result.current.activeNamespaces).toContain('troy');
    });
  });

  describe('backwards compatibility', () => {
    it('useActiveNamespace returns single string', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useActiveNamespace(), { wrapper: Wrapper });
      expect(typeof result.current).toBe('string');
      expect(result.current).toBe('troy');
    });

    it('useActiveNamespaces returns string array', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useActiveNamespaces(), { wrapper: Wrapper });
      expect(Array.isArray(result.current)).toBe(true);
      expect(result.current).toEqual(['troy']);
    });
  });

  describe('localStorage persistence', () => {
    it('persists activeNamespaces to localStorage', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      act(() => {
        result.current.setActiveNamespaces(['troy', 'household']);
      });

      const stored = localStorage.getItem('openclaw-active-namespaces');
      expect(stored).toBe(JSON.stringify(['troy', 'household']));
    });

    it('restores activeNamespaces from localStorage', () => {
      localStorage.setItem('openclaw-active-namespaces', JSON.stringify(['household', 'team']));
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      expect(result.current.activeNamespaces).toEqual(['household', 'team']);
    });

    it('migrates old single-namespace localStorage format', () => {
      // Old format: just a string under the old key
      localStorage.setItem('openclaw-active-namespace', 'household');
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      expect(result.current.activeNamespaces).toEqual(['household']);
      expect(result.current.activeNamespace).toBe('household');
    });

    it('filters out invalid grants from stored namespaces', () => {
      localStorage.setItem('openclaw-active-namespaces', JSON.stringify(['troy', 'nonexistent']));
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      expect(result.current.activeNamespaces).toEqual(['troy']);
    });
  });

  describe('isMultiNamespaceMode', () => {
    it('is false when single namespace selected', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });
      expect(result.current.isMultiNamespaceMode).toBe(false);
    });

    it('is true when multiple namespaces selected', () => {
      const { Wrapper } = createMultiWrapper();
      const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

      act(() => {
        result.current.setActiveNamespaces(['troy', 'household']);
      });

      expect(result.current.isMultiNamespaceMode).toBe(true);
    });
  });
});

describe('Namespace race prevention (#2360)', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
  });

  afterEach(() => {
    clearBootstrapData();
  });

  it('exposes isNamespaceReady flag', () => {
    const { Wrapper } = createMultiWrapper();
    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });
    expect(result.current.isNamespaceReady).toBe(true);
  });

  it('cancels queries on namespace switch', () => {
    const { Wrapper, queryClient } = createMultiWrapper();
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
    const resetSpy = vi.spyOn(queryClient, 'resetQueries');
    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

    act(() => {
      result.current.setActiveNamespace('household');
    });

    expect(cancelSpy).toHaveBeenCalled();
    expect(resetSpy).toHaveBeenCalled();
  });

  it('increments namespaceVersion on switch', () => {
    const { Wrapper } = createMultiWrapper();
    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });
    const initialVersion = result.current.namespaceVersion;

    act(() => {
      result.current.setActiveNamespace('household');
    });

    expect(result.current.namespaceVersion).toBeGreaterThan(initialVersion);
  });
});

describe('API-fetch fallback when bootstrap is empty (Issue #2405)', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
    mockApiGet.mockReset();
  });

  afterEach(() => {
    clearBootstrapData();
  });

  it('fetches grants from /me/grants when bootstrap has no namespace_grants', async () => {
    // Do NOT set bootstrap data — simulates production static serving
    const apiGrants = [
      { namespace: 'fetched-ns', access: 'readwrite', is_home: true },
    ];

    let resolveFn: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => { resolveFn = resolve; });
    mockApiGet.mockReturnValue(fetchPromise);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <NamespaceProvider>{children}</NamespaceProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

    // Initially not ready (no bootstrap)
    expect(result.current.isNamespaceReady).toBe(false);

    // Resolve the fetch and flush React state
    await act(async () => {
      resolveFn!({
        namespace_grants: apiGrants,
        active_namespaces: ['fetched-ns'],
      });
      // Flush microtasks
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isNamespaceReady).toBe(true);
    expect(result.current.grants).toHaveLength(1);
    expect(result.current.grants[0].namespace).toBe('fetched-ns');
    expect(result.current.activeNamespace).toBe('fetched-ns');
  });

  it('uses bootstrap grants when available (no API fetch)', () => {
    setBootstrapData({
      namespace_grants: [
        { namespace: 'bootstrap-ns', access: 'readwrite', is_home: true },
      ],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <NamespaceProvider>{children}</NamespaceProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

    // Immediately ready from bootstrap
    expect(result.current.isNamespaceReady).toBe(true);
    expect(result.current.grants).toHaveLength(1);
    expect(result.current.grants[0].namespace).toBe('bootstrap-ns');
  });

  it('degrades gracefully when API fetch fails', async () => {
    // No bootstrap data — simulates production with static nginx.
    // Use a controlled promise so rejection happens inside act().
    let rejectFn: (err: Error) => void;
    const fetchPromise = new Promise((_resolve, reject) => { rejectFn = reject; });
    fetchPromise.catch(() => {}); // Prevent Node unhandled-rejection warning
    mockApiGet.mockReturnValue(fetchPromise);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <NamespaceProvider>{children}</NamespaceProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

    expect(mockApiGet).toHaveBeenCalledWith('/me/grants');
    expect(result.current.isNamespaceReady).toBe(false);

    // Reject inside act to trigger .catch() → setIsNamespaceReady(true)
    await act(async () => {
      rejectFn!(new Error('Network error'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isNamespaceReady).toBe(true);
    expect(result.current.grants).toHaveLength(0);
    expect(result.current.activeNamespace).toBe('default');
  });

  it('does not clobber localStorage before grants load (#2563)', async () => {
    // Pre-populate localStorage with a previously saved namespace
    localStorage.setItem('openclaw-active-namespaces', JSON.stringify(['my-saved-ns']));

    // No bootstrap data — simulates production static nginx
    const apiGrants = [
      { namespace: 'my-saved-ns', access: 'readwrite', is_home: true },
    ];

    let resolveFn: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => { resolveFn = resolve; });
    mockApiGet.mockReturnValue(fetchPromise);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <NamespaceProvider>{children}</NamespaceProvider>
      </QueryClientProvider>
    );

    renderHook(() => useNamespace(), { wrapper: Wrapper });

    // Before grants arrive, localStorage should NOT have been overwritten
    // with ['default'] — the persist effect must be guarded by isNamespaceReady
    const storedBeforeGrants = localStorage.getItem('openclaw-active-namespaces');
    expect(storedBeforeGrants).toBe(JSON.stringify(['my-saved-ns']));

    // Now resolve the API fetch
    await act(async () => {
      resolveFn!({
        namespace_grants: apiGrants,
        active_namespaces: ['my-saved-ns'],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // After grants load, localStorage should reflect the resolved namespace
    const storedAfterGrants = localStorage.getItem('openclaw-active-namespaces');
    expect(storedAfterGrants).toBe(JSON.stringify(['my-saved-ns']));
  });

  it('setActiveNamespace writes to both legacy and multi-namespace localStorage keys (#2563)', () => {
    setBootstrapData({ namespace_grants: MULTI_GRANTS });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <NamespaceProvider>{children}</NamespaceProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useNamespace(), { wrapper: Wrapper });

    act(() => {
      result.current.setActiveNamespace('household');
    });

    expect(localStorage.getItem('openclaw-active-namespace')).toBe('household');
    expect(localStorage.getItem('openclaw-active-namespaces')).toBe(JSON.stringify(['household']));
  });
});
