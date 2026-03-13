/**
 * TanStack Query mutation hooks for note/notebook exports (#2479).
 *
 * Provides mutations for creating and deleting exports.
 */
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/ui/lib/api-client.ts';
import type { ApiRequestError } from '@/ui/lib/api-client.ts';
import type { ExportFormat, ExportOptions, ExportResponse, ExportSourceType } from '@/ui/lib/api-types.ts';
import { exportKeys } from '@/ui/hooks/queries/use-export-status.ts';
import { useNamespaceInvalidate } from '@/ui/hooks/use-namespace-invalidate.ts';

/** Variables for the createExport mutation. */
export interface CreateExportVariables {
  sourceType: ExportSourceType;
  sourceId: string;
  format: ExportFormat;
  options?: ExportOptions;
}

/**
 * Create a new export for a note or notebook.
 *
 * Posts to `/notes/:id/exports` or `/notebooks/:id/exports` depending
 * on the source type. Returns the export response with a poll URL for
 * tracking progress.
 */
export function useCreateExport() {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation<ExportResponse, ApiRequestError, CreateExportVariables>({
    mutationFn: ({ sourceType, sourceId, format, options }: CreateExportVariables) => {
      const basePath = sourceType === 'notebook' ? '/notebooks' : '/notes';
      return apiClient.post<ExportResponse>(
        `${basePath}/${encodeURIComponent(sourceId)}/exports`,
        { format, ...(options ? { options } : {}) },
      );
    },

    onSuccess: () => {
      nsInvalidate(exportKeys.all);
    },

    onError: (error) => {
      console.error('[useCreateExport] Failed to create export:', error.message);
    },
  });
}

/**
 * Delete an export by ID.
 *
 * Sends DELETE to `/exports/:id`.
 */
export function useDeleteExport() {
  const nsInvalidate = useNamespaceInvalidate();

  return useMutation<void, ApiRequestError, string>({
    mutationFn: (exportId: string) => {
      return apiClient.delete(`/exports/${encodeURIComponent(exportId)}`);
    },

    onSuccess: () => {
      nsInvalidate(exportKeys.all);
    },

    onError: (error) => {
      console.error('[useDeleteExport] Failed to delete export:', error.message);
    },
  });
}
