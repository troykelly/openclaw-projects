/**
 * TanStack Query hooks for work item <-> contact linking.
 *
 * Issue #1720: Work item - Contact cross-linking.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { Contact } from '@/ui/lib/api-types.ts';

/** Linked contact from the API. Server returns contact_id as the identifier. */
export interface LinkedContact {
  contact_id: string;
  display_name: string | null;
  relationship: string | null;
  created_at: string;
}

/** API response for linked contacts. */
export interface WorkItemContactsResponse {
  contacts: LinkedContact[];
}

/** Work item summary from contact link. */
export interface LinkedWorkItem {
  id: string;
  work_item_id: string;
  title: string;
  status: string;
  kind: string;
}

/** API response for contact work items. */
export interface ContactWorkItemsResponse {
  work_items: LinkedWorkItem[];
}

/** Query key factory for work item contacts. */
export const workItemContactKeys = {
  all: ['work-item-contacts'] as const,
  forWorkItem: (workItemId: string) => [...workItemContactKeys.all, 'work-item', workItemId] as const,
  forContact: (contactId: string) => [...workItemContactKeys.all, 'contact', contactId] as const,
};

/** Fetch linked contacts for a work item. */
export function useWorkItemContacts(workItemId: string) {
  return useQuery({
    queryKey: workItemContactKeys.forWorkItem(workItemId),
    queryFn: ({ signal }) =>
      apiClient.get<WorkItemContactsResponse>(`/api/work-items/${workItemId}/contacts`, { signal }),
    enabled: !!workItemId,
  });
}

/** Fetch linked work items for a contact. */
export function useContactWorkItems(contactId: string) {
  return useQuery({
    queryKey: workItemContactKeys.forContact(contactId),
    queryFn: ({ signal }) =>
      apiClient.get<ContactWorkItemsResponse>(`/api/contacts/${contactId}/work-items`, { signal }),
    enabled: !!contactId,
  });
}
