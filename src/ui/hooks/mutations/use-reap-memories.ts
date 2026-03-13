/**
 * TanStack Query mutation hook for memory reaping.
 *
 * Calls POST /api/memories/reap to clean up expired/inactive memories.
 * Issue #2449: Digest results view + reaper activity log + new hooks.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import { memoryKeys } from '@/ui/hooks/queries/use-memories.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';
import type { ReapRequest, ReapResponse } from '@/ui/lib/api-types.ts';

/**
 * Reap expired/inactive memories.
 *
 * Supports dry_run mode to preview what would be reaped.
 *
 * @returns TanStack mutation for POST /api/memories/reap
 */
export function useReapMemories() {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation({
    mutationFn: (body: ReapRequest) => apiClient.post<ReapResponse>('/memories/reap', body),

    onSuccess: (_data, variables) => {
      // Only invalidate cache if not a dry run (actual deletion)
      if (!variables.dry_run) {
        nsInvalidate(memoryKeys.lists());
      }
    },
  });
}
