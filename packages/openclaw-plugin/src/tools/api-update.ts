/**
 * api_update tool implementation.
 * Update an onboarded API source's name, tags, or status.
 * Part of API Onboarding feature (#1785).
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { ApiSourceService, type ApiSourceResponse } from '../services/api-source-service.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for api_update tool */
export const ApiUpdateParamsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().min(1).max(100)).max(20).optional(),
  status: z.enum(['active', 'error', 'disabled']).optional(),
});
export type ApiUpdateParams = z.infer<typeof ApiUpdateParamsSchema>;

export interface ApiUpdateSuccess {
  success: true;
  data: {
    content: string;
    details: ApiSourceResponse;
  };
}

export interface ApiUpdateFailure {
  success: false;
  error: string;
}

export type ApiUpdateResult = ApiUpdateSuccess | ApiUpdateFailure;

export interface ApiUpdateToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

export interface ApiUpdateTool {
  name: string;
  description: string;
  parameters: typeof ApiUpdateParamsSchema;
  execute: (params: ApiUpdateParams) => Promise<ApiUpdateResult>;
}

export function createApiUpdateTool(options: ApiUpdateToolOptions): ApiUpdateTool {
  const { client, logger, user_id } = options;
  const service = new ApiSourceService(client);

  return {
    name: 'api_update',
    description: 'Update an onboarded API source. Change its name, description, tags, or status.',
    parameters: ApiUpdateParamsSchema,

    async execute(params: ApiUpdateParams): Promise<ApiUpdateResult> {
      const parseResult = ApiUpdateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }

      const { id, ...updates } = parseResult.data;

      try {
        const response = await service.update(id, updates, { user_id });

        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to update API source' };
        }

        const source = response.data.data;
        const content = `Updated API source: ${source.name} (${source.status})`;

        return { success: true, data: { content, details: source } };
      } catch (error) {
        logger.error('api_update failed', { user_id, error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
