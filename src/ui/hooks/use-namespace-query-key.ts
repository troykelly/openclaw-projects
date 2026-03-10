/**
 * Hook to generate namespace-aware TanStack Query keys (#2350).
 *
 * Prepends a namespace descriptor object to the base query key so that
 * cache entries are properly segmented by active namespace(s). When the
 * user switches namespace, all query keys change, preventing stale data
 * from being served from the previous namespace's cache.
 *
 * @example
 * ```ts
 * const key = useNamespaceQueryKey(['projects', 'list']);
 * // → [{ namespaces: ['troy'] }, 'projects', 'list']
 * ```
 */

import { useActiveNamespaces } from '@/ui/contexts/namespace-context';

/**
 * Safely get active namespaces. Returns ['default'] when called
 * outside a React rendering context (e.g. in test environments
 * that call hooks directly without React wrappers).
 */
function useActiveNamespacesSafe(): string[] {
  try {
    // biome-ignore lint/correctness/useHookAtTopLevel: Always called, try/catch is for test environments calling hooks outside React render
    return useActiveNamespaces();
  } catch {
    return ['default'];
  }
}

/**
 * Generate a namespace-aware query key by prepending a namespace descriptor.
 *
 * @param baseKey - The original query key tuple
 * @returns A new key with namespace info prepended
 */
export function useNamespaceQueryKey<T extends readonly unknown[]>(baseKey: T): [{ namespaces: string[] }, ...T] {
  const activeNamespaces = useActiveNamespacesSafe();
  return [{ namespaces: activeNamespaces }, ...baseKey];
}
