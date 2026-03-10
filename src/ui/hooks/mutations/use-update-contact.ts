/**
 * TanStack Query mutation hooks for contacts (#1593).
 *
 * CRUD mutations for contacts, addresses, dates, endpoints, tags,
 * photo upload, merge, and import/export.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  Contact, CreateContactBody, UpdateContactBody,
  ContactAddress, ContactDate, ContactEndpoint,
  MergeResult, ImportResult,
} from '@/ui/lib/api-types.ts';
import { contactKeys } from '@/ui/hooks/queries/use-contacts.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

// ============================================================
// Contact CRUD
// ============================================================

export function useCreateContact() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: (body: CreateContactBody) => apiClient.post<Contact>('/contacts', body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

export interface UpdateContactVariables {
  id: string;
  body: UpdateContactBody;
}

export function useUpdateContact() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: UpdateContactVariables) => apiClient.patch<Contact>(`/contacts/${id}`, body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

// ============================================================
// Address CRUD (#1583)
// ============================================================

export function useAddContactAddress() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, ...body }: { contactId: string } & Partial<ContactAddress>) =>
      apiClient.post<ContactAddress>(`/contacts/${contactId}/addresses`, body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

export function useUpdateContactAddress() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, addressId, ...body }: { contactId: string; addressId: string } & Partial<ContactAddress>) =>
      apiClient.patch<ContactAddress>(`/contacts/${contactId}/addresses/${addressId}`, body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

export function useDeleteContactAddress() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, addressId }: { contactId: string; addressId: string }) =>
      apiClient.delete(`/contacts/${contactId}/addresses/${addressId}`),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

// ============================================================
// Date CRUD (#1584)
// ============================================================

export function useAddContactDate() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, ...body }: { contactId: string; date_type?: string; label?: string; date_value: string }) =>
      apiClient.post<ContactDate>(`/contacts/${contactId}/dates`, body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

export function useUpdateContactDate() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, dateId, ...body }: { contactId: string; dateId: string } & Partial<ContactDate>) =>
      apiClient.patch<ContactDate>(`/contacts/${contactId}/dates/${dateId}`, body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

export function useDeleteContactDate() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, dateId }: { contactId: string; dateId: string }) =>
      apiClient.delete(`/contacts/${contactId}/dates/${dateId}`),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

// ============================================================
// Endpoint Management (#1585)
// ============================================================

export function useAddContactEndpoint() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, ...body }: { contactId: string; type: string; value: string; label?: string | null; is_primary?: boolean }) =>
      apiClient.post<ContactEndpoint>(`/contacts/${contactId}/endpoints`, body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

export function useUpdateContactEndpoint() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, endpointId, ...body }: { contactId: string; endpointId: string; label?: string | null; is_primary?: boolean; metadata?: Record<string, unknown> }) =>
      apiClient.patch<ContactEndpoint>(`/contacts/${contactId}/endpoints/${endpointId}`, body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

export function useDeleteContactEndpoint() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, endpointId }: { contactId: string; endpointId: string }) =>
      apiClient.delete(`/contacts/${contactId}/endpoints/${endpointId}`),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

// ============================================================
// Tags (#1586)
// ============================================================

export function useAddContactTags() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, tags }: { contactId: string; tags: string[] }) =>
      apiClient.post(`/contacts/${contactId}/tags`, { tags }),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

export function useRemoveContactTag() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId, tag }: { contactId: string; tag: string }) =>
      apiClient.delete(`/contacts/${contactId}/tags/${encodeURIComponent(tag)}`),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

// ============================================================
// Photo (#1587)
// ============================================================

export function useUploadContactPhoto() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: async ({ contactId, file }: { contactId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/contacts/${contactId}/photo`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Photo upload failed');
      return response.json() as Promise<{ photo_url: string; file_id: string }>;
    },
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

export function useDeleteContactPhoto() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: ({ contactId }: { contactId: string }) =>
      apiClient.delete(`/contacts/${contactId}/photo`),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

// ============================================================
// Merge (#1588)
// ============================================================

export function useMergeContacts() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: (body: { survivor_id: string; loser_id: string }) =>
      apiClient.post<MergeResult>('/contacts/merge', body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}

// ============================================================
// Import (#1589)
// ============================================================

export function useImportContacts() {
  const nsInvalidate = useNamespaceInvalidate();
  return useMutation({
    mutationFn: (body: { contacts: Array<Record<string, unknown>>; duplicate_handling?: string }) =>
      apiClient.post<ImportResult>('/contacts/import', body),
    onSuccess: () => nsInvalidate(contactKeys.all),
  });
}
