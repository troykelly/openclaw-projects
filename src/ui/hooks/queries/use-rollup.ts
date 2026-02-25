/**
 * TanStack Query hook for work item rollup/aggregation.
 *
 * Issue #1718: Rollup/aggregation display.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';

/** Rollup data from the API. */
export interface WorkItemRollup {
  total_children: number;
  by_status: Record<string, number>;
  total_estimate_minutes: number;
  completed_estimate_minutes: number;
  progress_pct: number;
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
