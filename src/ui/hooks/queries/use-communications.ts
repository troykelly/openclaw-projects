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
  forWorkItem: (workItemId: string) =>
    [...communicationsKeys.all, 'work-item', workItemId] as const,
};

/**
 * Fetch communications linked to a work item.
 *
 * @param workItemId - The work item UUID
 * @returns TanStack Query result with `CommunicationsResponse`
 */
export function useWorkItemCommunications(workItemId: string) {
  return useQuery({
    queryKey: communicationsKeys.forWorkItem(workItemId),
    queryFn: ({ signal }) =>
      apiClient.get<CommunicationsResponse>(
        `/api/work-items/${workItemId}/communications`,
        { signal },
      ),
    enabled: !!workItemId,
  });
}
