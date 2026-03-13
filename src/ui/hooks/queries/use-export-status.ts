/**
 * TanStack Query hook for polling export status (#2479).
 *
 * Polls the export status endpoint at a configurable interval,
 * stopping when the export reaches a terminal state.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { ExportResponse, ExportStatus } from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

/** Default polling interval (2 seconds). */
const POLL_INTERVAL_MS = 2000;

/** Terminal states — stop polling once reached. */
const TERMINAL_STATES: ExportStatus[] = ['ready', 'failed', 'expired'];

/** Query key factory for exports. */
export const exportKeys = {
  all: ['exports'] as const,
  details: () => [...exportKeys.all, 'detail'] as const,
  detail: (id: string) => [...exportKeys.details(), id] as const,
};

/**
 * Poll export status by ID.
 *
 * Fetches `/exports/:id` at the configured interval until the export
 * reaches a terminal state (ready, failed, expired).
 *
 * @param exportId - Export UUID, or null to disable the query
 * @param options - Optional configuration
 */
export function useExportStatus(
  exportId: string | null,
  options?: { pollInterval?: number },
) {
  const pollInterval = options?.pollInterval ?? POLL_INTERVAL_MS;
  const queryKey = useNamespaceQueryKey(exportKeys.detail(exportId ?? ''));

  return useQuery<ExportResponse>({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<ExportResponse>(`/exports/${encodeURIComponent(exportId!)}`, { signal }),
    enabled: !!exportId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && TERMINAL_STATES.includes(data.status)) {
        return false;
      }
      return pollInterval;
    },
    staleTime: 0,
  });
}
