/**
 * api_credential_manage tool implementation.
 * Add, update, or remove credentials for an onboarded API source.
 * Part of API Onboarding feature (#1785).
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { ApiSourceService } from '../services/api-source-service.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for api_credential_manage tool */
export const ApiCredentialManageParamsSchema = z.object({
  api_source_id: z.string().uuid('api_source_id must be a valid UUID'),
  action: z.enum(['add', 'update', 'remove']),
  credential_id: z.string().uuid('credential_id must be a valid UUID').optional(),
  header_name: z.string().min(1).optional(),
  header_prefix: z.string().optional(),
  resolve_strategy: z.enum(['literal', 'env', 'file', 'command']).optional(),
  resolve_reference: z.string().min(1).optional(),
  purpose: z.enum(['api_call', 'spec_fetch']).optional(),
}).refine((data) => {
  if (data.action === 'add') {
    return !!data.header_name && !!data.resolve_strategy && !!data.resolve_reference;
  }
  if (data.action === 'update' || data.action === 'remove') {
    return !!data.credential_id;
  }
  return true;
}, {
  message: 'add requires header_name, resolve_strategy, resolve_reference; update/remove requires credential_id',
});
export type ApiCredentialManageParams = z.infer<typeof ApiCredentialManageParamsSchema>;

export interface ApiCredentialManageSuccess {
  success: true;
  data: {
    content: string;
    details: Record<string, unknown>;
  };
}

export interface ApiCredentialManageFailure {
  success: false;
  error: string;
}

export type ApiCredentialManageResult = ApiCredentialManageSuccess | ApiCredentialManageFailure;

export interface ApiCredentialManageToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

export interface ApiCredentialManageTool {
  name: string;
  description: string;
  parameters: typeof ApiCredentialManageParamsSchema;
  execute: (params: ApiCredentialManageParams) => Promise<ApiCredentialManageResult>;
}

export function createApiCredentialManageTool(options: ApiCredentialManageToolOptions): ApiCredentialManageTool {
  const { client, logger, user_id } = options;
  const service = new ApiSourceService(client);

  return {
    name: 'api_credential_manage',
    description:
      'Manage credentials for an onboarded API source. ' +
      'Actions: add (new credential), update (change existing), remove (delete). ' +
      'Credentials define how to authenticate API calls (header name, prefix, resolve strategy).',
    parameters: ApiCredentialManageParamsSchema,

    async execute(params: ApiCredentialManageParams): Promise<ApiCredentialManageResult> {
      const parseResult = ApiCredentialManageParamsSchema.safeParse(params);
      if (!parseResult.success) {
        return { success: false, error: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }

      const { api_source_id, action, credential_id, header_name, header_prefix, resolve_strategy, resolve_reference, purpose } = parseResult.data;

      logger.info('api_credential_manage invoked', { user_id, api_source_id, action });

      try {
        const response = await service.manageCredential(
          api_source_id,
          { action, credential_id, header_name, header_prefix, resolve_strategy, resolve_reference, purpose },
          { user_id },
        );

        if (!response.success) {
          return { success: false, error: response.error.message || `Failed to ${action} credential` };
        }

        const content =
          action === 'add' ? `Added credential "${header_name}" to API source.` :
          action === 'update' ? `Updated credential ${credential_id}.` :
          `Removed credential ${credential_id}.`;

        return {
          success: true,
          data: {
            content,
            details: response.data && typeof response.data === 'object' && 'data' in response.data
              ? (response.data as { data: Record<string, unknown> }).data
              : {},
          },
        };
      } catch (error) {
        logger.error('api_credential_manage failed', { user_id, error: error instanceof Error ? error.message : String(error) });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
