/**
 * TanStack Query hooks for Pantry Inventory (Issue #1280).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  PantryItemsResponse,
  PantryItem,
  CreatePantryItemBody,
  UpdatePantryItemBody,
} from '@/ui/lib/api-types.ts';

export const pantryKeys = {
  all: ['pantry'] as const,
  list: (filters?: Record<string, string>) => [...pantryKeys.all, 'list', filters] as const,
  expiring: (days?: number) => [...pantryKeys.all, 'expiring', days] as const,
};

export function usePantryItems(filters?: Record<string, string>) {
  const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
  return useQuery({
    queryKey: pantryKeys.list(filters),
    queryFn: ({ signal }) => apiClient.get<PantryItemsResponse>(`/api/pantry${params}`, { signal }),
  });
}

export function usePantryExpiring(days?: number) {
  const params = days ? `?days=${days}` : '';
  return useQuery({
    queryKey: pantryKeys.expiring(days),
    queryFn: ({ signal }) =>
      apiClient.get<PantryItemsResponse & { days: number }>(`/api/pantry/expiring${params}`, { signal }),
  });
}

export function useCreatePantryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePantryItemBody) => apiClient.post<PantryItem>('/api/pantry', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}

export function useUpdatePantryItem(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePantryItemBody) => apiClient.patch<PantryItem>(`/api/pantry/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}

export function useDepletePantryItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) =>
      apiClient.post<{ depleted: number }>('/api/pantry/use', { item_ids: itemIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}

export function useDeletePantryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/pantry/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: pantryKeys.all }),
  });
}
