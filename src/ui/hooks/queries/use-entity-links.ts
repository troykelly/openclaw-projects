/**
 * TanStack Query hooks for entity links (Issue #1276).
 *
 * Provides queries for fetching links from a source entity
 * or to a target entity.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { EntityLinksResponse } from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

/** Query key factory for entity links. */
export const entityLinkKeys = {
  all: ['entity-links'] as const,
  fromSource: (sourceType: string, sourceId: string) => [...entityLinkKeys.all, 'source', sourceType, sourceId] as const,
  toTarget: (targetType: string, targetId: string) => [...entityLinkKeys.all, 'target', targetType, targetId] as const,
};

/** Fetch entity links where the given entity is the source. */
export function useEntityLinksFromSource(sourceType: string, sourceId: string) {
  const queryKey = useNamespaceQueryKey(entityLinkKeys.fromSource(sourceType, sourceId));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<EntityLinksResponse>(`/entity-links?source_type=${sourceType}&source_id=${sourceId}`, { signal }),
    enabled: !!sourceId,
  });
}

/** Fetch entity links where the given entity is the target. */
export function useEntityLinksToTarget(targetType: string, targetId: string) {
  const queryKey = useNamespaceQueryKey(entityLinkKeys.toTarget(targetType, targetId));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<EntityLinksResponse>(`/entity-links?target_type=${targetType}&target_id=${targetId}`, { signal }),
    enabled: !!targetId,
  });
}
