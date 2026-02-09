/**
 * TanStack Query hooks for the Skill Store.
 *
 * Provides queries for skills, collections, items, schedules,
 * and search functionality used by the SkillStorePage.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  SkillStoreSkillsResponse,
  SkillStoreCollectionsResponse,
  SkillStoreItemsResponse,
  SkillStoreItem,
  SkillStoreSchedulesResponse,
  SkillStoreSearchResponse,
} from '@/ui/lib/api-types.ts';

/** Query key factory for skill store entities. */
export const skillStoreKeys = {
  all: ['skill-store'] as const,
  skills: () => [...skillStoreKeys.all, 'skills'] as const,
  collections: (skillId: string) => [...skillStoreKeys.all, 'collections', skillId] as const,
  items: (skillId: string, collection?: string, status?: string, tags?: string, offset?: number) =>
    [...skillStoreKeys.all, 'items', skillId, collection, status, tags, offset] as const,
  item: (id: string) => [...skillStoreKeys.all, 'item', id] as const,
  schedules: (skillId: string) => [...skillStoreKeys.all, 'schedules', skillId] as const,
  search: (skillId: string, query: string) => [...skillStoreKeys.all, 'search', skillId, query] as const,
};

/**
 * Fetch all registered skills with item counts.
 *
 * @returns TanStack Query result with `SkillStoreSkillsResponse`
 */
export function useSkillStoreSkills() {
  return useQuery({
    queryKey: skillStoreKeys.skills(),
    queryFn: ({ signal }) => apiClient.get<SkillStoreSkillsResponse>('/api/admin/skill-store/skills', { signal }),
  });
}

/**
 * Fetch collections for a specific skill.
 *
 * @param skillId - The skill identifier
 * @returns TanStack Query result with `SkillStoreCollectionsResponse`
 */
export function useSkillStoreCollections(skillId: string) {
  return useQuery({
    queryKey: skillStoreKeys.collections(skillId),
    queryFn: ({ signal }) => apiClient.get<SkillStoreCollectionsResponse>(`/api/skill-store/collections?skill_id=${encodeURIComponent(skillId)}`, { signal }),
    enabled: !!skillId,
  });
}

/** Parameters for listing skill store items. */
export interface UseSkillStoreItemsParams {
  skillId: string;
  collection?: string;
  status?: string;
  tags?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch items for a skill, optionally filtered by collection, status, and tags.
 *
 * @param params - Query parameters
 * @returns TanStack Query result with `SkillStoreItemsResponse`
 */
export function useSkillStoreItems(params: UseSkillStoreItemsParams) {
  const { skillId, collection, status, tags, limit = 50, offset = 0 } = params;

  const searchParams = new URLSearchParams();
  searchParams.set('skill_id', skillId);
  searchParams.set('limit', String(limit));
  searchParams.set('offset', String(offset));
  if (collection) searchParams.set('collection', collection);
  if (status) searchParams.set('status', status);
  if (tags) searchParams.set('tags', tags);

  return useQuery({
    queryKey: skillStoreKeys.items(skillId, collection, status, tags, offset),
    queryFn: ({ signal }) => apiClient.get<SkillStoreItemsResponse>(`/api/skill-store/items?${searchParams.toString()}`, { signal }),
    enabled: !!skillId,
  });
}

/**
 * Fetch a single item by ID.
 *
 * @param id - The item UUID
 * @returns TanStack Query result with `SkillStoreItem`
 */
export function useSkillStoreItem(id: string) {
  return useQuery({
    queryKey: skillStoreKeys.item(id),
    queryFn: ({ signal }) => apiClient.get<SkillStoreItem>(`/api/skill-store/items/${id}`, { signal }),
    enabled: !!id,
  });
}

/**
 * Fetch schedules for a skill.
 *
 * @param skillId - The skill identifier
 * @returns TanStack Query result with `SkillStoreSchedulesResponse`
 */
export function useSkillStoreSchedules(skillId: string) {
  return useQuery({
    queryKey: skillStoreKeys.schedules(skillId),
    queryFn: ({ signal }) => apiClient.get<SkillStoreSchedulesResponse>(`/api/skill-store/schedules?skill_id=${encodeURIComponent(skillId)}`, { signal }),
    enabled: !!skillId,
  });
}

/**
 * Mutation: soft-delete a skill store item.
 *
 * Invalidates the items and collections queries on success.
 */
export function useDeleteSkillStoreItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/skill-store/items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillStoreKeys.all });
    },
  });
}

/**
 * Mutation: trigger a schedule manually.
 *
 * Invalidates the schedules query on success.
 */
export function useTriggerSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/skill-store/schedules/${id}/trigger`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillStoreKeys.all });
    },
  });
}

/**
 * Mutation: pause a schedule.
 *
 * Invalidates the schedules query on success.
 */
export function usePauseSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/skill-store/schedules/${id}/pause`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillStoreKeys.all });
    },
  });
}

/**
 * Mutation: resume a schedule.
 *
 * Invalidates the schedules query on success.
 */
export function useResumeSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/skill-store/schedules/${id}/resume`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillStoreKeys.all });
    },
  });
}

/**
 * Mutation: full-text search skill store items.
 *
 * Uses a mutation because the search is a POST with a body.
 */
export function useSkillStoreSearch() {
  return useMutation({
    mutationFn: (body: { skill_id: string; query: string; collection?: string; limit?: number }) =>
      apiClient.post<SkillStoreSearchResponse>('/api/skill-store/search', body),
  });
}
