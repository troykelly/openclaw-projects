/**
 * TanStack Query mutation hooks for contacts (#1593).
 *
 * CRUD mutations for contacts, addresses, dates, endpoints, tags,
 * photo upload, merge, and import/export.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  Contact, CreateContactBody, UpdateContactBody,
  ContactAddress, ContactDate, ContactEndpoint,
  MergeResult, ImportResult,
} from '@/ui/lib/api-types.ts';
import { contactKeys } from '@/ui/hooks/queries/use-contacts.ts';

// ============================================================
// Contact CRUD
// ============================================================

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateContactBody) => apiClient.post<Contact>('/api/contacts', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export interface UpdateContactVariables {
  id: string;
  body: UpdateContactBody;
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: UpdateContactVariables) => apiClient.patch<Contact>(`/api/contacts/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

// ============================================================
// Address CRUD (#1583)
// ============================================================

export function useAddContactAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, ...body }: { contactId: string } & Partial<ContactAddress>) =>
      apiClient.post<ContactAddress>(`/api/contacts/${contactId}/addresses`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useUpdateContactAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, addressId, ...body }: { contactId: string; addressId: string } & Partial<ContactAddress>) =>
      apiClient.patch<ContactAddress>(`/api/contacts/${contactId}/addresses/${addressId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useDeleteContactAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, addressId }: { contactId: string; addressId: string }) =>
      apiClient.delete(`/api/contacts/${contactId}/addresses/${addressId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

// ============================================================
// Date CRUD (#1584)
// ============================================================

export function useAddContactDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, ...body }: { contactId: string; date_type?: string; label?: string; date_value: string }) =>
      apiClient.post<ContactDate>(`/api/contacts/${contactId}/dates`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useUpdateContactDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, dateId, ...body }: { contactId: string; dateId: string } & Partial<ContactDate>) =>
      apiClient.patch<ContactDate>(`/api/contacts/${contactId}/dates/${dateId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useDeleteContactDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, dateId }: { contactId: string; dateId: string }) =>
      apiClient.delete(`/api/contacts/${contactId}/dates/${dateId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

// ============================================================
// Endpoint Management (#1585)
// ============================================================

export function useAddContactEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, ...body }: { contactId: string; type: string; value: string; label?: string | null; is_primary?: boolean }) =>
      apiClient.post<ContactEndpoint>(`/api/contacts/${contactId}/endpoints`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useUpdateContactEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, endpointId, ...body }: { contactId: string; endpointId: string; label?: string | null; is_primary?: boolean; metadata?: Record<string, unknown> }) =>
      apiClient.patch<ContactEndpoint>(`/api/contacts/${contactId}/endpoints/${endpointId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useDeleteContactEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, endpointId }: { contactId: string; endpointId: string }) =>
      apiClient.delete(`/api/contacts/${contactId}/endpoints/${endpointId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

// ============================================================
// Tags (#1586)
// ============================================================

export function useAddContactTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, tags }: { contactId: string; tags: string[] }) =>
      apiClient.post(`/api/contacts/${contactId}/tags`, { tags }),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useRemoveContactTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, tag }: { contactId: string; tag: string }) =>
      apiClient.delete(`/api/contacts/${contactId}/tags/${encodeURIComponent(tag)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

// ============================================================
// Photo (#1587)
// ============================================================

export function useUploadContactPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, file }: { contactId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/contacts/${contactId}/photo`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Photo upload failed');
      return response.json() as Promise<{ photo_url: string; file_id: string }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useDeleteContactPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId }: { contactId: string }) =>
      apiClient.delete(`/api/contacts/${contactId}/photo`),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

// ============================================================
// Merge (#1588)
// ============================================================

export function useMergeContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { survivor_id: string; loser_id: string }) =>
      apiClient.post<MergeResult>('/api/contacts/merge', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

// ============================================================
// Import (#1589)
// ============================================================

export function useImportContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { contacts: Array<Record<string, unknown>>; duplicate_handling?: string }) =>
      apiClient.post<ImportResult>('/api/contacts/import', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}
