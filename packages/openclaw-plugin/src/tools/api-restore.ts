/**
 * api_restore tool implementation.
 * Restore a soft-deleted API source.
 * Part of API Onboarding feature (#1785).
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { ApiSourceService, type ApiSourceResponse } from '../services/api-source-service.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for api_restore tool */
export const ApiRestoreParamsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});
export type ApiRestoreParams = z.infer<typeof ApiRestoreParamsSchema>;

export interface ApiRestoreSuccess {
  success: true;
  data: {
    content: string;
    details: ApiSourceResponse;
  };
}

export interface ApiRestoreFailure {
  success: false;
  error: string;
}

export type ApiRestoreResult = ApiRestoreSuccess | ApiRestoreFailure;

export interface ApiRestoreToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

export interface ApiRestoreTool {
  name: string;
  description: string;
  parameters: typeof ApiRestoreParamsSchema;
  execute: (params: ApiRestoreParams) => Promise<ApiRestoreResult>;
}

export function createApiRestoreTool(options: ApiRestoreToolOptions): ApiRestoreTool {
  const { client, logger, user_id } = options;
  const service = new ApiSourceService(client);

  return {
    name: 'api_restore',
    description: 'Restore a previously soft-deleted API source.',
    parameters: ApiRestoreParamsSchema,

    async execute(params: ApiRestoreParams): Promise<ApiRestoreResult> {
      const parseResult = ApiRestoreParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }

      try {
        const response = await service.restore(parseResult.data.id, { user_id });

        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to restore API source' };
        }

        const source = response.data.data;
        const content = `Restored API source: ${source.name} (${source.status})`;

        return { success: true, data: { content, details: source } };
      } catch (error) {
        logger.error('api_restore failed', { user_id, error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
