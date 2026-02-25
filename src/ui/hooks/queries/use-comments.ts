/**
 * TanStack Query hooks for work item comments.
 *
 * Issue #1707: Comments/discussions integration.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { Comment } from '@/ui/components/comments/types';

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
  return useQuery({
    queryKey: commentKeys.forWorkItem(workItemId),
    queryFn: ({ signal }) =>
      apiClient.get<CommentsResponse>(`/api/work-items/${workItemId}/comments`, { signal }),
    enabled: !!workItemId,
  });
}
