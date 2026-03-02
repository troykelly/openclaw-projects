/**
 * Dev session search tool.
 * Issue #1987 — Provides semantic search across dev sessions.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** UUID validation regex */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format.
 */
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Sanitize query input.
 */
function sanitizeQuery(query: string): string {
  return query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

// ==================== Shared Types ====================

/** Tool configuration */
export interface DevSessionSearchToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Dev session search result from API */
export interface DevSessionSearchItem {
  id: string;
  session_name: string;
  status: string;
  node: string;
  task_summary?: string | null;
  task_prompt?: string | null;
  completion_summary?: string | null;
  branch?: string | null;
  repo_org?: string | null;
  repo_name?: string | null;
  similarity?: number;
  match_source?: string;
  created_at?: string;
  completed_at?: string | null;
}

/** Failure result */
export interface DevSessionSearchFailure {
  success: false;
  error: string;
}

// ==================== dev_session_search ====================

/** Parameters for dev_session_search */
export const DevSessionSearchParamsSchema = z.object({
  query: z.string().min(1, 'Search query is required').max(500, 'Query must be 500 characters or less'),
  status: z.string().max(50).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type DevSessionSearchParams = z.infer<typeof DevSessionSearchParamsSchema>;

/** Successful search result */
export interface DevSessionSearchSuccess {
  success: true;
  data: {
    content: string;
    details: {
      sessions: DevSessionSearchItem[];
      total: number;
      user_id: string;
    };
  };
}

export type DevSessionSearchResult = DevSessionSearchSuccess | DevSessionSearchFailure;

export interface DevSessionSearchTool {
  name: string;
  description: string;
  parameters: typeof DevSessionSearchParamsSchema;
  execute: (params: DevSessionSearchParams) => Promise<DevSessionSearchResult>;
}

/**
 * Creates the dev_session_search tool.
 */
export function createDevSessionSearchTool(options: DevSessionSearchToolOptions): DevSessionSearchTool {
  const { client, logger, user_id } = options;

  return {
    name: 'dev_session_search',
    description: 'Searches dev sessions semantically by task summary, prompt, and completion notes. Use to find past coding sessions by topic or context. For cross-entity search, prefer context_search. Read-only.',
    parameters: DevSessionSearchParamsSchema,

    async execute(params: DevSessionSearchParams): Promise<DevSessionSearchResult> {
      const parseResult = DevSessionSearchParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, status, limit = 10 } = parseResult.data;

      const sanitizedQuery = sanitizeQuery(query);
      if (sanitizedQuery.length === 0) {
        return { success: false, error: 'Search query cannot be empty' };
      }

      logger.info('dev_session_search invoked', {
        user_id,
        queryLength: sanitizedQuery.length,
        status,
        limit,
      });

      try {
        const queryParams = new URLSearchParams({
          q: sanitizedQuery,
          limit: String(limit),
        });
        if (status) queryParams.set('status', status);

        const response = await client.get<{ items?: DevSessionSearchItem[]; total?: number; search_mode?: string }>(
          `/dev-sessions/search?${queryParams.toString()}`,
          { user_id, user_email: user_id },
        );

        if (!response.success) {
          logger.error('dev_session_search API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to search dev sessions' };
        }

        const sessions = response.data.items ?? [];
        const total = response.data.total ?? sessions.length;

        if (sessions.length === 0) {
          return {
            success: true,
            data: {
              content: 'No matching dev sessions found.',
              details: { sessions: [], total: 0, user_id },
            },
          };
        }

        const content = sessions
          .map((s) => {
            const parts = [`**${s.session_name}** [${s.status}]`];
            if (s.node) parts.push(`on ${s.node}`);
            if (s.branch) parts.push(`branch: ${s.branch}`);
            if (s.repo_org && s.repo_name) parts.push(`repo: ${s.repo_org}/${s.repo_name}`);
            if (s.similarity !== undefined) parts.push(`(${(Number(s.similarity) * 100).toFixed(0)}% match)`);
            if (s.task_summary) parts.push(`\n  Task: ${s.task_summary.substring(0, 200)}${s.task_summary.length > 200 ? '...' : ''}`);
            if (s.completion_summary) parts.push(`\n  Completed: ${s.completion_summary.substring(0, 200)}${s.completion_summary.length > 200 ? '...' : ''}`);
            return `- ${parts.join(' ')} (ID: ${s.id})`;
          })
          .join('\n\n');

        logger.debug('dev_session_search completed', { user_id, count: sessions.length });

        return {
          success: true,
          data: {
            content,
            details: { sessions, total, user_id },
          },
        };
      } catch (error) {
        logger.error('dev_session_search failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
