/**
 * TanStack Query mutation hooks for work item recurrence.
 *
 * Issue #1710: Recurring tasks.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { recurrenceKeys } from '@/ui/hooks/queries/use-recurrence.ts';

/** Body for setting recurrence. */
export interface SetRecurrenceBody {
  recurrence_natural: string;
}

/** Set or update recurrence for a work item. */
export function useSetRecurrence(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SetRecurrenceBody) =>
      apiClient.put(`/api/work-items/${workItemId}/recurrence`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurrenceKeys.rule(workItemId) });
      queryClient.invalidateQueries({ queryKey: recurrenceKeys.instances(workItemId) });
    },
  });
}

/** Remove recurrence from a work item. */
export function useDeleteRecurrence(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiClient.delete(`/api/work-items/${workItemId}/recurrence`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recurrenceKeys.rule(workItemId) });
      queryClient.invalidateQueries({ queryKey: recurrenceKeys.instances(workItemId) });
    },
  });
}
