/**
 * api_recall tool implementation.
 * Search onboarded API memories to find endpoints, operations, and capabilities.
 * Part of API Onboarding feature (#1784).
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { ApiSourceService, type ApiMemorySearchResultResponse } from '../services/api-source-service.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for api_recall tool */
export const ApiRecallParamsSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(1000, 'Query must be 1000 characters or less'),
  limit: z.number().int().min(1).max(50).optional(),
  memory_kind: z.enum(['overview', 'tag_group', 'operation']).optional(),
  api_source_id: z.string().uuid('api_source_id must be a valid UUID').optional(),
  tags: z.array(z.string().min(1).max(100)).max(20).optional(),
});
export type ApiRecallParams = z.infer<typeof ApiRecallParamsSchema>;

/** Successful tool result */
export interface ApiRecallSuccess {
  success: true;
  data: {
    content: string;
    details: {
      count: number;
      results: ApiMemorySearchResultResponse[];
      user_id: string;
    };
  };
}

/** Failed tool result */
export interface ApiRecallFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type ApiRecallResult = ApiRecallSuccess | ApiRecallFailure;

/** Tool configuration */
export interface ApiRecallToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tool definition */
export interface ApiRecallTool {
  name: string;
  description: string;
  parameters: typeof ApiRecallParamsSchema;
  execute: (params: ApiRecallParams) => Promise<ApiRecallResult>;
}

/**
 * Format search results into a human-readable summary.
 */
function formatResults(results: ApiMemorySearchResultResponse[]): string {
  if (results.length === 0) {
    return 'No matching API operations found.';
  }

  const lines = [`Found ${results.length} matching API operation(s):`];

  for (const r of results) {
    const tags = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : '';
    lines.push(`- ${r.title}${tags} (score: ${r.score.toFixed(2)})`);
  }

  return lines.join('\n');
}

/**
 * Creates the api_recall tool.
 */
export function createApiRecallTool(options: ApiRecallToolOptions): ApiRecallTool {
  const { client, logger, user_id } = options;
  const service = new ApiSourceService(client);

  return {
    name: 'api_recall',
    description:
      'Search through onboarded API memories to find endpoints, operations, and capabilities. ' +
      'Returns operation details including method, path, parameters, and credentials. ' +
      'Use this when you need to find how to call an API.',
    parameters: ApiRecallParamsSchema,

    async execute(params: ApiRecallParams): Promise<ApiRecallResult> {
      const parseResult = ApiRecallParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, limit = 10, memory_kind, api_source_id, tags } = parseResult.data;

      logger.info('api_recall invoked', {
        user_id,
        query,
        limit,
        memory_kind,
        api_source_id,
      });

      try {
        const response = await service.search(
          { q: query, limit, memory_kind, api_source_id, tags },
          { user_id },
        );

        if (!response.success) {
          logger.error('api_recall API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search API memories',
          };
        }

        const results: ApiMemorySearchResultResponse[] = response.data.data;
        const content = formatResults(results);

        logger.debug('api_recall completed', {
          user_id,
          resultCount: results.length,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              count: results.length,
              results,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('api_recall failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: sanitizeErrorMessage(error),
        };
      }
    },
  };
}
