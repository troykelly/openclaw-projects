/**
 * api_get tool implementation.
 * Retrieve details about a specific onboarded API source.
 * Part of API Onboarding feature (#1785).
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { ApiSourceService, type ApiSourceResponse } from '../services/api-source-service.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for api_get tool */
export const ApiGetParamsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});
export type ApiGetParams = z.infer<typeof ApiGetParamsSchema>;

/** Successful tool result */
export interface ApiGetSuccess {
  success: true;
  data: {
    content: string;
    details: ApiSourceResponse;
  };
}

/** Failed tool result */
export interface ApiGetFailure {
  success: false;
  error: string;
}

export type ApiGetResult = ApiGetSuccess | ApiGetFailure;

export interface ApiGetToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

export interface ApiGetTool {
  name: string;
  description: string;
  parameters: typeof ApiGetParamsSchema;
  execute: (params: ApiGetParams) => Promise<ApiGetResult>;
}

export function createApiGetTool(options: ApiGetToolOptions): ApiGetTool {
  const { client, logger, user_id } = options;
  const service = new ApiSourceService(client);

  return {
    name: 'api_get',
    description: 'Get details about a specific onboarded API source including its status, spec version, and tags.',
    parameters: ApiGetParamsSchema,

    async execute(params: ApiGetParams): Promise<ApiGetResult> {
      const parseResult = ApiGetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }

      try {
        const response = await service.get(parseResult.data.id, { user_id });

        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to get API source' };
        }

        const source = response.data.data;
        const content = `API Source: ${source.name} (${source.status}) — ${source.spec_version ?? 'unknown version'}`;

        return { success: true, data: { content, details: source } };
      } catch (error) {
        logger.error('api_get failed', { user_id, error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
