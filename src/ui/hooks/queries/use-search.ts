/**
 * TanStack Query hook for search data fetching.
 *
 * Provides a cached, deduplicated query for the global search API.
 * The query is disabled when the search string is empty.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { SearchResponse } from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

/** Query key factory for search. */
export const searchKeys = {
  all: ['search'] as const,
  query: (q: string, types?: string[]) => [...searchKeys.all, q, types] as const,
};

/**
 * Fetch search results from the API.
 *
 * @param query - The search query string
 * @param types - Optional array of result types to filter by (e.g. ['work_item', 'contact'])
 * @returns TanStack Query result with `SearchResponse`
 */
export function useSearch(query: string, types?: string[]) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (types?.length) params.set('types', types.join(','));

  const queryKey = useNamespaceQueryKey(searchKeys.query(query, types));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<SearchResponse>(`/search?${params.toString()}`, { signal }),
    enabled: query.length > 0,
  });
}
