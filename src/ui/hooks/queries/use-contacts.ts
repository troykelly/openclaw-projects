/**
 * TanStack Query hooks for contacts (#1593).
 *
 * Provides queries for contacts list, detail with eager loading,
 * and global tag listing.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { contactsResponseSchema, tagCountArraySchema } from '@/ui/lib/api-schemas.ts';
import type { Contact, ContactsResponse, TagCount } from '@/ui/lib/api-types.ts';

/** Query key factory for contacts. */
export const contactKeys = {
  all: ['contacts'] as const,
  lists: () => [...contactKeys.all, 'list'] as const,
  list: (search?: string) => [...contactKeys.lists(), search] as const,
  detail: (id: string) => [...contactKeys.all, 'detail', id] as const,
  detailIncludes: (id: string, include?: string) => [...contactKeys.detail(id), include] as const,
  tags: () => [...contactKeys.all, 'tags'] as const,
};

/**
 * Fetch the contacts list with optional search filtering.
 */
export function useContacts(search?: string) {
  const queryString = search ? `?search=${encodeURIComponent(search)}` : '';

  return useQuery({
    queryKey: contactKeys.list(search),
    queryFn: ({ signal }) => apiClient.get<ContactsResponse>(`/api/contacts${queryString}`, { signal, schema: contactsResponseSchema }),
  });
}

/**
 * Fetch a single contact by ID with optional eager loading (#1582).
 *
 * @param id - The contact UUID
 * @param include - Comma-separated list: endpoints,addresses,dates,tags,relationships
 */
export function useContactDetail(id: string, include?: string) {
  const params = new URLSearchParams();
  if (include) params.set('include', include);
  const qs = params.toString();
  const url = `/api/contacts/${id}${qs ? `?${qs}` : ''}`;

  return useQuery({
    queryKey: include ? contactKeys.detailIncludes(id, include) : contactKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<Contact>(url, { signal }),
    enabled: !!id,
  });
}

/**
 * Fetch all tags with contact counts (for tag picker).
 */
export function useContactTags() {
  return useQuery({
    queryKey: contactKeys.tags(),
    queryFn: ({ signal }) => apiClient.get<TagCount[]>('/api/tags', { signal, schema: tagCountArraySchema }),
  });
}
