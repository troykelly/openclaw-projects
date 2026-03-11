/**
 * memory_list tool implementation.
 * Provides browsing and pagination of stored memories.
 * Created for Issue #2377.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { MemoryCategory, TemporalPeriod } from './memory-recall.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Sort direction for memory listing */
export const SortDirection = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof SortDirection>;

/** Sort field for memory listing */
export const SortField = z.enum(['created_at', 'updated_at']);
export type SortField = z.infer<typeof SortField>;

/** Parameters for memory_list tool */
export const MemoryListParamsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  category: MemoryCategory.optional(),
  tags: z.array(z.string().min(1).max(100)).max(20, 'Maximum 20 tags per filter').optional(),
  since: z.string().max(100, 'since must be 100 characters or less').optional(),
  before: z.string().max(100, 'before must be 100 characters or less').optional(),
  period: TemporalPeriod.optional(),
  sort: SortField.optional(),
  sort_direction: SortDirection.optional(),
}).refine(
  (data) => !(data.period && (data.since || data.before)),
  { message: 'period is mutually exclusive with since/before' },
);
export type MemoryListParams = z.infer<typeof MemoryListParamsSchema>;

/** Memory item in list response */
export interface MemoryListItem {
  id: string;
  content: string;
  category: string;
  tags?: string[];
  importance?: number;
  created_at?: string;
  updated_at?: string;
}

/** Successful tool result */
export interface MemoryListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      count: number;
      total: number;
      offset: number;
      memories: MemoryListItem[];
      user_id: string;
    };
  };
}

/** Failed tool result */
export interface MemoryListFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryListResult = MemoryListSuccess | MemoryListFailure;

/** Tool configuration */
export interface MemoryListToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tool definition */
export interface MemoryListTool {
  name: string;
  description: string;
  parameters: typeof MemoryListParamsSchema;
  execute: (params: MemoryListParams) => Promise<MemoryListResult>;
}

/**
 * Format memories as a bullet list with timestamps.
 */
function formatMemoriesAsText(memories: MemoryListItem[], total: number, offset: number): string {
  if (memories.length === 0) {
    return 'No memories found.';
  }

  const header = `Showing ${offset + 1}-${offset + memories.length} of ${total} memories:\n`;
  const lines = memories.map((m) => {
    const tagSuffix = m.tags && m.tags.length > 0 ? ` {${m.tags.join(', ')}}` : '';
    const timestamp = m.created_at ? ` (${m.created_at})` : '';
    return `- [${m.category}] (id: ${m.id})${tagSuffix} ${m.content}${timestamp}`;
  });

  return header + lines.join('\n');
}

/**
 * Creates the memory_list tool.
 */
export function createMemoryListTool(options: MemoryListToolOptions): MemoryListTool {
  const { client, logger, user_id } = options;

  return {
    name: 'memory_list',
    description:
      'Browse and paginate through stored memories. Use when you need to enumerate, audit, or inventory memories without a specific search query. Supports filtering by category, tags, and time range. Use offset/limit for pagination.',
    parameters: MemoryListParamsSchema,

    async execute(params: MemoryListParams): Promise<MemoryListResult> {
      // Validate parameters
      const parseResult = MemoryListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { limit = 20, offset = 0, category, tags, since, before, period, sort, sort_direction } = parseResult.data;

      // Log invocation
      logger.info('memory_list invoked', {
        user_id,
        limit,
        offset,
        category: category ?? 'all',
        tags: tags ?? [],
      });

      try {
        // Build API URL
        const queryParams = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
        });
        if (category) {
          const memory_type = category === 'other' ? 'note' : category;
          queryParams.set('memory_type', memory_type);
        }
        if (tags && tags.length > 0) {
          queryParams.set('tags', tags.join(','));
        }
        if (since) {
          queryParams.set('since', since);
        }
        if (before) {
          queryParams.set('before', before);
        }
        if (period) {
          queryParams.set('period', period);
        }
        if (sort) {
          queryParams.set('sort', sort);
        }
        if (sort_direction) {
          queryParams.set('sort_direction', sort_direction);
        }

        const path = `/memories/unified?${queryParams.toString()}`;

        // Call API
        const response = await client.get<{
          memories: Array<{
            id: string;
            content: string;
            type?: string;
            memory_type?: string;
            tags?: string[];
            importance?: number;
            created_at?: string;
            updated_at?: string;
          }>;
          total: number;
        }>(path, { user_id });

        if (!response.success) {
          logger.error('memory_list API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to list memories',
          };
        }

        const rawMemories = response.data.memories ?? [];
        const total = response.data.total ?? rawMemories.length;

        // Map API field names to plugin interface
        // API returns both `type` and `memory_type`; prefer `type` but fall back to `memory_type`
        const memories: MemoryListItem[] = rawMemories.map((m) => {
          const apiType = m.type ?? m.memory_type ?? 'note';
          return {
            id: m.id,
            content: m.content,
            category: apiType === 'note' ? 'other' : apiType,
            tags: m.tags,
            importance: m.importance,
            created_at: m.created_at,
            updated_at: m.updated_at,
          };
        });

        // Format response
        const content = formatMemoriesAsText(memories, total, offset);

        logger.debug('memory_list completed', {
          user_id,
          resultCount: memories.length,
          total,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              count: memories.length,
              total,
              offset,
              memories,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('memory_list failed', {
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
