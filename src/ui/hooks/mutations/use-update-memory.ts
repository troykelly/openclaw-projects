/**
 * TanStack Query mutation hook for updating memories.
 *
 * Updates a memory by ID and invalidates related queries.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { UpdateMemoryBody, Memory } from '@/ui/lib/api-types.ts';
import { memoryKeys } from '@/ui/hooks/queries/use-memories.ts';

/** Variables for the update memory mutation. */
export interface UpdateMemoryVariables {
  /** The memory ID to update. */
  id: string;
  /** Partial update body. */
  body: UpdateMemoryBody;
  /** Optional work item ID for targeted cache invalidation. */
  work_item_id?: string;
}

/**
 * Update an existing memory.
 *
 * @returns TanStack mutation
 *
 * @example
 * ```ts
 * const { mutate } = useUpdateMemory();
 * mutate({ id: 'mem-1', body: { title: 'Updated' }, work_item_id: 'wi-1' });
 * ```
 */
export function useUpdateMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: UpdateMemoryVariables) => apiClient.patch<Memory>(`/api/memories/${id}`, body),

    onSuccess: (_data, { work_item_id }) => {
      // Invalidate global memories list
      queryClient.invalidateQueries({ queryKey: memoryKeys.lists() });
      // If we know the work item, invalidate its specific memory list
      if (work_item_id) {
        queryClient.invalidateQueries({ queryKey: memoryKeys.forWorkItem(work_item_id) });
      }
    },
  });
}
