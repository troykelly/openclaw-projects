/**
 * TanStack Query hooks for work item recurrence.
 *
 * Issue #1710: Recurring tasks.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';

/** Recurrence rule from the API. */
export interface RecurrenceRule {
  recurrence_rule: string | null;
  recurrence_natural: string | null;
}

/** Instance of a recurring work item. */
export interface RecurrenceInstance {
  id: string;
  title: string;
  status: string;
  not_before: string | null;
  created_at: string;
}

/** API response for recurrence instances. */
export interface RecurrenceInstancesResponse {
  instances: RecurrenceInstance[];
}

/** Query key factory for recurrence. */
export const recurrenceKeys = {
  all: ['recurrence'] as const,
  rule: (workItemId: string) => [...recurrenceKeys.all, 'rule', workItemId] as const,
  instances: (workItemId: string) => [...recurrenceKeys.all, 'instances', workItemId] as const,
};

/** Fetch recurrence rule for a work item. */
export function useRecurrenceRule(workItemId: string) {
  return useQuery({
    queryKey: recurrenceKeys.rule(workItemId),
    queryFn: ({ signal }) =>
      apiClient.get<RecurrenceRule>(`/api/work-items/${workItemId}/recurrence`, { signal }),
    enabled: !!workItemId,
  });
}

/** Fetch instances of a recurring work item. */
export function useRecurrenceInstances(workItemId: string) {
  return useQuery({
    queryKey: recurrenceKeys.instances(workItemId),
    queryFn: ({ signal }) =>
      apiClient.get<RecurrenceInstancesResponse>(`/api/work-items/${workItemId}/instances`, { signal }),
    enabled: !!workItemId,
  });
}
