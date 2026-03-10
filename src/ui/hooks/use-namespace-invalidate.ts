/**
 * Hook for namespace-aware query invalidation in mutation callbacks (#2363).
 *
 * Returns a function that invalidates queries matching the given base key
 * segments, regardless of whether the query key has a namespace prefix.
 *
 * @example
 * ```ts
 * const nsInvalidate = useNamespaceInvalidate();
 *
 * return useMutation({
 *   mutationFn: ...,
 *   onSuccess: () => {
 *     nsInvalidate(workItemKeys.all);
 *     nsInvalidate(workItemKeys.lists());
 *   },
 * });
 * ```
 */
import { useQueryClient } from '@tanstack/react-query';
import { createNamespaceInvalidator } from '@/ui/lib/namespace-invalidation';

export function useNamespaceInvalidate() {
  const queryClient = useQueryClient();
  return createNamespaceInvalidator(queryClient);
}
