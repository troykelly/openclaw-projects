/**
 * TanStack Query hooks for terminal search (Epic #1667, #1695).
 *
 * Provides POST-based semantic search across terminal session entries.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { TerminalSearchResponse } from '@/ui/lib/api-types.ts';

/** Search request parameters. */
export interface TerminalSearchParams {
  query: string;
  connection_id?: string;
  session_id?: string;
  kind?: string;
  tags?: string[];
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Terminal semantic search mutation.
 * Uses POST since search has a complex body (not suitable for query string).
 */
export function useTerminalSearch() {
  return useMutation({
    mutationFn: (params: TerminalSearchParams) =>
      apiClient.post<TerminalSearchResponse>('/api/terminal/search', params),
  });
}
