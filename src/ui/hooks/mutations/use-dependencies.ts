/**
 * TanStack Query mutation hooks for work item dependencies.
 *
 * Issue #1712: Dependency creation/deletion (was read-only).
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { workItemKeys } from '@/ui/hooks/queries/use-work-items.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

/** Body for creating a dependency. */
export interface CreateDependencyBody {
  target_id: string;
  direction: 'blocks' | 'blocked_by';
}

/** Add a dependency to a work item. */
export function useAddDependency(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: CreateDependencyBody) =>
      apiClient.post(`/work-items/${workItemId}/dependencies`, body),
    onSuccess: () => {
      nsInvalidate(workItemKeys.detail(workItemId));
      nsInvalidate(workItemKeys.lists());
    },
  });
}

/** Remove a dependency from a work item. */
export function useRemoveDependency(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (depId: string) =>
      apiClient.delete(`/work-items/${workItemId}/dependencies/${depId}`),
    onSuccess: () => {
      nsInvalidate(workItemKeys.detail(workItemId));
      nsInvalidate(workItemKeys.lists());
    },
  });
}
