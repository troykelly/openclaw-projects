/**
 * TanStack Query hooks for dev prompts (Epic #2011, Issue #2016).
 *
 * Provides queries for listing/fetching dev prompts and mutations for
 * creating, updating, deleting, resetting, and rendering prompts.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  DevPrompt,
  DevPromptsResponse,
  CreateDevPromptBody,
  UpdateDevPromptBody,
  DevPromptRenderResult,
} from '@/ui/lib/api-types.ts';

/** Query key factory for dev prompts. */
export const devPromptKeys = {
  all: ['dev-prompts'] as const,
  list: (filters?: DevPromptListFilters) =>
    [...devPromptKeys.all, 'list', filters] as const,
  detail: (id: string) => [...devPromptKeys.all, 'detail', id] as const,
};

/** Filter options for the list query. */
export interface DevPromptListFilters {
  category?: string;
  is_system?: boolean;
  search?: string;
  include_inactive?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Fetch dev prompts with optional filters.
 */
export function useDevPrompts(filters?: DevPromptListFilters) {
  const params = new URLSearchParams();
  if (filters?.category) params.set('category', filters.category);
  if (filters?.is_system !== undefined) params.set('is_system', String(filters.is_system));
  if (filters?.search) params.set('search', filters.search);
  if (filters?.include_inactive) params.set('include_inactive', 'true');
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  const qs = params.toString();
  const url = `/dev-prompts${qs ? `?${qs}` : ''}`;

  return useQuery({
    queryKey: devPromptKeys.list(filters),
    queryFn: ({ signal }) => apiClient.get<DevPromptsResponse>(url, { signal }),
  });
}

/**
 * Fetch a single dev prompt by ID.
 */
export function useDevPrompt(id: string) {
  return useQuery({
    queryKey: devPromptKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<DevPrompt>(`/dev-prompts/${id}`, { signal }),
    enabled: !!id,
  });
}

/**
 * Mutation: create a new user-defined dev prompt.
 */
export function useCreateDevPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateDevPromptBody) =>
      apiClient.post<DevPrompt>('/dev-prompts', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devPromptKeys.all });
    },
  });
}

/**
 * Mutation: update a dev prompt.
 */
export function useUpdateDevPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDevPromptBody }) =>
      apiClient.patch<DevPrompt>(`/dev-prompts/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devPromptKeys.all });
    },
  });
}

/**
 * Mutation: soft-delete a dev prompt (user prompts only).
 */
export function useDeleteDevPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/dev-prompts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devPromptKeys.all });
    },
  });
}

/**
 * Mutation: reset a system prompt body to its default.
 */
export function useResetDevPrompt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<DevPrompt>(`/dev-prompts/${id}/reset`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: devPromptKeys.all });
    },
  });
}

/**
 * Mutation: render a dev prompt template with Handlebars.
 */
export function useRenderDevPrompt() {
  return useMutation({
    mutationFn: ({ id, variables }: { id: string; variables?: Record<string, string> }) =>
      apiClient.post<DevPromptRenderResult>(`/dev-prompts/${id}/render`, { variables }),
  });
}
