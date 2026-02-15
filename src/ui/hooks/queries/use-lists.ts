/**
 * TanStack Query hooks for Shared Lists (Issue #1277).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type {
  SharedListsResponse,
  SharedListWithItems,
  SharedList,
  SharedListItem,
  CreateListBody,
  AddListItemsBody,
  CheckItemsBody,
} from '@/ui/lib/api-types.ts';

export const listKeys = {
  all: ['lists'] as const,
  lists: () => [...listKeys.all, 'list'] as const,
  detail: (id: string) => [...listKeys.all, 'detail', id] as const,
};

export function useLists() {
  return useQuery({
    queryKey: listKeys.lists(),
    queryFn: ({ signal }) => apiClient.get<SharedListsResponse>('/api/lists', { signal }),
  });
}

export function useListDetail(id: string) {
  return useQuery({
    queryKey: listKeys.detail(id),
    queryFn: ({ signal }) => apiClient.get<SharedListWithItems>(`/api/lists/${id}`, { signal }),
    enabled: !!id,
  });
}

export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateListBody) => apiClient.post<SharedList>('/api/lists', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKeys.lists() }),
  });
}

export function useAddListItems(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddListItemsBody) =>
      apiClient.post<{ items: SharedListItem[] }>(`/api/lists/${listId}/items`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKeys.detail(listId) }),
  });
}

export function useCheckItems(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CheckItemsBody) =>
      apiClient.post<{ checked: number }>(`/api/lists/${listId}/items/check`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKeys.detail(listId) }),
  });
}

export function useUncheckItems(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CheckItemsBody) =>
      apiClient.post<{ unchecked: number }>(`/api/lists/${listId}/items/uncheck`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKeys.detail(listId) }),
  });
}

export function useResetList(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<{ removed: number; unchecked: number }>(`/api/lists/${listId}/reset`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKeys.detail(listId) }),
  });
}

export function useDeleteList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/lists/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKeys.lists() }),
  });
}
