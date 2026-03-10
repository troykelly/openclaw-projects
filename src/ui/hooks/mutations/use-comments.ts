/**
 * TanStack Query mutation hooks for work item comments.
 *
 * Issue #1707: Comments/discussions integration.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { commentKeys } from '@/ui/hooks/queries/use-comments.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

/** Add a new comment to a work item. */
export function useAddComment(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: { content: string; parent_id?: string }) =>
      apiClient.post(`/work-items/${workItemId}/comments`, body),
    onSuccess: () => {
      nsInvalidate(commentKeys.forWorkItem(workItemId));
    },
  });
}

/** Edit an existing comment. */
export function useEditComment(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      apiClient.put(`/work-items/${workItemId}/comments/${commentId}`, { content }),
    onSuccess: () => {
      nsInvalidate(commentKeys.forWorkItem(workItemId));
    },
  });
}

/** Delete a comment. */
export function useDeleteComment(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (commentId: string) =>
      apiClient.delete(`/work-items/${workItemId}/comments/${commentId}`),
    onSuccess: () => {
      nsInvalidate(commentKeys.forWorkItem(workItemId));
    },
  });
}

/** Add a reaction to a comment. */
export function useAddReaction(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) =>
      apiClient.post(`/work-items/${workItemId}/comments/${commentId}/reactions`, { emoji }),
    onSuccess: () => {
      nsInvalidate(commentKeys.forWorkItem(workItemId));
    },
  });
}
