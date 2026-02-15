/**
 * TanStack Query hooks for project webhooks and events (Issue #1274).
 *
 * Provides queries for listing webhooks/events and mutations for
 * creating, updating, and deleting project webhooks.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  ProjectWebhook,
  ProjectWebhooksResponse,
  CreateProjectWebhookBody,
  UpdateProjectWebhookBody,
  ProjectEventsResponse,
} from '@/ui/lib/api-types.ts';

/** Query key factory for project webhooks. */
export const projectWebhookKeys = {
  all: ['project-webhooks'] as const,
  list: (projectId: string) => [...projectWebhookKeys.all, 'list', projectId] as const,
  events: (projectId: string) => [...projectWebhookKeys.all, 'events', projectId] as const,
};

/**
 * Fetch webhooks for a project.
 *
 * @param projectId - The project work item UUID
 * @returns TanStack Query result with `ProjectWebhooksResponse`
 */
export function useProjectWebhooks(projectId: string) {
  return useQuery({
    queryKey: projectWebhookKeys.list(projectId),
    queryFn: ({ signal }) =>
      apiClient.get<ProjectWebhooksResponse>(`/api/projects/${projectId}/webhooks`, { signal }),
    enabled: !!projectId,
  });
}

/**
 * Fetch events for a project, optionally filtered by event_type.
 *
 * @param projectId - The project work item UUID
 * @param opts - Optional filters (event_type, limit, offset)
 * @returns TanStack Query result with `ProjectEventsResponse`
 */
export function useProjectEvents(
  projectId: string,
  opts?: { eventType?: string; limit?: number; offset?: number },
) {
  const params = new URLSearchParams();
  if (opts?.eventType) params.set('event_type', opts.eventType);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  const qs = params.toString();
  const url = `/api/projects/${projectId}/events${qs ? `?${qs}` : ''}`;

  return useQuery({
    queryKey: [...projectWebhookKeys.events(projectId), opts?.eventType, opts?.limit, opts?.offset],
    queryFn: ({ signal }) => apiClient.get<ProjectEventsResponse>(url, { signal }),
    enabled: !!projectId,
  });
}

/**
 * Mutation: create a new webhook for a project.
 *
 * Invalidates the webhooks list on success.
 */
export function useCreateProjectWebhook(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateProjectWebhookBody) =>
      apiClient.post<ProjectWebhook>(`/api/projects/${projectId}/webhooks`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectWebhookKeys.list(projectId) });
    },
  });
}

/**
 * Mutation: update a webhook (label, is_active, payload_mapping).
 *
 * Invalidates the webhooks list on success.
 */
export function useUpdateProjectWebhook(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ webhookId, body }: { webhookId: string; body: UpdateProjectWebhookBody }) =>
      apiClient.patch<ProjectWebhook>(`/api/projects/${projectId}/webhooks/${webhookId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectWebhookKeys.list(projectId) });
    },
  });
}

/**
 * Mutation: delete a webhook.
 *
 * Invalidates the webhooks list on success.
 */
export function useDeleteProjectWebhook(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (webhookId: string) =>
      apiClient.delete(`/api/projects/${projectId}/webhooks/${webhookId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectWebhookKeys.list(projectId) });
    },
  });
}
