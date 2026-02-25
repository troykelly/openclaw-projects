/**
 * TanStack Query mutation hooks for bulk work item operations.
 *
 * Issue #1722: Bulk operations.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { workItemKeys } from '@/ui/hooks/queries/use-work-items.ts';

/** Body for bulk status/priority update. */
export interface BulkUpdateBody {
  ids: string[];
  status?: string;
  priority?: string;
}

/** Body for bulk delete. */
export interface BulkDeleteBody {
  ids: string[];
}

/** Bulk update work items (status/priority). */
export function useBulkUpdateWorkItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: BulkUpdateBody) =>
      apiClient.patch('/api/work-items/bulk', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });
}

/** Bulk delete work items. */
export function useBulkDeleteWorkItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: BulkDeleteBody) =>
      apiClient.post('/api/work-items/bulk/delete', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });
}
