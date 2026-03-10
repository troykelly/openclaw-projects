/**
 * TanStack Query hooks for namespace management (Issue #2353).
 *
 * Provides queries for listing namespaces and fetching namespace
 * detail with grants (members).
 */
import { useQuery } from '@tanstack/react-query';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';
import { apiClient } from '@/ui/lib/api-client';

/** Response shape for GET /namespaces. */
export interface NamespaceListItem {
  namespace: string;
  access: string;
  is_home: boolean;
  member_count: number;
  created_at: string;
}

/** Response shape for GET /namespaces/:ns. */
export interface NamespaceDetail {
  namespace: string;
  created_at: string;
  grants: NamespaceGrantEntry[];
}

/** A single grant entry within namespace detail. */
export interface NamespaceGrantEntry {
  id: string;
  user_email: string;
  access: string;
  is_home: boolean;
  created_at: string;
}

/** Query key factory for namespace management. */
export const namespaceKeys = {
  all: ['namespaces'] as const,
  list: () => [...namespaceKeys.all, 'list'] as const,
  detail: (ns: string) => [...namespaceKeys.all, 'detail', ns] as const,
  grants: (ns: string) => [...namespaceKeys.all, 'grants', ns] as const,
};

/**
 * Fetch the list of namespaces the user has access to.
 */
export function useNamespaceList() {
  const queryKey = useNamespaceQueryKey(namespaceKeys.list());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<{ data: NamespaceListItem[] }>('/namespaces', { signal }),
  });
}

/**
 * Fetch namespace detail including grants (members).
 */
export function useNamespaceDetail(ns: string) {
  const queryKey = useNamespaceQueryKey(namespaceKeys.detail(ns));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<{ data: NamespaceDetail }>(`/namespaces/${encodeURIComponent(ns)}`, { signal }),
    enabled: !!ns,
  });
}
