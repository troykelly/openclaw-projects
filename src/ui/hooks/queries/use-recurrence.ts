/**
 * TanStack Query hooks for work item recurrence.
 *
 * Issue #1710: Recurring tasks.
 * Issue #1839: Fixed to match actual API response shapes.
 *
 * GET /api/work-items/:id/recurrence returns:
 *   { rule, rule_description, end, parent_id, is_template, next_occurrence }
 *
 * GET /api/work-items/:id/instances returns:
 *   { instances: [{ id, title, status, scheduled_date, created_at, completed_at }], count }
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';

/** Recurrence rule from the API — matches actual server response. */
export interface RecurrenceRule {
  rule: string;
  rule_description: string | null;
  end: string | null;
  parent_id: string | null;
  is_template: boolean;
  next_occurrence: string | null;
}

/** Instance of a recurring work item — matches actual server response. */
export interface RecurrenceInstance {
  id: string;
  title: string;
  status: string;
  scheduled_date: string | null;
  created_at: string;
  completed_at: string | null;
}

/** API response for recurrence instances. */
export interface RecurrenceInstancesResponse {
  instances: RecurrenceInstance[];
  count: number;
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
