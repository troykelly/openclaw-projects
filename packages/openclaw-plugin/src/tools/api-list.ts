/**
 * api_list tool implementation.
 * List all onboarded API sources.
 * Part of API Onboarding feature (#1785).
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { ApiSourceService, type ApiSourceResponse } from '../services/api-source-service.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for api_list tool */
export const ApiListParamsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  status: z.enum(['active', 'error', 'disabled']).optional(),
});
export type ApiListParams = z.infer<typeof ApiListParamsSchema>;

export interface ApiListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      count: number;
      sources: ApiSourceResponse[];
    };
  };
}

export interface ApiListFailure {
  success: false;
  error: string;
}

export type ApiListResult = ApiListSuccess | ApiListFailure;

export interface ApiListToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

export interface ApiListTool {
  name: string;
  description: string;
  parameters: typeof ApiListParamsSchema;
  execute: (params: ApiListParams) => Promise<ApiListResult>;
}

export function createApiListTool(options: ApiListToolOptions): ApiListTool {
  const { client, logger, user_id } = options;
  const service = new ApiSourceService(client);

  return {
    name: 'api_list',
    description: 'List all onboarded API sources. Optionally filter by status (active, error, disabled).',
    parameters: ApiListParamsSchema,

    async execute(params: ApiListParams): Promise<ApiListResult> {
      const parseResult = ApiListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }

      try {
        const response = await service.list(parseResult.data, { user_id });

        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to list API sources' };
        }

        const sources = response.data.data;
        const lines = sources.length > 0
          ? sources.map((s) => `- ${s.name} (${s.status}) [${s.id}]`)
          : ['No API sources found.'];
        const content = `${sources.length} API source(s):\n${lines.join('\n')}`;

        return { success: true, data: { content, details: { count: sources.length, sources } } };
      } catch (error) {
        logger.error('api_list failed', { user_id, error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
