/**
 * TanStack Query hooks for Recipes (Issue #1278).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  RecipesResponse,
  RecipeWithDetails,
  CreateRecipeBody,
  UpdateRecipeBody,
} from '@/ui/lib/api-types.ts';

export const recipeKeys = {
  all: ['recipes'] as const,
  list: (filters?: Record<string, string>) => [...recipeKeys.all, 'list', filters] as const,
  detail: (id: string) => [...recipeKeys.all, 'detail', id] as const,
};

export function useRecipes(filters?: Record<string, string>) {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
  return useQuery({
    queryKey: recipeKeys.list(filters),
    queryFn: ({ signal }) => apiClient.get<RecipesResponse>(`/api/recipes${params}`, { signal }),
  });
}

export function useRecipeDetail(id: string) {
  return useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<RecipeWithDetails>(`/api/recipes/${id}`, { signal }),
    enabled: !!id,
  });
}

export function useCreateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRecipeBody) => apiClient.post<RecipeWithDetails>('/api/recipes', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: recipeKeys.all }),
  });
}

export function useUpdateRecipe(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateRecipeBody) => apiClient.patch<RecipeWithDetails>(`/api/recipes/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: recipeKeys.detail(id) });
      qc.invalidateQueries({ queryKey: recipeKeys.all });
    },
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/recipes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: recipeKeys.all }),
  });
}

export function useRecipeToShoppingList(recipeId: string) {
  return useMutation({
    mutationFn: (list_id: string) =>
      apiClient.post<{ added: number }>(`/api/recipes/${recipeId}/to-shopping-list`, { list_id: list_id }),
  });
}
