/**
 * message_search tool implementation.
 * Searches message history semantically using pgvector embeddings.
 */

import { z } from 'zod'
import type { ApiClient } from '../api-client.js'
import type { Logger } from '../logger.js'
import type { PluginConfig } from '../config.js'

/** Channel type enum */
const ChannelType = z.enum(['sms', 'email', 'all'])
type ChannelType = z.infer<typeof ChannelType>

/** Maximum results limit */
const MAX_LIMIT = 100

/** Default results limit */
const DEFAULT_LIMIT = 10

/** Parameters for message_search tool */
export const MessageSearchParamsSchema = z.object({
  query: z
    .string()
    .min(1, 'Search query cannot be empty'),
  channel: ChannelType.default('all'),
  contactId: z.string().uuid().optional(),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(MAX_LIMIT, `Limit must be ${MAX_LIMIT} or less`)
    .default(DEFAULT_LIMIT),
  includeThread: z.boolean().default(false),
})
export type MessageSearchParams = z.infer<typeof MessageSearchParamsSchema>

/** Message search result from API */
interface MessageSearchApiResult {
  id: string
  body: string
  direction: 'inbound' | 'outbound'
  channel: string
  contactName?: string
  timestamp: string
  score: number
  threadId?: string
  threadMessages?: Array<{
    id: string
    body: string
    direction: 'inbound' | 'outbound'
    timestamp: string
  }>
}

/** API response for message search */
interface MessageSearchApiResponse {
  results: MessageSearchApiResult[]
  total: number
}

/** Message result for tool output */
interface MessageResult {
  id: string
  body: string
  direction: 'inbound' | 'outbound'
  channel: string
  contactName?: string
  timestamp: string
  similarity: number
  threadId?: string
  threadContext?: Array<{
    id: string
    body: string
    direction: string
    timestamp: string
  }>
}

/** Successful tool result */
export interface MessageSearchSuccess {
  success: true
  data: {
    content: string
    details: {
      messages: MessageResult[]
      total: number
      userId: string
    }
  }
}

/** Failed tool result */
export interface MessageSearchFailure {
  success: false
  error: string
}

/** Tool result type */
export type MessageSearchResult = MessageSearchSuccess | MessageSearchFailure

/** Tool configuration */
export interface MessageSearchToolOptions {
  client: ApiClient
  logger: Logger
  config: PluginConfig
  userId: string
}

/** Tool definition */
export interface MessageSearchTool {
  name: string
  description: string
  parameters: typeof MessageSearchParamsSchema
  execute: (params: MessageSearchParams) => Promise<MessageSearchResult>
}

/**
 * Creates the message_search tool.
 */
export function createMessageSearchTool(options: MessageSearchToolOptions): MessageSearchTool {
  const { client, logger, userId } = options

  return {
    name: 'message_search',
    description:
      'Search message history semantically. Use when you need to find past conversations, ' +
      'messages about specific topics, or communications with contacts. ' +
      'Supports filtering by channel (SMS/email) and contact.',
    parameters: MessageSearchParamsSchema,

    async execute(params: MessageSearchParams): Promise<MessageSearchResult> {
      // Validate parameters
      const parseResult = MessageSearchParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const { query, channel, contactId, limit, includeThread } = parseResult.data

      // Log invocation
      logger.info('message_search invoked', {
        userId,
        queryLength: query.length,
        channel,
        hasContactId: !!contactId,
        limit,
        includeThread,
      })

      try {
        // Build query parameters
        const queryParams = new URLSearchParams()
        queryParams.set('q', query)
        queryParams.set('types', 'message')
        queryParams.set('limit', String(limit))

        if (channel !== 'all') {
          queryParams.set('channel', channel)
        }
        if (contactId) {
          queryParams.set('contactId', contactId)
        }
        if (includeThread) {
          queryParams.set('includeThread', 'true')
        }

        // Call API
        const response = await client.get<MessageSearchApiResponse>(
          `/api/search?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          logger.error('message_search API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to search messages',
          }
        }

        const { results, total } = response.data

        // Transform results
        const messages: MessageResult[] = results.map((r) => ({
          id: r.id,
          body: r.body,
          direction: r.direction,
          channel: r.channel,
          contactName: r.contactName,
          timestamp: r.timestamp,
          similarity: r.score,
          threadId: r.threadId,
          threadContext: r.threadMessages,
        }))

        logger.debug('message_search completed', {
          userId,
          resultCount: messages.length,
          total,
        })

        // Format content for display
        const content = messages.length > 0
          ? messages.map((m) => {
              const prefix = m.direction === 'inbound' ? '←' : '→'
              const contact = m.contactName || 'Unknown'
              const similarity = `(${Math.round(m.similarity * 100)}%)`
              return `${prefix} [${m.channel}] ${contact} ${similarity}: ${m.body.substring(0, 100)}${m.body.length > 100 ? '...' : ''}`
            }).join('\n')
          : 'No messages found matching your query.'

        return {
          success: true,
          data: {
            content,
            details: {
              messages,
              total,
              userId,
            },
          },
        }
      } catch (error) {
        logger.error('message_search failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while searching messages.',
        }
      }
    },
  }
}
