/**
 * TanStack Query mutation hooks for work item participants.
 *
 * Issue #1714: Participant management (was read-only).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { workItemKeys } from '@/ui/hooks/queries/use-work-items.ts';

/** Body for adding a participant. */
export interface AddParticipantBody {
  participant: string;
  role?: string;
}

/** API response for participant. */
export interface Participant {
  id: string;
  participant: string;
  role?: string;
}

/** Add a participant to a work item. */
export function useAddParticipant(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: AddParticipantBody) =>
      apiClient.post<Participant>(`/api/work-items/${workItemId}/participants`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.detail(workItemId) });
    },
  });
}

/** Remove a participant from a work item. */
export function useRemoveParticipant(workItemId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (participantId: string) =>
      apiClient.delete(`/api/work-items/${workItemId}/participants/${participantId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.detail(workItemId) });
    },
  });
}
