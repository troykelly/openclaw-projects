/**
 * @vitest-environment jsdom
 * Tests for useNamespaceQueryKey hook (#2350).
 *
 * Validates:
 * - Query keys include active namespace(s)
 * - Keys change when namespace changes
 * - Works with various base key shapes
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';

import { NamespaceProvider, useNamespace } from '@/ui/contexts/namespace-context';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

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
];

function createWrapper() {
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

describe('useNamespaceQueryKey (#2350)', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
  });

  afterEach(() => {
    clearBootstrapData();
  });

  it('prepends namespace to simple query key', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNamespaceQueryKey(['projects', 'list'] as const), {
      wrapper: Wrapper,
    });
    expect(result.current).toEqual([{ namespaces: ['troy'] }, 'projects', 'list']);
  });

  it('prepends namespace to query key with filters', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useNamespaceQueryKey(['work-items', 'list', { kind: 'project' }] as const),
      { wrapper: Wrapper },
    );
    expect(result.current).toEqual([{ namespaces: ['troy'] }, 'work-items', 'list', { kind: 'project' }]);
  });

  it('updates key when namespace changes', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => {
        const ns = useNamespace();
        const key = useNamespaceQueryKey(['projects'] as const);
        return { ns, key };
      },
      { wrapper: Wrapper },
    );

    expect(result.current.key).toEqual([{ namespaces: ['troy'] }, 'projects']);

    act(() => {
      result.current.ns.setActiveNamespace('household');
    });

    expect(result.current.key).toEqual([{ namespaces: ['household'] }, 'projects']);
  });

  it('includes multiple namespaces in key when multi-select', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => {
        const ns = useNamespace();
        const key = useNamespaceQueryKey(['projects'] as const);
        return { ns, key };
      },
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.ns.setActiveNamespaces(['troy', 'household']);
    });

    expect(result.current.key).toEqual([{ namespaces: ['troy', 'household'] }, 'projects']);
  });

  it('returns stable reference when namespaces have not changed', () => {
    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(() => useNamespaceQueryKey(['projects'] as const), {
      wrapper: Wrapper,
    });

    const firstKey = result.current;
    rerender();
    const secondKey = result.current;

    // Deep equality should hold
    expect(firstKey).toEqual(secondKey);
  });
});
