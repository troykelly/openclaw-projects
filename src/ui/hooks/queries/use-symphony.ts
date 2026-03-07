/**
 * TanStack Query hooks for Symphony orchestration data.
 * Epic #2186, Issue #2211
 *
 * Provides queries for fetching Symphony runs, config, and
 * a capability hook to gate Symphony UI elements.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  SymphonyRunsResponse,
  SymphonyConfigResponse,
} from '@/ui/lib/api-types.ts';

/** Query key factory for Symphony data. */
export const symphonyKeys = {
  all: ['symphony'] as const,
  runs: (filters?: { project_id?: string; work_item_id?: string; status?: string }) =>
    [...symphonyKeys.all, 'runs', filters] as const,
  config: (project_id: string) => [...symphonyKeys.all, 'config', project_id] as const,
};

/**
 * Hook to check if Symphony is enabled for a project.
 * Returns the config if found, or null if Symphony is not configured.
 * Does not throw on 404 — treats it as "not enabled".
 */
export function useSymphonyConfig(project_id: string) {
  return useQuery({
    queryKey: symphonyKeys.config(project_id),
    queryFn: async ({ signal }) => {
      try {
        return await apiClient.get<SymphonyConfigResponse>(
          `/symphony/config/${project_id}`,
          { signal },
        );
      } catch (err: unknown) {
        // 404 means Symphony not configured for this project
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
          return null;
        }
        throw err;
      }
    },
    enabled: !!project_id,
  });
}

/**
 * Fetch Symphony runs for a project or work item.
 */
export function useSymphonyRuns(filters?: {
  project_id?: string;
  work_item_id?: string;
  status?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.project_id) params.set('project_id', filters.project_id);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();

  // work_item_id filter is client-side since the API doesn't support it directly
  const workItemId = filters?.work_item_id;

  return useQuery({
    queryKey: symphonyKeys.runs(filters),
    queryFn: async ({ signal }) => {
      const response = await apiClient.get<SymphonyRunsResponse>(
        `/symphony/runs${qs ? `?${qs}` : ''}`,
        { signal },
      );
      // Client-side filter by work_item_id if provided
      if (workItemId && Array.isArray(response.data)) {
        return {
          ...response,
          data: response.data.filter((r) => r.work_item_id === workItemId),
        };
      }
      return response;
    },
    enabled: !!(filters?.project_id || filters?.work_item_id),
  });
}

/** Terminal statuses for Symphony runs. */
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

/** Check if a run status is terminal. */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Check if a run is actively in progress. */
export function isActiveRun(status: string): boolean {
  return !TERMINAL_STATUSES.has(status);
}
