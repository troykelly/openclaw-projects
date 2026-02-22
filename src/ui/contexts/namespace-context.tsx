/**
 * Namespace context for multi-tenant data partitioning (Epic #1418).
 *
 * Reads namespace_grants from the bootstrap data injected by the server.
 * Persists the user's active namespace selection in localStorage.
 * Provides useNamespace() hook for components to access the active namespace.
 */

import * as React from 'react';
import type { AppBootstrap, NamespaceGrant } from '@/ui/lib/api-types';
import { readBootstrap } from '@/ui/lib/work-item-utils';

const ACTIVE_NAMESPACE_KEY = 'openclaw-active-namespace';

interface NamespaceContextValue {
  /** All namespace grants for the current user. */
  grants: NamespaceGrant[];
  /** The currently active namespace. */
  activeNamespace: string;
  /** Switch the active namespace. */
  setActiveNamespace: (namespace: string) => void;
  /** Whether the user has access to multiple namespaces. */
  hasMultipleNamespaces: boolean;
}

const NamespaceContext = React.createContext<NamespaceContextValue | null>(null);

/**
 * Determine the initial active namespace from localStorage or the default grant.
 */
function getInitialNamespace(grants: NamespaceGrant[]): string {
  // Try localStorage first
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(ACTIVE_NAMESPACE_KEY);
      if (stored && grants.some((g) => g.namespace === stored)) {
        return stored;
      }
    } catch {
      // localStorage may be unavailable
    }
  }

  // Use the home grant if available
  const defaultGrant = grants.find((g) => g.is_home);
  if (defaultGrant) return defaultGrant.namespace;

  // Fall back to first grant or 'default'
  return grants[0]?.namespace ?? 'default';
}

export function NamespaceProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const bootstrap = React.useMemo(() => readBootstrap<AppBootstrap>(), []);
  const grants = React.useMemo(() => bootstrap?.namespace_grants ?? [], [bootstrap]);

  const [activeNamespace, setActiveState] = React.useState(() => getInitialNamespace(grants));

  const setActiveNamespace = React.useCallback(
    (namespace: string) => {
      setActiveState(namespace);
      try {
        localStorage.setItem(ACTIVE_NAMESPACE_KEY, namespace);
      } catch {
        // localStorage may be unavailable
      }
    },
    [],
  );

  const value = React.useMemo<NamespaceContextValue>(
    () => ({
      grants,
      activeNamespace,
      setActiveNamespace,
      hasMultipleNamespaces: grants.length > 1,
    }),
    [grants, activeNamespace, setActiveNamespace],
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
