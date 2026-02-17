/**
 * file_share tool implementation.
 * Generates shareable download links for file attachments.
 * Part of Epic #574, Issue #584.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';

/** Parameters for file_share tool */
export const FileShareParamsSchema = z.object({
  file_id: z.string().uuid('File ID must be a valid UUID'),
  expires_in: z
    .number()
    .int()
    .min(60, 'Expiry must be at least 60 seconds')
    .max(604800, 'Expiry must be at most 604800 seconds (7 days)')
    .optional()
    .default(3600),
  max_downloads: z.number().int().min(1, 'Max downloads must be at least 1').optional(),
});
export type FileShareParams = z.infer<typeof FileShareParamsSchema>;

/** File share response from API */
interface FileShareApiResponse {
  share_token: string;
  url: string;
  expires_at: string;
  expires_in: number;
  filename: string;
  content_type: string;
  size_bytes: number;
}

/** Successful tool result */
export interface FileShareSuccess {
  success: true;
  data: {
    content: string;
    details: {
      url: string;
      share_token: string;
      expires_at: string;
      expires_in: number;
      filename: string;
      content_type: string;
      size_bytes: number;
    };
  };
}

/** Failed tool result */
export interface FileShareFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type FileShareResult = FileShareSuccess | FileShareFailure;

/** Tool configuration */
export interface FileShareToolOptions {
  client: ApiClient;
  logger: Logger;
  user_id: string;
}

/** Tool definition */
export interface FileShareTool {
  name: string;
  description: string;
  parameters: typeof FileShareParamsSchema;
  execute: (params: FileShareParams) => Promise<FileShareResult>;
}

/**
 * Format file size for human readability.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format duration for human readability.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
  return `${Math.floor(seconds / 86400)} days`;
}

/**
 * Creates the file_share tool.
 */
export function createFileShareTool(options: FileShareToolOptions): FileShareTool {
  const { client, logger, user_id } = options;

  return {
    name: 'file_share',
    description:
      'Generate a shareable download link for a file. Use when you need to share a file with someone outside the system. ' +
      'The link is time-limited and can be configured with an expiry time and optional download limit.',
    parameters: FileShareParamsSchema,

    async execute(params: FileShareParams): Promise<FileShareResult> {
      // Validate parameters
      const parseResult = FileShareParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { file_id, expires_in, max_downloads } = parseResult.data;

      // Log invocation
      logger.info('file_share invoked', {
        user_id,
        file_id,
        expires_in,
        max_downloads,
      });

      try {
        // Call API
        const response = await client.post<FileShareApiResponse>(
          `/api/files/${file_id}/share`,
          {
            expires_in,
            max_downloads,
          },
          { user_id },
        );

        if (!response.success) {
          logger.error('file_share API error', {
            user_id,
            file_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to create share link',
          };
        }

        const { url, share_token, expires_at, filename, content_type, size_bytes } = response.data;

        logger.debug('file_share completed', {
          user_id,
          file_id,
          share_token,
          expires_at,
        });

        const expiryText = formatDuration(expires_in);
        const sizeText = formatFileSize(size_bytes);
        const downloadLimit = max_downloads ? ` (max ${max_downloads} downloads)` : '';

        return {
          success: true,
          data: {
            content: `Share link created for "${filename}" (${sizeText}). ` + `Valid for ${expiryText}${downloadLimit}.\n\nURL: ${url}`,
            details: {
              url,
              share_token,
              expires_at,
              expires_in,
              filename,
              content_type,
              size_bytes,
            },
          },
        };
      } catch (error) {
        logger.error('file_share failed', {
          user_id,
          file_id,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while creating share link.',
        };
      }
    },
  };
}
