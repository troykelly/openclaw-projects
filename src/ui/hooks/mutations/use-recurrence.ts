/**
 * TanStack Query mutation hooks for work item recurrence.
 *
 * Issue #1710: Recurring tasks.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { recurrenceKeys } from '@/ui/hooks/queries/use-recurrence.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

/** Body for setting recurrence. */
export interface SetRecurrenceBody {
  recurrence_natural: string;
}

/** Set or update recurrence for a work item. */
export function useSetRecurrence(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: SetRecurrenceBody) =>
      apiClient.put(`/work-items/${workItemId}/recurrence`, body),
    onSuccess: () => {
      nsInvalidate(recurrenceKeys.rule(workItemId));
      nsInvalidate(recurrenceKeys.instances(workItemId));
    },
  });
}

/** Remove recurrence from a work item. */
export function useDeleteRecurrence(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: () =>
      apiClient.delete(`/work-items/${workItemId}/recurrence`),
    onSuccess: () => {
      nsInvalidate(recurrenceKeys.rule(workItemId));
      nsInvalidate(recurrenceKeys.instances(workItemId));
    },
  });
}
