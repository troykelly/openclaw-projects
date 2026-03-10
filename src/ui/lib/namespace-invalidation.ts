/**
 * Namespace-aware query invalidation utilities (Issue #2363).
 *
 * TanStack Query v5 uses prefix matching for `invalidateQueries`. When
 * queries use namespace-prefixed keys like:
 *   [{ namespaces: ['ns1'] }, 'work-items', 'list', ...]
 *
 * bare invalidation like `{ queryKey: ['work-items'] }` will NOT match
 * because the first element differs.
 *
 * These utilities use predicate-based invalidation to match keys
 * containing the base key segment regardless of namespace prefix.
 */
import type { QueryClient, InvalidateQueryFilters, Query } from '@tanstack/react-query';

/**
 * Check whether a query key contains the given base key segments.
 *
 * Works for both namespace-prefixed keys (object at index 0) and bare keys.
 * Matches if the base key segments appear consecutively starting at index 0
 * or index 1 (after a namespace descriptor object).
 */
function queryKeyContainsBase(queryKey: readonly unknown[], baseKey: readonly unknown[]): boolean {
  if (baseKey.length === 0) return true;

  // Try matching at index 0 (bare keys) and index 1 (namespace-prefixed)
  for (const startIndex of [0, 1]) {
    if (startIndex + baseKey.length > queryKey.length) continue;

    let matches = true;
    for (let i = 0; i < baseKey.length; i++) {
      if (queryKey[startIndex + i] !== baseKey[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }

  return false;
}

/**
 * Create an `InvalidateQueryFilters` object that matches query keys
 * containing the given base key segments, regardless of namespace prefix.
 *
 * @param baseKey - The base query key segments to match (e.g. `['work-items']`)
 * @returns Filter object with a predicate for `queryClient.invalidateQueries()`
 *
 * @example
 * ```ts
 * // Instead of: queryClient.invalidateQueries({ queryKey: workItemKeys.all })
 * // Use:        queryClient.invalidateQueries(namespaceAwareInvalidation(workItemKeys.all))
 * ```
 */
export function namespaceAwareInvalidation(baseKey: readonly unknown[]): InvalidateQueryFilters {
  return {
    predicate: (query: Query) => queryKeyContainsBase(query.queryKey, baseKey),
  };
}

/**
 * Create a convenience invalidation function bound to a QueryClient.
 *
 * @param queryClient - The TanStack QueryClient instance
 * @returns A function that invalidates queries matching the base key
 *
 * @example
 * ```ts
 * const invalidate = createNamespaceInvalidator(queryClient);
 * invalidate(workItemKeys.all);
 * invalidate(workItemKeys.lists());
 * ```
 */
export function createNamespaceInvalidator(queryClient: QueryClient) {
  return (baseKey: readonly unknown[]): void => {
    void queryClient.invalidateQueries(namespaceAwareInvalidation(baseKey));
  };
}
