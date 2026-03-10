/**
 * TanStack Query hook for fetching todos belonging to a work item.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

export interface Todo {
  id: string;
  text: string;
  completed: boolean;
  sort_order: number;
  not_before?: string | null;
  not_after?: string | null;
  priority?: string;
  created_at: string;
  completed_at?: string | null;
  updated_at: string;
}

export interface TodosResponse {
  todos: Todo[];
}

/** Query key factory for todos. */
export const todoKeys = {
  all: ['todos'] as const,
  list: (workItemId: string) => ['todos', workItemId] as const,
};

/**
 * Fetch todos for a work item.
 */
export function useTodos(workItemId: string) {
  const queryKey = useNamespaceQueryKey(todoKeys.list(workItemId));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<TodosResponse>(`/work-items/${workItemId}/todos`, { signal }),
    enabled: !!workItemId,
  });
}
