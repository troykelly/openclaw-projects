/**
 * api_onboard tool implementation.
 * Onboards a new API by providing its OpenAPI spec URL or inline content.
 * Part of API Onboarding feature (#1784).
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { ApiSourceService, type OnboardResultResponse } from '../services/api-source-service.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for api_onboard tool */
export const ApiOnboardParamsSchema = z.object({
  spec_url: z.string().url('spec_url must be a valid URL').optional(),
  spec_content: z.string().min(1, 'spec_content cannot be empty').optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(100)).max(20).optional(),
  credentials: z.array(z.object({
    header_name: z.string().min(1),
    header_prefix: z.string().optional(),
    resolve_strategy: z.enum(['literal', 'env', 'file', 'command']),
    resolve_reference: z.string().min(1),
    purpose: z.enum(['api_call', 'spec_fetch']).optional(),
  })).optional(),
  spec_auth_headers: z.record(z.string()).optional(),
}).refine((data) => data.spec_url || data.spec_content, {
  message: 'Either spec_url or spec_content is required',
});
export type ApiOnboardParams = z.infer<typeof ApiOnboardParamsSchema>;

/** Successful tool result */
export interface ApiOnboardSuccess {
  success: true;
  data: {
    content: string;
    details: {
      api_source_id: string;
      name: string;
      memories_created: number;
      memories_updated: number;
      memories_deleted: number;
    };
  };
}

/** Failed tool result */
export interface ApiOnboardFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type ApiOnboardResult = ApiOnboardSuccess | ApiOnboardFailure;

/** Tool configuration */
export interface ApiOnboardToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tool definition */
export interface ApiOnboardTool {
  name: string;
  description: string;
  parameters: typeof ApiOnboardParamsSchema;
  execute: (params: ApiOnboardParams) => Promise<ApiOnboardResult>;
}

/**
 * Creates the api_onboard tool.
 */
export function createApiOnboardTool(options: ApiOnboardToolOptions): ApiOnboardTool {
  const { client, logger, user_id } = options;
  const service = new ApiSourceService(client);

  return {
    name: 'api_onboard',
    description:
      'Onboard a new API by providing its OpenAPI specification URL or inline spec content. ' +
      'Parses the spec, decomposes it into searchable memories, and optionally stores credentials. ' +
      'Use this when you need to teach the system about a new API.',
    parameters: ApiOnboardParamsSchema,

    async execute(params: ApiOnboardParams): Promise<ApiOnboardResult> {
      const parseResult = ApiOnboardParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      logger.info('api_onboard invoked', {
        user_id,
        spec_url: parseResult.data.spec_url,
        has_spec_content: !!parseResult.data.spec_content,
        credential_count: parseResult.data.credentials?.length ?? 0,
      });

      try {
        const response = await service.onboard(
          {
            spec_url: parseResult.data.spec_url,
            spec_content: parseResult.data.spec_content,
            name: parseResult.data.name,
            description: parseResult.data.description,
            tags: parseResult.data.tags,
            credentials: parseResult.data.credentials,
            spec_auth_headers: parseResult.data.spec_auth_headers,
          },
          { user_id },
        );

        if (!response.success) {
          logger.error('api_onboard API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to onboard API',
          };
        }

        const result: OnboardResultResponse = response.data.data;

        const content =
          `Onboarded API "${result.api_source.name}" — ` +
          `${result.memories_created} memories created, ` +
          `${result.memories_updated} updated, ` +
          `${result.memories_deleted} deleted.`;

        logger.debug('api_onboard completed', {
          user_id,
          api_source_id: result.api_source.id,
          memories_created: result.memories_created,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              api_source_id: result.api_source.id,
              name: result.api_source.name,
              memories_created: result.memories_created,
              memories_updated: result.memories_updated,
              memories_deleted: result.memories_deleted,
            },
          },
        };
      } catch (error) {
        logger.error('api_onboard failed', {
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
