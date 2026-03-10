/**
 * Mutation hooks for namespace management (Issue #2353).
 *
 * Provides mutations for creating namespaces, managing grants
 * (invite, update access, remove), and leaving a namespace.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { namespaceKeys } from '@/ui/hooks/queries/use-namespaces';
import { apiClient } from '@/ui/lib/api-client';

/**
 * Create a new namespace.
 */
export function useCreateNamespace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) => apiClient.post<{ namespace: string; created: boolean }>('/namespaces', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: namespaceKeys.all });
    },
  });
}

/**
 * Invite a member (upsert grant) to a namespace.
 */
export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ns, email, access }: { ns: string; email: string; access: string }) =>
      apiClient.post(`/namespaces/${encodeURIComponent(ns)}/grants`, {
        email,
        access,
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: namespaceKeys.detail(variables.ns),
      });
      void queryClient.invalidateQueries({
        queryKey: namespaceKeys.list(),
      });
    },
  });
}

/**
 * Update a grant's access level.
 */
export function useUpdateGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ns, grantId, access }: { ns: string; grantId: string; access: string }) =>
      apiClient.patch(`/namespaces/${encodeURIComponent(ns)}/grants/${encodeURIComponent(grantId)}`, { access }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: namespaceKeys.detail(variables.ns),
      });
    },
  });
}

/**
 * Remove a grant (revoke access).
 */
export function useRemoveGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ns, grantId }: { ns: string; grantId: string }) =>
      apiClient.delete(`/namespaces/${encodeURIComponent(ns)}/grants/${encodeURIComponent(grantId)}`),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: namespaceKeys.detail(variables.ns),
      });
      void queryClient.invalidateQueries({
        queryKey: namespaceKeys.list(),
      });
    },
  });
}
