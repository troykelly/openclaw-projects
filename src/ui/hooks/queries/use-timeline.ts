/**
 * TanStack Query hooks for timeline data.
 *
 * Provides queries for item-specific and global timeline views.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TimelineResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for timelines. */
export const timelineKeys = {
  all: ['timeline'] as const,
  item: (id: string) => [...timelineKeys.all, 'item', id] as const,
  global: (kindFilter?: string[]) => [...timelineKeys.all, 'global', kindFilter] as const,
};

/**
 * Fetch timeline data for a specific work item.
 *
 * @param id - Work item UUID
 * @returns TanStack Query result with `TimelineResponse`
 */
export function useItemTimeline(id: string) {
  return useQuery({
    queryKey: timelineKeys.item(id),
    queryFn: ({ signal }) =>
      apiClient.get<TimelineResponse>(`/api/work-items/${id}/timeline`, { signal }),
    enabled: !!id,
  });
}

/**
 * Fetch the global timeline with optional kind filtering.
 *
 * @param kindFilter - Optional array of kinds to include (e.g. ['project', 'epic'])
 * @returns TanStack Query result with `TimelineResponse`
 */
export function useGlobalTimeline(kindFilter?: string[]) {
  const params = kindFilter && kindFilter.length > 0
    ? `?kind=${kindFilter.join(',')}`
    : '';

  return useQuery({
    queryKey: timelineKeys.global(kindFilter),
    queryFn: ({ signal }) =>
      apiClient.get<TimelineResponse>(`/api/timeline${params}`, { signal }),
  });
}
