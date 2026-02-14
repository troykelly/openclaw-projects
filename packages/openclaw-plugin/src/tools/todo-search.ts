/**
 * todo_search tool implementation.
 * Provides semantic search through work items (todos and projects).
 * Uses the unified search API with work_item type filter.
 *
 * Part of Issue #1216.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for todo_search tool */
export const TodoSearchParamsSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(1000, 'Query must be 1000 characters or less'),
  limit: z.number().int().min(1).max(50).optional(),
  kind: z.enum(['task', 'project', 'initiative', 'epic', 'issue']).optional(),
  status: z.string().max(50).optional(),
});
export type TodoSearchParams = z.infer<typeof TodoSearchParamsSchema>;

/** Search result item */
export interface TodoSearchItem {
  id: string;
  title: string;
  snippet: string;
  score: number;
  kind?: string;
  status?: string;
}

/** Successful search result */
export interface TodoSearchSuccess {
  success: true;
  data: {
    content: string;
    details: {
      count: number;
      results: TodoSearchItem[];
      searchType: string;
      userId: string;
    };
  };
}

/** Failed result */
export interface TodoSearchFailure {
  success: false;
  error: string;
}

export type TodoSearchResult = TodoSearchSuccess | TodoSearchFailure;

/** Tool configuration */
export interface TodoSearchToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface TodoSearchTool {
  name: string;
  description: string;
  parameters: typeof TodoSearchParamsSchema;
  execute: (params: TodoSearchParams) => Promise<TodoSearchResult>;
}

/**
 * Sanitize query input to prevent injection and remove control characters.
 */
function sanitizeQuery(query: string): string {
  return query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Creates the todo_search tool.
 */
export function createTodoSearchTool(options: TodoSearchToolOptions): TodoSearchTool {
  const { client, logger, userId } = options;

  return {
    name: 'todo_search',
    description:
      'Search todos and work items by natural language query. Uses semantic and text search to find relevant items. ' +
      'Optionally filter by kind (task, project, initiative, epic, issue) or status.',
    parameters: TodoSearchParamsSchema,

    async execute(params: TodoSearchParams): Promise<TodoSearchResult> {
      const parseResult = TodoSearchParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, limit = 10, kind, status } = parseResult.data;

      const sanitizedQuery = sanitizeQuery(query);
      if (sanitizedQuery.length === 0) {
        return { success: false, error: 'Query cannot be empty after sanitization' };
      }

      logger.info('todo_search invoked', {
        userId,
        queryLength: sanitizedQuery.length,
        limit,
        kind: kind ?? 'all',
        status: status ?? 'all',
      });

      try {
        const queryParams = new URLSearchParams({
          q: sanitizedQuery,
          types: 'work_item',
          limit: String(limit),
          semantic: 'true',
        });

        const response = await client.get<{
          results: Array<{
            id: string;
            title: string;
            snippet: string;
            score: number;
            type: string;
            metadata?: { kind?: string; status?: string };
          }>;
          search_type: string;
          total: number;
        }>(`/api/search?${queryParams.toString()}`, { userId });

        if (!response.success) {
          logger.error('todo_search API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search work items',
          };
        }

        let results = response.data.results ?? [];

        // Client-side filtering by kind and status if specified
        if (kind) {
          results = results.filter((r) => r.metadata?.kind === kind);
        }
        if (status) {
          results = results.filter((r) => r.metadata?.status === status);
        }

        const items: TodoSearchItem[] = results.map((r) => ({
          id: r.id,
          title: r.title,
          snippet: r.snippet,
          score: r.score,
          kind: r.metadata?.kind,
          status: r.metadata?.status,
        }));

        if (items.length === 0) {
          return {
            success: true,
            data: {
              content: 'No matching work items found.',
              details: {
                count: 0,
                results: [],
                searchType: response.data.search_type,
                userId,
              },
            },
          };
        }

        const content = items
          .map((item) => {
            const kindStr = item.kind ? `[${item.kind}]` : '';
            const statusStr = item.status ? ` (${item.status})` : '';
            const snippetStr = item.snippet ? ` - ${item.snippet}` : '';
            return `- ${kindStr} **${item.title}**${statusStr}${snippetStr}`;
          })
          .join('\n');

        logger.debug('todo_search completed', {
          userId,
          resultCount: items.length,
          searchType: response.data.search_type,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              count: items.length,
              results: items,
              searchType: response.data.search_type,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('todo_search failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
