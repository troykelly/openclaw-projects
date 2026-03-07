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
  return useQuery({
    queryKey: symphonyKeys.status(),
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

  return useQuery({
    queryKey: symphonyKeys.queue(filters),
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
  return useQuery({
    queryKey: symphonyKeys.hosts(),
    queryFn: ({ signal }) =>
      apiClient.get<SymphonyDashboardHostsResponse>('/symphony/dashboard/hosts', { signal }),
    refetchInterval: 15000,
  });
}

/** Fetch dashboard health. */
export function useSymphonyHealth() {
  return useQuery({
    queryKey: symphonyKeys.health(),
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
  return useQuery({
    queryKey: symphonyKeys.run(id),
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
  return useQuery({
    queryKey: symphonyKeys.config(projectId),
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
  return useQuery({
    queryKey: symphonyKeys.repos(projectId),
    queryFn: ({ signal }) =>
      apiClient.get<{ data: SymphonyRepo[] }>(`/symphony/config/${projectId}/repos`, { signal }),
    enabled: !!projectId,
  });
}

/** Fetch hosts for a project. */
export function useSymphonyProjectHosts(projectId: string) {
  return useQuery({
    queryKey: symphonyKeys.projectHosts(projectId),
    queryFn: ({ signal }) =>
      apiClient.get<{ data: SymphonyHost[] }>(`/symphony/config/${projectId}/hosts`, { signal }),
    enabled: !!projectId,
  });
}

/** Fetch tool configs. */
export function useSymphonyTools() {
  return useQuery({
    queryKey: symphonyKeys.tools(),
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
