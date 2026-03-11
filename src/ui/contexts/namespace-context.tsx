/**
 * Namespace context for multi-tenant data partitioning (Epic #1418, #2351).
 *
 * Reads namespace_grants from the bootstrap data injected by the server.
 * Persists the user's active namespace selection in localStorage.
 * Provides useNamespace() hook for components to access the active namespace.
 *
 * Supports multi-namespace selection for combined read views (#2351).
 * Handles race prevention on namespace switch (#2360):
 * - Cancels inflight queries
 * - Exposes isNamespaceReady flag
 * - Tracks namespaceVersion for stale-check
 */

import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { apiClient, setNamespaceResolver } from '@/ui/lib/api-client';
import type { AppBootstrap, NamespaceGrant } from '@/ui/lib/api-types';
import { readBootstrap } from '@/ui/lib/work-item-utils';

/**
 * Safely get the query client. Returns null when QueryClientProvider
 * is not present (e.g. in test environments without full provider tree).
 */
function useQueryClientSafe(): QueryClient | null {
  try {
    // biome-ignore lint/correctness/useHookAtTopLevel: Always called, try/catch is for test environments without QueryClientProvider
    return useQueryClient();
  } catch {
    return null;
  }
}

const ACTIVE_NAMESPACE_KEY = 'openclaw-active-namespace';
const ACTIVE_NAMESPACES_KEY = 'openclaw-active-namespaces';

interface NamespaceContextValue {
  /** All namespace grants for the current user. */
  grants: NamespaceGrant[];
  /** Primary active namespace (for write operations). First of activeNamespaces. */
  activeNamespace: string;
  /** Switch to a single active namespace. */
  setActiveNamespace: (namespace: string) => void;
  /** All selected namespaces (for read/query operations). Includes activeNamespace. */
  activeNamespaces: string[];
  /** Set multiple active namespaces. First element is the primary. */
  setActiveNamespaces: (namespaces: string[]) => void;
  /** Toggle a namespace in/out of the active set. Cannot remove the primary. */
  toggleNamespace: (namespace: string) => void;
  /** Whether the user has access to multiple namespaces. */
  hasMultipleNamespaces: boolean;
  /** Whether multi-namespace mode is active (more than one selected). */
  isMultiNamespaceMode: boolean;
  /** Whether namespace context is fully initialized and ready for queries. */
  isNamespaceReady: boolean;
  /** Monotonically increasing version counter, incremented on namespace switch. */
  namespaceVersion: number;
}

const NamespaceContext = React.createContext<NamespaceContextValue | null>(null);

/**
 * Determine initial active namespaces from localStorage (new or migrated) or grants.
 */
function getInitialNamespaces(grants: NamespaceGrant[]): string[] {
  if (typeof window === 'undefined') {
    return [grants.find((g) => g.is_home)?.namespace ?? grants[0]?.namespace ?? 'default'];
  }

  const grantNames = new Set(grants.map((g) => g.namespace));

  try {
    // Try new multi-namespace format first
    const storedMulti = localStorage.getItem(ACTIVE_NAMESPACES_KEY);
    if (storedMulti) {
      const parsed = JSON.parse(storedMulti) as string[];
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((ns) => grantNames.has(ns));
        if (valid.length > 0) return valid;
      }
    }

    // Migrate from old single-namespace format
    const storedSingle = localStorage.getItem(ACTIVE_NAMESPACE_KEY);
    if (storedSingle && grantNames.has(storedSingle)) {
      return [storedSingle];
    }
  } catch {
    // localStorage may be unavailable
  }

  // Fall back to home grant or first grant
  const homeGrant = grants.find((g) => g.is_home);
  if (homeGrant) return [homeGrant.namespace];
  return [grants[0]?.namespace ?? 'default'];
}

/** Response shape from GET /api/me/grants (Issue #2405). */
interface MeGrantsResponse {
  namespace_grants: NamespaceGrant[];
  active_namespaces: string[];
}

