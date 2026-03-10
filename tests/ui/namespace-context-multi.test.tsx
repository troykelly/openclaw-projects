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
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';

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
