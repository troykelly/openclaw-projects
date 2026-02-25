/**
 * TanStack Query mutation hooks for work item comments.
 *
 * Issue #1707: Comments/discussions integration.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { commentKeys } from '@/ui/hooks/queries/use-comments.ts';

/** Add a new comment to a work item. */
export function useAddComment(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { content: string; parent_id?: string }) =>
      apiClient.post(`/api/work-items/${workItemId}/comments`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.forWorkItem(workItemId) });
    },
  });
}

/** Edit an existing comment. */
export function useEditComment(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      apiClient.put(`/api/work-items/${workItemId}/comments/${commentId}`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.forWorkItem(workItemId) });
    },
  });
}

/** Delete a comment. */
export function useDeleteComment(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) =>
      apiClient.delete(`/api/work-items/${workItemId}/comments/${commentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.forWorkItem(workItemId) });
    },
  });
}

/** Add a reaction to a comment. */
export function useAddReaction(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) =>
      apiClient.post(`/api/work-items/${workItemId}/comments/${commentId}/reactions`, { emoji }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.forWorkItem(workItemId) });
    },
  });
}
