/**
 * TanStack Query hooks for agent identity management (Issue #1287).
 *
 * Provides queries for fetching identity/history and mutations for
 * creating, updating, proposing changes, and approving/rejecting.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  AgentIdentity,
  AgentIdentityHistoryResponse,
  AgentIdentityHistoryEntry,
  CreateAgentIdentityBody,
  ProposeIdentityChangeBody,
} from '@/ui/lib/api-types.ts';

/** Query key factory for agent identity. */
export const identityKeys = {
  all: ['agent-identity'] as const,
  current: (name?: string) => [...identityKeys.all, 'current', name] as const,
  history: (name: string) => [...identityKeys.all, 'history', name] as const,
};

/**
 * Fetch the current agent identity.
 */
export function useAgentIdentity(name?: string) {
  const url = name ? `/api/identity?name=${encodeURIComponent(name)}` : '/api/identity';
  return useQuery({
    queryKey: identityKeys.current(name),
    queryFn: ({ signal }) => apiClient.get<AgentIdentity>(url, { signal }),
  });
}

/**
 * Fetch identity version history.
 */
export function useAgentIdentityHistory(name: string) {
  return useQuery({
    queryKey: identityKeys.history(name),
    queryFn: ({ signal }) =>
      apiClient.get<AgentIdentityHistoryResponse>(`/api/identity/history?name=${encodeURIComponent(name)}`, { signal }),
    enabled: !!name,
  });
}

/**
 * Mutation: create or replace an identity.
 */
export function useSaveAgentIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateAgentIdentityBody) =>
      apiClient.put<AgentIdentity>('/api/identity', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: identityKeys.all });
    },
  });
}

/**
 * Mutation: partially update an identity.
 */
export function useUpdateAgentIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, unknown> & { name: string }) =>
      apiClient.patch<AgentIdentity>('/api/identity', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: identityKeys.all });
    },
  });
}

/**
 * Mutation: propose an identity change (agent-initiated).
 */
export function useProposeIdentityChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ProposeIdentityChangeBody) =>
      apiClient.post<AgentIdentityHistoryEntry>('/api/identity/proposals', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: identityKeys.all });
    },
  });
}

/**
 * Mutation: approve a pending proposal.
 */
export function useApproveProposal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (proposalId: string) =>
      apiClient.post<AgentIdentityHistoryEntry>(`/api/identity/proposals/${proposalId}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: identityKeys.all });
    },
  });
}

/**
 * Mutation: reject a pending proposal.
 */
export function useRejectProposal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ proposalId, reason }: { proposalId: string; reason?: string }) =>
      apiClient.post<AgentIdentityHistoryEntry>(`/api/identity/proposals/${proposalId}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: identityKeys.all });
    },
  });
}

/**
 * Mutation: rollback to a previous version.
 */
export function useRollbackIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, version }: { name: string; version: number }) =>
      apiClient.post<AgentIdentity>('/api/identity/rollback', { name, version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: identityKeys.all });
    },
  });
}
