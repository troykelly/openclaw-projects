/**
 * TanStack Query hook for fuzzy contact matching (Issue #1270).
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { ContactSuggestMatchResponse } from '@/ui/lib/api-types.ts';

export const contactSuggestMatchKeys = {
  all: ['contact-suggest-match'] as const,
  suggest: (params: { phone?: string; email?: string; name?: string }) =>
    [...contactSuggestMatchKeys.all, params] as const,
};

interface SuggestMatchParams {
  phone?: string;
  email?: string;
  name?: string;
}

/** Fetch fuzzy contact match suggestions based on phone/email/name signals. */
export function useContactSuggestMatch(params: SuggestMatchParams) {
  const hasParams = !!(params.phone || params.email || params.name);

  return useQuery({
    queryKey: contactSuggestMatchKeys.suggest(params),
    queryFn: ({ signal }) => {
      const searchParams = new URLSearchParams();
      if (params.phone) searchParams.set('phone', params.phone);
      if (params.email) searchParams.set('email', params.email);
      if (params.name) searchParams.set('name', params.name);

      return apiClient.get<ContactSuggestMatchResponse>(`/api/contacts/suggest-match?${searchParams.toString()}`, {
        signal,
      });
    },
    enabled: hasParams,
  });
}
