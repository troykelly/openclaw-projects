/**
 * TanStack Query hooks for Meal Log (Issue #1279).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  MealLogResponse,
  MealLogEntry,
  CreateMealLogBody,
  UpdateMealLogBody,
  MealLogStats,
} from '@/ui/lib/api-types.ts';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

export const mealLogKeys = {
  all: ['meal-log'] as const,
  list: (filters?: Record<string, string>) => [...mealLogKeys.all, 'list', filters] as const,
  detail: (id: string) => [...mealLogKeys.all, 'detail', id] as const,
  stats: (days?: number) => [...mealLogKeys.all, 'stats', days] as const,
};

export function useMealLog(filters?: Record<string, string>) {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
  const queryKey = useNamespaceQueryKey(mealLogKeys.list(filters));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<MealLogResponse>(`/meal-log${params}`, { signal }),
  });
}

export function useMealLogDetail(id: string) {
  const queryKey = useNamespaceQueryKey(mealLogKeys.detail(id));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<MealLogEntry>(`/meal-log/${id}`, { signal }),
    enabled: !!id,
  });
}

export function useMealLogStats(days?: number) {
  const params = days ? `?days=${days}` : '';
  const queryKey = useNamespaceQueryKey(mealLogKeys.stats(days));
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get<MealLogStats>(`/meal-log/stats${params}`, { signal }),
  });
}

export function useCreateMealLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMealLogBody) => apiClient.post<MealLogEntry>('/meal-log', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mealLogKeys.all });
    },
  });
}

export function useUpdateMealLog(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMealLogBody) => apiClient.patch<MealLogEntry>(`/meal-log/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mealLogKeys.detail(id) });
      qc.invalidateQueries({ queryKey: mealLogKeys.all });
    },
  });
}

export function useDeleteMealLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/meal-log/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: mealLogKeys.all }),
  });
}
