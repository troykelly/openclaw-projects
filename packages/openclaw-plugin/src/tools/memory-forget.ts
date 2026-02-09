/**
 * memory_forget tool implementation.
 * Provides GDPR-compliant memory deletion.
 */

import { z } from 'zod'
import type { ApiClient } from '../api-client.js'
import type { Logger } from '../logger.js'
import type { PluginConfig } from '../config.js'
import type { Memory } from './memory-recall.js'

/** Parameters for memory_forget tool */
export const MemoryForgetParamsSchema = z
  .object({
    memoryId: z.string().optional(),
    query: z.string().max(1000, 'Query must be 1000 characters or less').optional(),
    confirmBulkDelete: z.boolean().optional(),
  })
  .refine((data) => data.memoryId || data.query, {
    message: 'Either memoryId or query is required',
  })
export type MemoryForgetParams = z.infer<typeof MemoryForgetParamsSchema>

/** Successful tool result */
export interface MemoryForgetSuccess {
  success: true
  data: {
    content: string
    details: {
      deletedCount: number
      deletedIds: string[]
      userId: string
    }
  }
}

/** Failed tool result */
export interface MemoryForgetFailure {
  success: false
  error: string
}

/** Tool result type */
export type MemoryForgetResult = MemoryForgetSuccess | MemoryForgetFailure

/** Tool configuration */
export interface MemoryForgetToolOptions {
  client: ApiClient
  logger: Logger
  config: PluginConfig
  userId: string
}

/** Tool definition */
export interface MemoryForgetTool {
  name: string
  description: string
  parameters: typeof MemoryForgetParamsSchema
  execute: (params: MemoryForgetParams) => Promise<MemoryForgetResult>
}

/** Bulk delete threshold */
const BULK_DELETE_THRESHOLD = 5

/**
 * Sanitize query input to remove control characters.
 */
function sanitizeQuery(query: string): string {
  const sanitized = query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  return sanitized.trim()
}

/**
 * Create a sanitized error message that doesn't expose internal details.
 */
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[host]')
      .replace(/:\d{2,5}\b/g, '')
      .replace(/\b(?:localhost|internal[-\w]*)\b/gi, '[internal]')

    if (message.includes('[internal]') || message.includes('[host]')) {
      return 'Failed to delete memory. Please try again.'
    }

    return message
  }
  return 'An unexpected error occurred while deleting memory.'
}

/**
 * Creates the memory_forget tool.
 */
export function createMemoryForgetTool(options: MemoryForgetToolOptions): MemoryForgetTool {
  const { client, logger, userId } = options

  return {
    name: 'memory_forget',
    description:
      'Delete specific memories. Use when the user explicitly requests to forget something. Can delete by ID or by search query.',
    parameters: MemoryForgetParamsSchema,

    async execute(params: MemoryForgetParams): Promise<MemoryForgetResult> {
      // Validate parameters
      const parseResult = MemoryForgetParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => e.message)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const { memoryId, query, confirmBulkDelete } = parseResult.data

      // Log invocation
      logger.info('memory_forget invoked', {
        userId,
        memoryId: memoryId ?? undefined,
        hasQuery: !!query,
      })

      try {
        // Delete by ID
        if (memoryId) {
          return await deleteById(client, logger, userId, memoryId)
        }

        // Delete by query
        if (query) {
          return await deleteByQuery(client, logger, userId, query, confirmBulkDelete)
        }

        // Should not reach here due to validation
        return { success: false, error: 'Either memoryId or query is required' }
      } catch (error) {
        logger.error('memory_forget failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })

        return {
          success: false,
          error: sanitizeErrorMessage(error),
        }
      }
    },
  }
}

/**
 * Delete a memory by ID.
 */
async function deleteById(
  client: ApiClient,
  logger: Logger,
  userId: string,
  memoryId: string
): Promise<MemoryForgetResult> {
  const response = await client.delete(`/api/memories/${memoryId}`, { userId })

  if (!response.success) {
    // Handle not found gracefully
    if (response.error.code === 'NOT_FOUND') {
      logger.debug('memory_forget completed', {
        userId,
        deletedCount: 0,
        reason: 'not found',
      })
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
      }
    }

    logger.error('memory_forget API error', {
      userId,
      memoryId,
      status: response.error.status,
      code: response.error.code,
    })
    return {
      success: false,
      error: response.error.message || 'Failed to delete memory',
    }
  }

  logger.debug('memory_forget completed', {
    userId,
    deletedCount: 1,
    memoryId,
  })

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
  }
}

/**
 * Delete memories by search query.
 */
async function deleteByQuery(
  client: ApiClient,
  logger: Logger,
  userId: string,
  query: string,
  confirmBulkDelete?: boolean
): Promise<MemoryForgetResult> {
  const sanitizedQuery = sanitizeQuery(query)
  if (sanitizedQuery.length === 0) {
    return { success: false, error: 'Query cannot be empty' }
  }

  // Search for matching memories
  const queryParams = new URLSearchParams({
    q: sanitizedQuery,
    limit: '100', // Max to find for deletion
  })

  const searchResponse = await client.get<{ memories: Memory[] }>(
    `/api/memories/search?${queryParams.toString()}`,
    { userId }
  )

  if (!searchResponse.success) {
    logger.error('memory_forget search error', {
      userId,
      status: searchResponse.error.status,
      code: searchResponse.error.code,
    })
    return {
      success: false,
      error: searchResponse.error.message || 'Failed to search memories',
    }
  }

  const memories = searchResponse.data.memories ?? []

  if (memories.length === 0) {
    logger.debug('memory_forget completed', {
      userId,
      deletedCount: 0,
      reason: 'no matches',
    })
    return {
      success: true,
      data: {
        content: 'No matching memories found to delete.',
        details: {
          deletedCount: 0,
          deletedIds: [],
          userId,
        },
      },
    }
  }

  // Check bulk delete threshold
  if (memories.length > BULK_DELETE_THRESHOLD && !confirmBulkDelete) {
    logger.warn('memory_forget bulk delete blocked', {
      userId,
      matchCount: memories.length,
    })
    return {
      success: false,
      error: `Found ${memories.length} matching memories. Set confirmBulkDelete: true to delete more than ${BULK_DELETE_THRESHOLD} memories at once.`,
    }
  }

  // Delete memories in parallel batches of 10
  const BATCH_SIZE = 10
  const deletedIds: string[] = []
  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    const batch = memories.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (memory) => {
        const deleteResponse = await client.delete(`/api/memories/${memory.id}`, { userId })
        return { id: memory.id, success: deleteResponse.success }
      })
    )
    for (const result of results) {
      if (result.success) {
        deletedIds.push(result.id)
      }
    }
  }

  logger.debug('memory_forget completed', {
    userId,
    deletedCount: deletedIds.length,
    requestedCount: memories.length,
  })

  return {
    success: true,
    data: {
      content: `Deleted ${deletedIds.length} ${deletedIds.length === 1 ? 'memory' : 'memories'}.`,
      details: {
        deletedCount: deletedIds.length,
        deletedIds,
        userId,
      },
    },
  }
}
