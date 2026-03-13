/**
 * TanStack Query mutation hook for memory digest.
 *
 * Calls POST /api/memories/digest to cluster related memories.
 * Issue #2449: Digest results view + reaper activity log + new hooks.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { DigestRequest, DigestResponse } from '@/ui/lib/api-types.ts';

/**
 * Digest memories into semantic clusters.
 *
 * @returns TanStack mutation for POST /api/memories/digest
 */
export function useDigestMemories() {
  return useMutation({
    mutationFn: (body: DigestRequest) => apiClient.post<DigestResponse>('/memories/digest', body),
  });
}
