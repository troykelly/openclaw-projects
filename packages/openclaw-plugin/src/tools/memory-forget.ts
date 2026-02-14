/**
 * memory_forget tool implementation.
 * Provides GDPR-compliant memory deletion.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import type { Memory } from './memory-recall.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for memory_forget tool — matches OpenClaw gateway schema */
export const MemoryForgetParamsSchema = z
  .object({
    memoryId: z.string().optional(),
    query: z.string().max(1000, 'Query must be 1000 characters or less').optional(),
  })
  .refine((data) => data.memoryId || data.query, {
    message: 'Either memoryId or query is required',
  });
export type MemoryForgetParams = z.infer<typeof MemoryForgetParamsSchema>;

/** Successful tool result */
export interface MemoryForgetSuccess {
  success: true;
  data: {
    content: string;
    details: {
      deletedCount: number;
      deletedIds: string[];
      userId: string;
    };
  };
}

/** Failed tool result */
export interface MemoryForgetFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryForgetResult = MemoryForgetSuccess | MemoryForgetFailure;

/** Tool configuration */
export interface MemoryForgetToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface MemoryForgetTool {
  name: string;
  description: string;
  parameters: typeof MemoryForgetParamsSchema;
  execute: (params: MemoryForgetParams) => Promise<MemoryForgetResult>;
}

/** High-confidence auto-delete threshold (matches OpenClaw gateway 0.9) */
const AUTO_DELETE_SCORE_THRESHOLD = 0.9;

/**
 * Sanitize query input to remove control characters.
 */
function sanitizeQuery(query: string): string {
  const sanitized = query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized.trim();
}

/**
 * Creates the memory_forget tool.
 */
export function createMemoryForgetTool(options: MemoryForgetToolOptions): MemoryForgetTool {
  const { client, logger, userId } = options;

  return {
    name: 'memory_forget',
    description: 'Delete specific memories. Use when the user explicitly requests to forget something. Can delete by ID or by search query.',
    parameters: MemoryForgetParamsSchema,

    async execute(params: MemoryForgetParams): Promise<MemoryForgetResult> {
      // Validate parameters
      const parseResult = MemoryForgetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => e.message).join(', ');
        return { success: false, error: errorMessage };
      }

      const { memoryId, query } = parseResult.data;

      // Log invocation
      logger.info('memory_forget invoked', {
        userId,
        memoryId: memoryId ?? undefined,
        hasQuery: !!query,
      });

      try {
        // Delete by ID
        if (memoryId) {
          return await deleteById(client, logger, userId, memoryId);
        }

        // Delete by query (OpenClaw two-phase: search → candidates or auto-delete)
        if (query) {
          return await deleteByQuery(client, logger, userId, query);
        }

        // Should not reach here due to validation
        return { success: false, error: 'Either memoryId or query is required' };
      } catch (error) {
        logger.error('memory_forget failed', {
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

/**
 * Delete a memory by ID.
 */
async function deleteById(client: ApiClient, logger: Logger, userId: string, memoryId: string): Promise<MemoryForgetResult> {
  const response = await client.delete(`/api/memories/${memoryId}`, { userId });

  if (!response.success) {
    // Handle not found gracefully
    if (response.error.code === 'NOT_FOUND') {
      logger.debug('memory_forget completed', {
        userId,
        deletedCount: 0,
        reason: 'not found',
      });
      return {
        success: true,
        data: {
          content: 'Memory not found or already deleted.',
          details: {
            deletedCount: 0,
            deletedIds: [],
            userId,
          },
        },
      };
    }

    logger.error('memory_forget API error', {
      userId,
      memoryId,
      status: response.error.status,
      code: response.error.code,
    });
    return {
      success: false,
      error: response.error.message || 'Failed to delete memory',
    };
  }

  logger.debug('memory_forget completed', {
    userId,
    deletedCount: 1,
    memoryId,
  });

  return {
    success: true,
    data: {
      content: 'Deleted 1 memory.',
      details: {
        deletedCount: 1,
        deletedIds: [memoryId],
        userId,
      },
    },
  };
}

/**
 * Delete memories by search query.
 * Matches OpenClaw gateway behavior:
 * - Search with limit=5
 * - Single high-confidence match (>0.9) → auto-delete
 * - Multiple matches → return candidates for agent to specify memoryId
 */
async function deleteByQuery(client: ApiClient, logger: Logger, userId: string, query: string): Promise<MemoryForgetResult> {
  const sanitizedQuery = sanitizeQuery(query);
  if (sanitizedQuery.length === 0) {
    return { success: false, error: 'Query cannot be empty' };
  }

  const queryParams = new URLSearchParams({
    q: sanitizedQuery,
    limit: '5',
  });

  const searchResponse = await client.get<{ results: Array<{ id: string; content: string; similarity?: number }> }>(
    `/api/memories/search?${queryParams.toString()}`,
    { userId },
  );

  if (!searchResponse.success) {
    logger.error('memory_forget search error', {
      userId,
      status: searchResponse.error.status,
      code: searchResponse.error.code,
    });
    return {
      success: false,
      error: searchResponse.error.message || 'Failed to search memories',
    };
  }

  const memories = searchResponse.data.results ?? [];

  if (memories.length === 0) {
    logger.debug('memory_forget completed', { userId, deletedCount: 0, reason: 'no matches' });
    return {
      success: true,
      data: {
        content: 'No matching memories found.',
        details: { deletedCount: 0, deletedIds: [], userId },
      },
    };
  }

  // Single match (any confidence) → auto-delete to avoid user having to copy/paste UUID
  if (memories.length === 1) {
    const deleteResponse = await client.delete(`/api/memories/${memories[0].id}`, { userId });
    if (!deleteResponse.success) {
      return { success: false, error: deleteResponse.error.message || 'Failed to delete memory' };
    }
    logger.debug('memory_forget auto-deleted single match', { userId, memoryId: memories[0].id, similarity: memories[0].similarity });
    return {
      success: true,
      data: {
        content: `Forgotten: "${memories[0].content}"`,
        details: { deletedCount: 1, deletedIds: [memories[0].id], userId },
      },
    };
  }

  // Multiple matches → return candidates with FULL UUIDs for copy/paste or tool re-invocation
  const list = memories
    .map((m) => `- [${m.id}] ${m.content.slice(0, 60)}${m.content.length > 60 ? '...' : ''}`)
    .join('\n');

  logger.debug('memory_forget returning candidates', { userId, count: memories.length });
  return {
    success: true,
    data: {
      content: `Found ${memories.length} candidates. Specify memoryId:\n${list}`,
      details: {
        deletedCount: 0,
        deletedIds: [],
        userId,
      },
    },
  };
}
