/**
 * TanStack Query hooks for contacts.
 *
 * Provides queries for the contacts list (with optional search) and
 * individual contact detail by ID.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { Contact, ContactsResponse } from '@/ui/lib/api-types.ts';

/** Query key factory for contacts. */
export const contactKeys = {
  all: ['contacts'] as const,
  lists: () => [...contactKeys.all, 'list'] as const,
  list: (search?: string) => [...contactKeys.lists(), search] as const,
  detail: (id: string) => [...contactKeys.all, 'detail', id] as const,
};

/**
 * Fetch the contacts list with optional search filtering.
 *
 * @param search - Optional search term
 * @returns TanStack Query result with `ContactsResponse`
 */
export function useContacts(search?: string) {
  const queryString = search ? `?search=${encodeURIComponent(search)}` : '';

  return useQuery({
    queryKey: contactKeys.list(search),
    queryFn: ({ signal }) => apiClient.get<ContactsResponse>(`/api/contacts${queryString}`, { signal }),
  });
}

/**
 * Fetch a single contact by ID.
 *
 * @param id - The contact UUID
 * @returns TanStack Query result with `Contact`
 */
export function useContactDetail(id: string) {
  return useQuery({
    queryKey: contactKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<Contact>(`/api/contacts/${id}`, { signal }),
    enabled: !!id,
  });
}
