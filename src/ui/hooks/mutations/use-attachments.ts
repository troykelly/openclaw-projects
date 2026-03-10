/**
 * TanStack Query mutation hooks for work item file attachments.
 *
 * Issue #1708: File attachments integration.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { attachmentKeys } from '@/ui/hooks/queries/use-attachments.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

/** Delete a file attachment. */
export function useDeleteAttachment(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (attachmentId: string) =>
      apiClient.delete(`/work-items/${workItemId}/attachments/${attachmentId}`),
    onSuccess: () => {
      nsInvalidate(attachmentKeys.forWorkItem(workItemId));
    },
  });
}