export function NamespaceProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const bootstrap = React.useMemo(() => readBootstrap<AppBootstrap>(), []);
  const bootstrapGrants = React.useMemo(() => bootstrap?.namespace_grants ?? [], [bootstrap]);
  const queryClient = useQueryClientSafe();

  // Issue #2405: In production, static nginx serves /app/* without bootstrap injection.
  // When bootstrap grants are empty, fetch from the API on mount.
  const [fetchedGrants, setFetchedGrants] = React.useState<NamespaceGrant[] | null>(null);
  const [isNamespaceReady, setIsNamespaceReady] = React.useState(bootstrapGrants.length > 0);
  const grants = fetchedGrants ?? bootstrapGrants;

  React.useEffect(() => {
    if (bootstrapGrants.length > 0) return; // Bootstrap data available, no fetch needed

    let cancelled = false;
    apiClient.get<MeGrantsResponse>('/me/grants')
      .then((data) => {
        if (cancelled) return;
        setFetchedGrants(data.namespace_grants ?? []);
        setIsNamespaceReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        // On failure, mark ready with empty grants (graceful degradation)
        setIsNamespaceReady(true);
      });
    return () => { cancelled = true; };
  }, [bootstrapGrants.length]);

  const [activeNamespaces, setActiveNamespacesState] = React.useState(() => getInitialNamespaces(grants));
  const [namespaceVersion, setNamespaceVersion] = React.useState(0);

  // Issue #2405: Re-initialize activeNamespaces when API-fetched grants arrive
  React.useEffect(() => {
    if (fetchedGrants && fetchedGrants.length > 0) {
      setActiveNamespacesState(getInitialNamespaces(fetchedGrants));
    }
  }, [fetchedGrants]);

  // Persist to localStorage whenever activeNamespaces changes
  React.useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_NAMESPACES_KEY, JSON.stringify(activeNamespaces));
    } catch {
      // localStorage may be unavailable
    }
  }, [activeNamespaces]);

  // Sync namespace resolver for api-client header injection (#2349)
  React.useEffect(() => {
    setNamespaceResolver(() => activeNamespaces);
    return () => setNamespaceResolver(() => []);
  }, [activeNamespaces]);

  const setActiveNamespaces = React.useCallback(
    (namespaces: string[]) => {
      if (namespaces.length === 0) return;
      setActiveNamespacesState(namespaces);
      setNamespaceVersion((v) => v + 1);
      // Cancel inflight queries and reset cache on namespace change (#2360)
      if (queryClient) {
        void queryClient.cancelQueries();
        void queryClient.resetQueries();
      }
    },
    [queryClient],
  );

  const setActiveNamespace = React.useCallback(
    (namespace: string) => {
      setActiveNamespacesState([namespace]);
      setNamespaceVersion((v) => v + 1);
      try {
        localStorage.setItem(ACTIVE_NAMESPACE_KEY, namespace);
      } catch {
        // localStorage may be unavailable
      }
      // Cancel inflight queries and reset cache on namespace change (#2360)
      if (queryClient) {
        void queryClient.cancelQueries();
        void queryClient.resetQueries();
      }
    },
    [queryClient],
  );

  const toggleNamespace = React.useCallback(
    (namespace: string) => {
      setActiveNamespacesState((prev) => {
        const isActive = prev.includes(namespace);
        if (isActive) {
          // Cannot remove the primary namespace (first element)
          if (prev[0] === namespace) return prev;
          return prev.filter((ns) => ns !== namespace);
        }
        return [...prev, namespace];
      });
      setNamespaceVersion((v) => v + 1);
      // Cancel inflight queries and reset cache on namespace change (#2360)
      if (queryClient) {
        void queryClient.cancelQueries();
        void queryClient.resetQueries();
      }
    },
    [queryClient],
  );

  const activeNamespace = activeNamespaces[0] ?? 'default';

  const value = React.useMemo<NamespaceContextValue>(
    () => ({
      grants,
      activeNamespace,
      setActiveNamespace,
      activeNamespaces,
      setActiveNamespaces,
      toggleNamespace,
      hasMultipleNamespaces: grants.length > 1,
      isMultiNamespaceMode: activeNamespaces.length > 1,
      isNamespaceReady,
      namespaceVersion,
    }),
    [grants, activeNamespace, setActiveNamespace, activeNamespaces, setActiveNamespaces, toggleNamespace, isNamespaceReady, namespaceVersion],
  );

  return <NamespaceContext.Provider value={value}>{children}</NamespaceContext.Provider>;
}

/**
 * Hook to access the namespace context.
 *
 * @throws Error if used outside NamespaceProvider
 */
export function useNamespace(): NamespaceContextValue {
  const context = React.useContext(NamespaceContext);
  if (!context) {
    throw new Error('useNamespace must be used within a NamespaceProvider');
  }
  return context;
}

/**
 * Hook to access namespace context without throwing if outside provider.
 * Returns null when no NamespaceProvider is present (safe for components
 * that may render in test environments without the full provider tree).
 */
export function useNamespaceSafe(): NamespaceContextValue | null {
  return React.useContext(NamespaceContext);
}

/**
 * Hook to get just the active namespace string.
 * Returns 'default' if outside NamespaceProvider (safe for use in query hooks).
 */
export function useActiveNamespace(): string {
  const context = React.useContext(NamespaceContext);
  return context?.activeNamespace ?? 'default';
}

/**
 * Hook to get the active namespaces array.
 * Returns ['default'] if outside NamespaceProvider.
 */
export function useActiveNamespaces(): string[] {
  const context = React.useContext(NamespaceContext);
  return context?.activeNamespaces ?? ['default'];
}
