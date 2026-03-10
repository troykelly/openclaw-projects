/**
 * TanStack Query hooks for work item file attachments.
 *
 * Issue #1708: File attachments integration.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

/** File attachment from the API. */
export interface FileAttachment {
  id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

/** API response for attachments list. */
export interface AttachmentsResponse {
  attachments: FileAttachment[];
}

/** Query key factory for attachments. */
export const attachmentKeys = {
  all: ['attachments'] as const,
  forWorkItem: (workItemId: string) => [...attachmentKeys.all, 'work-item', workItemId] as const,
};

/** Fetch file attachments for a work item. */
export function useWorkItemAttachments(workItemId: string) {
  const queryKey = useNamespaceQueryKey(attachmentKeys.forWorkItem(workItemId));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<AttachmentsResponse>(`/work-items/${workItemId}/attachments`, { signal }),
    enabled: !!workItemId,
  });
}
