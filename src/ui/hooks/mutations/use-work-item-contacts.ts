/**
 * TanStack Query mutation hooks for work item <-> contact linking.
 *
 * Issue #1720: Work item - Contact cross-linking.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { workItemContactKeys } from '@/ui/hooks/queries/use-work-item-contacts.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

/** Valid relationship types for work item contact linking. */
export type ContactRelationshipType = 'owner' | 'assignee' | 'stakeholder' | 'reviewer';

/** Link a contact to a work item. */
export function useLinkContact(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: ({ contactId, relationship }: { contactId: string; relationship?: ContactRelationshipType }) =>
      apiClient.post(`/work-items/${workItemId}/contacts`, {
        contact_id: contactId,
        relationship: relationship || 'stakeholder',
      }),
    onSuccess: () => {
      nsInvalidate(workItemContactKeys.forWorkItem(workItemId));
    },
  });
}

/** Unlink a contact from a work item. */
export function useUnlinkContact(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (linkId: string) =>
      apiClient.delete(`/work-items/${workItemId}/contacts/${linkId}`),
    onSuccess: () => {
      nsInvalidate(workItemContactKeys.forWorkItem(workItemId));
    },
  });
}
