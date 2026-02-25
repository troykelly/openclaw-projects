/**
 * TanStack Query mutation hook for creating work items.
 *
 * Invalidates work item list/tree queries on success.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { CreateWorkItemBody, WorkItemDetail } from '@/ui/lib/api-types.ts';
import { workItemKeys } from '@/ui/hooks/queries/use-work-items.ts';

/**
 * Create a new work item.
 *
 * @returns TanStack mutation with `CreateWorkItemBody` as variables and `WorkItemDetail` as data
 *
 * @example
 * ```ts
 * const { mutate } = useCreateWorkItem();
 * mutate({ title: 'New task', kind: 'issue' });
 * ```
 */
export function useCreateWorkItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateWorkItemBody) => apiClient.post<WorkItemDetail>('/api/work-items', body),

    onSuccess: () => {
      // Invalidate all work item queries so lists and trees refresh
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });
}
