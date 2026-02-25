/**
 * TanStack Query mutation hooks for work item file attachments.
 *
 * Issue #1708: File attachments integration.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { attachmentKeys } from '@/ui/hooks/queries/use-attachments.ts';

/** Delete a file attachment. */
export function useDeleteAttachment(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (attachmentId: string) =>
      apiClient.delete(`/api/work-items/${workItemId}/attachments/${attachmentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attachmentKeys.forWorkItem(workItemId) });
    },
  });
}
