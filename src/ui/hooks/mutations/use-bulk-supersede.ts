/**
 * TanStack Query mutation hook for bulk memory supersession.
 *
 * Calls POST /api/memories/bulk-supersede to mark multiple memories
 * as superseded by a single target memory.
 * Issue #2449: Digest results view + reaper activity log + new hooks.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { memoryKeys } from '@/ui/hooks/queries/use-memories.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';
import type { BulkSupersedeRequest, BulkSupersedeResponse } from '@/ui/lib/api-types.ts';

/**
 * Bulk-supersede multiple memories with a single target.
 *
 * @returns TanStack mutation for POST /api/memories/bulk-supersede
 */
export function useBulkSupersede() {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: BulkSupersedeRequest) => apiClient.post<BulkSupersedeResponse>('/memories/bulk-supersede', body),

    onSuccess: () => {
      nsInvalidate(memoryKeys.lists());
    },
  });
}
