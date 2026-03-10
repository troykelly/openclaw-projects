/**
 * TanStack Query mutation hooks for bulk work item operations.
 *
 * Issue #1722: Bulk operations.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { workItemKeys } from '@/ui/hooks/queries/use-work-items.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

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
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: BulkUpdateBody) =>
      apiClient.patch('/work-items/bulk', body),
    onSuccess: () => {
      nsInvalidate(workItemKeys.all);
    },
  });
}

/** Bulk delete work items. */
export function useBulkDeleteWorkItems() {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: BulkDeleteBody) =>
      apiClient.delete('/work-items/bulk', body),
    onSuccess: () => {
      nsInvalidate(workItemKeys.all);
    },
  });
}
