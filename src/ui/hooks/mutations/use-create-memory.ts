/**
 * TanStack Query mutation hook for creating memories.
 *
 * Creates a memory attached to a specific work item and invalidates
 * the related memory queries.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { CreateMemoryBody, Memory } from '@/ui/lib/api-types.ts';
import { memoryKeys } from '@/ui/hooks/queries/use-memories.ts';

/** Variables for the create memory mutation. */
export interface CreateMemoryVariables {
  /** The work item ID to attach the memory to. */
  work_item_id: string;
  /** Memory data. */
  body: CreateMemoryBody;
}

/**
 * Create a new memory attached to a work item.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useCreateMemory();
 * mutate({ work_item_id: 'abc', body: { title: 'Note', content: 'Details' } });
 * ```
 */
export function useCreateMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ work_item_id, body }: CreateMemoryVariables) => apiClient.post<Memory>(`/api/work-items/${work_item_id}/memories`, body),

    onSuccess: (_data, { work_item_id }) => {
      // Invalidate the work item's memories list and global memories
      queryClient.invalidateQueries({ queryKey: memoryKeys.forWorkItem(work_item_id) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.lists() });
    },
  });
}
