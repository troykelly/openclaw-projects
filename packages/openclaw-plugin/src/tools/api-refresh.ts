/**
 * api_refresh tool implementation.
 * Refresh an API source by re-fetching and re-parsing its OpenAPI spec.
 * Part of API Onboarding feature (#1785).
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { ApiSourceService, type RefreshResultResponse } from '../services/api-source-service.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for api_refresh tool */
export const ApiRefreshParamsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});
export type ApiRefreshParams = z.infer<typeof ApiRefreshParamsSchema>;

export interface ApiRefreshSuccess {
  success: true;
  data: {
    content: string;
    details: {
      api_source_id: string;
      spec_changed: boolean;
      memories_created: number;
      memories_updated: number;
      memories_deleted: number;
    };
  };
}

export interface ApiRefreshFailure {
  success: false;
  error: string;
}

export type ApiRefreshResult = ApiRefreshSuccess | ApiRefreshFailure;

export interface ApiRefreshToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

export interface ApiRefreshTool {
  name: string;
  description: string;
  parameters: typeof ApiRefreshParamsSchema;
  execute: (params: ApiRefreshParams) => Promise<ApiRefreshResult>;
}

export function createApiRefreshTool(options: ApiRefreshToolOptions): ApiRefreshTool {
  const { client, logger, user_id } = options;
  const service = new ApiSourceService(client);

  return {
    name: 'api_refresh',
    description: 'Refresh an API source by re-fetching its OpenAPI spec and updating memories. Returns a diff summary.',
    parameters: ApiRefreshParamsSchema,

    async execute(params: ApiRefreshParams): Promise<ApiRefreshResult> {
      const parseResult = ApiRefreshParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }

      try {
        const response = await service.refresh(parseResult.data.id, { user_id });

        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to refresh API source' };
        }

        const result: RefreshResultResponse = response.data.data;
        const content = result.spec_changed
          ? `Refreshed "${result.api_source.name}" — spec changed: ${result.memories_created} added, ${result.memories_updated} updated, ${result.memories_deleted} removed.`
          : `Refreshed "${result.api_source.name}" — spec unchanged, no updates needed.`;

        return {
          success: true,
          data: {
            content,
            details: {
              api_source_id: result.api_source.id,
              spec_changed: result.spec_changed,
              memories_created: result.memories_created,
              memories_updated: result.memories_updated,
              memories_deleted: result.memories_deleted,
            },
          },
        };
      } catch (error) {
        logger.error('api_refresh failed', { user_id, error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
