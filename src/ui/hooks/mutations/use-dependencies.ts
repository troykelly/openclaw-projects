/**
 * TanStack Query mutation hooks for work item dependencies.
 *
 * Issue #1712: Dependency creation/deletion (was read-only).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { workItemKeys } from '@/ui/hooks/queries/use-work-items.ts';

/** Body for creating a dependency. */
export interface CreateDependencyBody {
  target_id: string;
  direction: 'blocks' | 'blocked_by';
}

/** Add a dependency to a work item. */
export function useAddDependency(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateDependencyBody) =>
      apiClient.post(`/api/work-items/${workItemId}/dependencies`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.detail(workItemId) });
      queryClient.invalidateQueries({ queryKey: workItemKeys.lists() });
    },
  });
}

/** Remove a dependency from a work item. */
export function useRemoveDependency(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (depId: string) =>
      apiClient.delete(`/api/work-items/${workItemId}/dependencies/${depId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.detail(workItemId) });
      queryClient.invalidateQueries({ queryKey: workItemKeys.lists() });
    },
  });
}
