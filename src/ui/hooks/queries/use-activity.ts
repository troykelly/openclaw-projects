/**
 * TanStack Query hook for the activity feed.
 *
 * Fetches recent activity items from GET /api/activity.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { ActivityResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for activity. */
export const activityKeys = {
  all: ['activity'] as const,
  list: (limit?: number) => [...activityKeys.all, 'list', limit] as const,
};

/**
 * Fetch the activity feed.
 *
 * @param limit - Maximum number of items (default 50)
 * @returns TanStack Query result with `ActivityResponse`
 */
export function useActivity(limit = 50) {
  return useQuery({
    queryKey: activityKeys.list(limit),
    queryFn: ({ signal }) => apiClient.get<ActivityResponse>(`/api/activity?limit=${limit}`, { signal }),
  });
}
