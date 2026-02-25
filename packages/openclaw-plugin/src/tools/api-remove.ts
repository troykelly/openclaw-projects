/**
 * api_remove tool implementation.
 * Soft-delete an onboarded API source.
 * Part of API Onboarding feature (#1785).
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { ApiSourceService } from '../services/api-source-service.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for api_remove tool */
export const ApiRemoveParamsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});
export type ApiRemoveParams = z.infer<typeof ApiRemoveParamsSchema>;

export interface ApiRemoveSuccess {
  success: true;
  data: {
    content: string;
    details: { id: string };
  };
}

export interface ApiRemoveFailure {
  success: false;
  error: string;
}

export type ApiRemoveResult = ApiRemoveSuccess | ApiRemoveFailure;

export interface ApiRemoveToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

export interface ApiRemoveTool {
  name: string;
  description: string;
  parameters: typeof ApiRemoveParamsSchema;
  execute: (params: ApiRemoveParams) => Promise<ApiRemoveResult>;
}

export function createApiRemoveTool(options: ApiRemoveToolOptions): ApiRemoveTool {
  const { client, logger, user_id } = options;
  const service = new ApiSourceService(client);

  return {
    name: 'api_remove',
    description: 'Soft-delete an onboarded API source. The source can be restored later with api_restore.',
    parameters: ApiRemoveParamsSchema,

    async execute(params: ApiRemoveParams): Promise<ApiRemoveResult> {
      const parseResult = ApiRemoveParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }

      try {
        const response = await service.remove(parseResult.data.id, { user_id });

        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to remove API source' };
        }

        return {
          success: true,
          data: {
            content: `Removed API source ${parseResult.data.id}. Use api_restore to undo.`,
            details: { id: parseResult.data.id },
          },
        };
      } catch (error) {
        logger.error('api_remove failed', { user_id, error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
