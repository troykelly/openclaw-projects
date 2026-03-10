/**
 * TanStack Query hooks for work item comments.
 *
 * Issue #1707: Comments/discussions integration.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { Comment } from '@/ui/components/comments/types';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

/** API response for comments list. */
export interface CommentsResponse {
  comments: Comment[];
}

/** Query key factory for comments. */
export const commentKeys = {
  all: ['comments'] as const,
  forWorkItem: (workItemId: string) => [...commentKeys.all, 'work-item', workItemId] as const,
};

/**
 * Fetch comments for a work item.
 *
 * @param workItemId - The work item UUID
 */
export function useWorkItemComments(workItemId: string) {
  const queryKey = useNamespaceQueryKey(commentKeys.forWorkItem(workItemId));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<CommentsResponse>(`/work-items/${workItemId}/comments`, { signal }),
    enabled: !!workItemId,
  });
}
