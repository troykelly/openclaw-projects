/**
 * TanStack Query mutations for Symphony orchestration (Epic #2186).
 *
 * Provides mutations for queue reorder, config updates, repo/host management.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { symphonyKeys } from '@/ui/hooks/queries/use-symphony.ts';
import type { SymphonyConfig } from '@/ui/lib/api-types.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

/** Reorder the run queue. */
export function useReorderQueue() {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (runIds: string[]) =>
      apiClient.post('/symphony/dashboard/queue/reorder', { run_ids: runIds }),
    onSuccess: () => {
      nsInvalidate(symphonyKeys.queue());
    },
  });
}

/** Update project symphony config. */
export function useUpdateSymphonyConfig(projectId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      apiClient.put<{ data: SymphonyConfig }>(`/symphony/config/${projectId}`, { config }),
    onSuccess: () => {
      nsInvalidate(symphonyKeys.config(projectId));
    },
  });
}

/** Add a repo to a project. */
export function useAddRepo(projectId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: { org: string; repo: string; default_branch?: string; sync_strategy?: string }) =>
      apiClient.post(`/symphony/projects/${projectId}/repos`, body),
    onSuccess: () => {
      nsInvalidate(symphonyKeys.repos(projectId));
    },
  });
}

/** Remove a repo from a project. */
export function useRemoveRepo(projectId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (repoId: string) =>
      apiClient.delete(`/symphony/projects/${projectId}/repos/${repoId}`),
    onSuccess: () => {
      nsInvalidate(symphonyKeys.repos(projectId));
    },
  });
}

/** Add a host to a project. */
export function useAddHost(projectId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: { connection_id: string; priority?: number; max_concurrent_sessions?: number }) =>
      apiClient.post(`/symphony/projects/${projectId}/hosts`, body),
    onSuccess: () => {
      nsInvalidate(symphonyKeys.projectHosts(projectId));
    },
  });
}

/** Drain a host. */
export function useDrainHost(projectId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (hostId: string) =>
      apiClient.post(`/symphony/projects/${projectId}/hosts/${hostId}/drain`, {}),
    onSuccess: () => {
      nsInvalidate(symphonyKeys.projectHosts(projectId));
      nsInvalidate(symphonyKeys.hosts());
    },
  });
}

/** Activate a host. */
export function useActivateHost(projectId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (hostId: string) =>
      apiClient.post(`/symphony/projects/${projectId}/hosts/${hostId}/activate`, {}),
    onSuccess: () => {
      nsInvalidate(symphonyKeys.projectHosts(projectId));
      nsInvalidate(symphonyKeys.hosts());
    },
  });
}
