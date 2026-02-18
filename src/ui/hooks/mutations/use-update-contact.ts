/**
 * TanStack Query mutation hook for updating contacts.
 *
 * Updates a contact by ID and invalidates the contacts query cache.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { ContactBody, Contact } from '@/ui/lib/api-types.ts';
import { contactKeys } from '@/ui/hooks/queries/use-contacts.ts';

/** Variables for the update contact mutation. */
export interface UpdateContactVariables {
  /** The contact ID to update. */
  id: string;
  /** Update body. */
  body: ContactBody;
}

/**
 * Update an existing contact.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useUpdateContact();
 * mutate({ id: 'contact-1', body: { display_name: 'Jane Doe' } });
 * ```
 */
export function useUpdateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: UpdateContactVariables) => apiClient.patch<Contact>(`/api/contacts/${id}`, body),

    onSuccess: () => {
      // Invalidate all contact queries to refresh lists
      queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}
