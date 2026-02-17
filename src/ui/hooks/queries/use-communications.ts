/**
 * TanStack Query hook for work item communications.
 *
 * Fetches linked emails and calendar events for a specific work item.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { CommunicationsResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for communications. */
export const communicationsKeys = {
  all: ['communications'] as const,
  forWorkItem: (work_item_id: string) => [...communicationsKeys.all, 'work-item', work_item_id] as const,
};

/**
 * Fetch communications linked to a work item.
 *
 * @param work_item_id - The work item UUID
 * @returns TanStack Query result with `CommunicationsResponse`
 */
export function useWorkItemCommunications(work_item_id: string) {
  return useQuery({
    queryKey: communicationsKeys.forWorkItem(work_item_id),
    queryFn: ({ signal }) => apiClient.get<CommunicationsResponse>(`/api/work-items/${work_item_id}/communications`, { signal }),
    enabled: !!work_item_id,
  });
}
