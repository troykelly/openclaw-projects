/**
 * TanStack Query hook for work item rollup/aggregation.
 *
 * Issue #1718: Rollup/aggregation display.
 * Issue #1839: Fixed to match actual API response shape.
 *
 * The GET /api/work-items/:id/rollup endpoint returns:
 *   { work_item_id, total_estimate_minutes, total_actual_minutes }
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';

/** Rollup data from the API — matches actual server response. */
export interface WorkItemRollup {
  work_item_id: string;
  total_estimate_minutes: number | null;
  total_actual_minutes: number | null;
}

/** Query key factory for rollup. */
export const rollupKeys = {
  all: ['rollup'] as const,
  forWorkItem: (workItemId: string) => [...rollupKeys.all, workItemId] as const,
};

/** Fetch rollup/aggregation for a work item. */
export function useWorkItemRollup(workItemId: string) {
  return useQuery({
    queryKey: rollupKeys.forWorkItem(workItemId),
    queryFn: ({ signal }) =>
      apiClient.get<WorkItemRollup>(`/api/work-items/${workItemId}/rollup`, { signal }),
    enabled: !!workItemId,
  });
}
