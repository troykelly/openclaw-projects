/**
 * TanStack Query hooks for Symphony orchestration (Epic #2186).
 *
 * Provides queries for the Symphony dashboard, project config,
 * and capability hooks to gate Symphony UI elements.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  SymphonyDashboardStatus,
  SymphonyRunsResponse,
  SymphonyDashboardHostsResponse,
  SymphonyDashboardHealth,
  SymphonyConfig,
  SymphonyRepo,
  SymphonyHost,
  SymphonyToolConfig,
} from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

/** Query key factory for symphony data. */
export const symphonyKeys = {
  all: ['symphony'] as const,
  dashboard: () => [...symphonyKeys.all, 'dashboard'] as const,
  status: () => [...symphonyKeys.dashboard(), 'status'] as const,
  queue: (filters?: { limit?: number; offset?: number }) =>
    [...symphonyKeys.dashboard(), 'queue', filters] as const,
  hosts: () => [...symphonyKeys.dashboard(), 'hosts'] as const,
  health: () => [...symphonyKeys.dashboard(), 'health'] as const,
  runs: (filters?: { status?: string; project_id?: string; work_item_id?: string }) =>
    [...symphonyKeys.all, 'runs', filters] as const,
  run: (id: string) => [...symphonyKeys.all, 'run', id] as const,
  config: (projectId: string) => [...symphonyKeys.all, 'config', projectId] as const,
  repos: (projectId: string) => [...symphonyKeys.all, 'repos', projectId] as const,
  projectHosts: (projectId: string) => [...symphonyKeys.all, 'project-hosts', projectId] as const,
  tools: () => [...symphonyKeys.all, 'tools'] as const,
};

/** Fetch dashboard status summary. */
export function useSymphonyStatus() {
  const queryKey = useNamespaceQueryKey(symphonyKeys.status());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<SymphonyDashboardStatus>('/symphony/dashboard/status', { signal }),
    refetchInterval: 10000,
  });
}

/** Fetch dashboard queue (upcoming runs). */
export function useSymphonyQueue(filters?: { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  const qs = params.toString();

  const queryKey = useNamespaceQueryKey(symphonyKeys.queue(filters));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<SymphonyRunsResponse>(
        `/symphony/dashboard/queue${qs ? `?${qs}` : ''}`,
        { signal },
      ),
    refetchInterval: 10000,
  });
}

/** Fetch dashboard host statuses. */
export function useSymphonyHosts() {
  const queryKey = useNamespaceQueryKey(symphonyKeys.hosts());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<SymphonyDashboardHostsResponse>('/symphony/dashboard/hosts', { signal }),
    refetchInterval: 15000,
  });
}

/** Fetch dashboard health. */
export function useSymphonyHealth() {
  const queryKey = useNamespaceQueryKey(symphonyKeys.health());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<SymphonyDashboardHealth>('/symphony/dashboard/health', { signal }),
    refetchInterval: 15000,
  });
}

/** Fetch runs with optional filters (supports project_id, work_item_id, status). */
export function useSymphonyRuns(filters?: {
  status?: string;
  project_id?: string;
  work_item_id?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.project_id) params.set('project_id', filters.project_id);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();

  // work_item_id filter is client-side since the API doesn't support it directly
  const workItemId = filters?.work_item_id;

  const queryKey = useNamespaceQueryKey(symphonyKeys.runs(filters));
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await apiClient.get<SymphonyRunsResponse>(
        `/symphony/runs${qs ? `?${qs}` : ''}`,
        { signal },
      );
      // Client-side filter by work_item_id if provided
      if (workItemId && Array.isArray(response.data)) {
        return {
          ...response,
          data: response.data.filter((r: { work_item_id?: string | null }) => r.work_item_id === workItemId),
        };
      }
      return response;
    },
    refetchInterval: 10000,
    enabled: filters?.project_id != null || filters?.work_item_id != null,
  });
}

/** Fetch a single run by ID. */
export function useSymphonyRun(id: string) {
  const queryKey = useNamespaceQueryKey(symphonyKeys.run(id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<{ data: Record<string, unknown> }>(`/symphony/runs/${id}`, { signal }),
    enabled: !!id,
  });
}

/**
 * Fetch project symphony config.
 * Returns null on 404 (Symphony not configured for this project).
 */
export function useSymphonyConfig(projectId: string) {
  const queryKey = useNamespaceQueryKey(symphonyKeys.config(projectId));
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      try {
        return await apiClient.get<{ data: SymphonyConfig }>(`/symphony/config/${projectId}`, { signal });
      } catch (err: unknown) {
        // 404 means Symphony not configured for this project
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
          return null;
        }
        throw err;
      }
    },
    enabled: !!projectId,
  });
}

/** Fetch repos for a project. */
export function useSymphonyRepos(projectId: string) {
  const queryKey = useNamespaceQueryKey(symphonyKeys.repos(projectId));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<{ data: SymphonyRepo[] }>(`/symphony/projects/${projectId}/repos`, { signal }),
    enabled: !!projectId,
  });
}

/** Fetch hosts for a project. */
export function useSymphonyProjectHosts(projectId: string) {
  const queryKey = useNamespaceQueryKey(symphonyKeys.projectHosts(projectId));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<{ data: SymphonyHost[] }>(`/symphony/projects/${projectId}/hosts`, { signal }),
    enabled: !!projectId,
  });
}

/** Fetch tool configs. */
export function useSymphonyTools() {
  const queryKey = useNamespaceQueryKey(symphonyKeys.tools());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiClient.get<{ data: SymphonyToolConfig[] }>('/symphony/tools', { signal }),
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
