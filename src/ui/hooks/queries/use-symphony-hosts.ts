/**
 * TanStack Query hooks for Symphony host and tool management.
 *
 * Provides queries for listing hosts/tools and mutations for
 * host actions (drain/activate) and tool CRUD.
 *
 * Issue #2210 (Epic #2186)
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  SymphonyHost,
  SymphonyHostsResponse,
  SymphonyToolConfig,
  SymphonyToolsResponse,
  CreateSymphonyToolBody,
  UpdateSymphonyToolBody,
} from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

/** Query key factory for symphony hosts. */
export const symphonyHostKeys = {
  all: ['symphony-hosts'] as const,
  list: () => [...symphonyHostKeys.all, 'list'] as const,
  detail: (id: string) => [...symphonyHostKeys.all, 'detail', id] as const,
};

/** Query key factory for symphony tools. */
export const symphonyToolKeys = {
  all: ['symphony-tools'] as const,
  list: () => [...symphonyToolKeys.all, 'list'] as const,
  detail: (id: string) => [...symphonyToolKeys.all, 'detail', id] as const,
};

/**
 * Fetch all symphony hosts.
 */
export function useSymphonyHosts() {
  const queryKey = useNamespaceQueryKey(symphonyHostKeys.list());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<SymphonyHostsResponse>('/symphony/hosts', { signal }),
  });
}

/**
 * Fetch a single host by ID.
 */
export function useSymphonyHost(id: string) {
  const queryKey = useNamespaceQueryKey(symphonyHostKeys.detail(id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<SymphonyHost>(`/symphony/hosts/${id}`, { signal }),
    enabled: !!id,
  });
}

/**
 * Mutation: drain a host.
 */
export function useDrainSymphonyHost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<SymphonyHost>(`/symphony/hosts/${id}/drain`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: symphonyHostKeys.all });
    },
  });
}

/**
 * Mutation: activate a host.
 */
export function useActivateSymphonyHost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<SymphonyHost>(`/symphony/hosts/${id}/activate`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: symphonyHostKeys.all });
    },
  });
}

/**
 * Fetch all symphony tool configs.
 */
export function useSymphonyTools() {
  const queryKey = useNamespaceQueryKey(symphonyToolKeys.list());
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<SymphonyToolsResponse>('/symphony/tools', { signal }),
  });
}

/**
 * Fetch a single tool config by ID.
 */
export function useSymphonyTool(id: string) {
  const queryKey = useNamespaceQueryKey(symphonyToolKeys.detail(id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<SymphonyToolConfig>(`/symphony/tools/${id}`, { signal }),
    enabled: !!id,
  });
}

/**
 * Mutation: create a tool config.
 */
export function useCreateSymphonyTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateSymphonyToolBody) =>
      apiClient.post<SymphonyToolConfig>('/symphony/tools', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: symphonyToolKeys.all });
    },
  });
}

/**
 * Mutation: update a tool config.
 */
export function useUpdateSymphonyTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSymphonyToolBody }) =>
      apiClient.patch<SymphonyToolConfig>(`/symphony/tools/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: symphonyToolKeys.all });
    },
  });
}

/**
 * Mutation: delete a tool config.
 */
export function useDeleteSymphonyTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/symphony/tools/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: symphonyToolKeys.all });
    },
  });
}
