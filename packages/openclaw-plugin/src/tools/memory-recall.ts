/**
 * memory_recall tool implementation.
 * Provides semantic search through stored memories.
 * Tags filtering support added in Issue #492.
 * Relationship scope filtering added in Issue #493.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Memory categories for filtering */
export const MemoryCategory = z.enum(['preference', 'fact', 'decision', 'context', 'other']);
export type MemoryCategory = z.infer<typeof MemoryCategory>;

/** Parameters for memory_recall tool */
export const MemoryRecallParamsSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(1000, 'Query must be 1000 characters or less'),
  limit: z.number().int().min(1).max(20).optional(),
  category: MemoryCategory.optional(),
  tags: z.array(z.string().min(1).max(100)).max(20, 'Maximum 20 tags per filter').optional(),
  relationship_id: z.string().uuid('relationship_id must be a valid UUID').optional(),
});
export type MemoryRecallParams = z.infer<typeof MemoryRecallParamsSchema>;

/** Memory item returned from API */
export interface Memory {
  id: string;
  content: string;
  category: string;
  tags?: string[];
  score?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Successful tool result */
export interface MemoryRecallSuccess {
  success: true;
  data: {
    content: string;
    details: {
      count: number;
      memories: Memory[];
      userId: string;
    };
  };
}

/** Failed tool result */
export interface MemoryRecallFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryRecallResult = MemoryRecallSuccess | MemoryRecallFailure;

/** Tool configuration */
export interface MemoryRecallToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface MemoryRecallTool {
  name: string;
  description: string;
  parameters: typeof MemoryRecallParamsSchema;
  execute: (params: MemoryRecallParams) => Promise<MemoryRecallResult>;
}

/**
 * Sanitize query input to prevent injection and remove control characters.
 */
function sanitizeQuery(query: string): string {
  // Remove control characters (ASCII 0-31 except tab, newline, carriage return)
  const sanitized = query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Trim whitespace
  return sanitized.trim();
}

/**
 * Format memories as a bullet list with category and tag annotations.
 */
function formatMemoriesAsText(memories: Memory[]): string {
  if (memories.length === 0) {
    return 'No relevant memories found.';
  }

  return memories
    .map((m) => {
      const tagSuffix = m.tags && m.tags.length > 0 ? ` {${m.tags.join(', ')}}` : '';
      return `- [${m.category}]${tagSuffix} ${m.content}`;
    })
    .join('\n');
}

/**
 * Creates the memory_recall tool.
 */
export function createMemoryRecallTool(options: MemoryRecallToolOptions): MemoryRecallTool {
  const { client, logger, config, userId } = options;

  return {
    name: 'memory_recall',
    description:
      'Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics. Optionally filter by tags for categorical queries (e.g., ["music", "food"]). Use relationship_id to scope search to a specific relationship between contacts.',
    parameters: MemoryRecallParamsSchema,

    async execute(params: MemoryRecallParams): Promise<MemoryRecallResult> {
      // Validate parameters
      const parseResult = MemoryRecallParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, limit = config.maxRecallMemories, category, tags, relationship_id } = parseResult.data;

      // Sanitize query
      const sanitizedQuery = sanitizeQuery(query);
      if (sanitizedQuery.length === 0) {
        return { success: false, error: 'Query cannot be empty after sanitization' };
      }

      // Log invocation (without query content for privacy)
      logger.info('memory_recall invoked', {
        userId,
        limit,
        category: category ?? 'all',
        tags: tags ?? [],
        queryLength: sanitizedQuery.length,
      });

      try {
        // Build API URL
        const queryParams = new URLSearchParams({
          q: sanitizedQuery,
          limit: String(limit),
        });
        if (category) {
          queryParams.set('memory_type', category);
        }
        if (tags && tags.length > 0) {
          queryParams.set('tags', tags.join(','));
        }
        if (relationship_id) {
          queryParams.set('relationship_id', relationship_id);
        }

        const path = `/api/memories/search?${queryParams.toString()}`;

        // Call API
        const response = await client.get<{ results: Array<{ id: string; content: string; type: string; tags?: string[]; similarity?: number; createdAt?: string; updatedAt?: string }>; search_type: string }>(path, { userId });

        if (!response.success) {
          logger.error('memory_recall API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search memories',
          };
        }

        const rawResults = response.data.results ?? [];

        // Map API field names to plugin Memory interface
        const memories: Memory[] = rawResults.map((m) => ({
          id: m.id,
          content: m.content,
          category: m.type,
          tags: m.tags,
          score: m.similarity,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        }));

        // Format response
        const content = formatMemoriesAsText(memories);

        logger.debug('memory_recall completed', {
          userId,
          resultCount: memories.length,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              count: memories.length,
              memories,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('memory_recall failed', {
          userId,
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
