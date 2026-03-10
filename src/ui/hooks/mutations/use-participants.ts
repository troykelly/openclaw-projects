/**
 * TanStack Query mutation hooks for work item participants.
 *
 * Issue #1714: Participant management (was read-only).
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { workItemKeys } from '@/ui/hooks/queries/use-work-items.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

/** Body for adding a participant. */
export interface AddParticipantBody {
  participant: string;
  /** Role is required by the server. Defaults to 'assignee' if omitted. */
  role?: string;
}

/** API response for participant. */
export interface Participant {
  id: string;
  participant: string;
  role: string;
}

/** Add a participant to a work item. */
export function useAddParticipant(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: AddParticipantBody) =>
      apiClient.post<Participant>(`/work-items/${workItemId}/participants`, {
        ...body,
        role: body.role || 'assignee',
      }),
    onSuccess: () => {
      nsInvalidate(workItemKeys.detail(workItemId));
    },
  });
}

/** Remove a participant from a work item. */
export function useRemoveParticipant(workItemId: string) {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (participantId: string) =>
      apiClient.delete(`/work-items/${workItemId}/participants/${participantId}`),
    onSuccess: () => {
      nsInvalidate(workItemKeys.detail(workItemId));
    },
  });
}
