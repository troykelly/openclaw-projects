/**
 * Thread tools implementation.
 * Provides thread_list and thread_get tools for viewing message threads.
 */

import { z } from 'zod'
import type { ApiClient } from '../api-client.js'
import type { Logger } from '../logger.js'
import type { PluginConfig } from '../config.js'

/** Channel type enum */
const ChannelType = z.enum(['sms', 'email'])
type ChannelType = z.infer<typeof ChannelType>

/** Default and max limits */
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 100
const DEFAULT_MESSAGE_LIMIT = 50
const MAX_MESSAGE_LIMIT = 200

// =====================================================
// Thread List Tool
// =====================================================

/** Parameters for thread_list tool */
export const ThreadListParamsSchema = z.object({
  channel: ChannelType.optional(),
  contactId: z.string().uuid().optional(),
  limit: z
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(MAX_LIST_LIMIT, `Limit must be ${MAX_LIST_LIMIT} or less`)
    .default(DEFAULT_LIST_LIMIT),
})
export type ThreadListParams = z.infer<typeof ThreadListParamsSchema>

/** Thread in list response */
interface ThreadListItem {
  id: string
  channel: string
  contactName?: string
  endpointValue: string
  messageCount: number
  lastMessageAt?: string
}

/** API response for thread list */
interface ThreadListApiResponse {
  threads: ThreadListItem[]
  total: number
}

/** Successful tool result */
export interface ThreadListSuccess {
  success: true
  data: {
    content: string
    details: {
      threads: ThreadListItem[]
      total: number
      userId: string
    }
  }
}

/** Failed tool result */
export interface ThreadListFailure {
  success: false
  error: string
}

export type ThreadListResult = ThreadListSuccess | ThreadListFailure

/** Tool configuration */
export interface ThreadToolOptions {
  client: ApiClient
  logger: Logger
  config: PluginConfig
  userId: string
}

/** Tool definition */
export interface ThreadListTool {
  name: string
  description: string
  parameters: typeof ThreadListParamsSchema
  execute: (params: ThreadListParams) => Promise<ThreadListResult>
}

/**
 * Creates the thread_list tool.
 */
export function createThreadListTool(options: ThreadToolOptions): ThreadListTool {
  const { client, logger, userId } = options

  return {
    name: 'thread_list',
    description:
      'List message threads (conversations). Use to see recent conversations with contacts. ' +
      'Can filter by channel (SMS/email) or contact.',
    parameters: ThreadListParamsSchema,

    async execute(params: ThreadListParams): Promise<ThreadListResult> {
      // Validate parameters
      const parseResult = ThreadListParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const { channel, contactId, limit } = parseResult.data

      logger.info('thread_list invoked', {
        userId,
        channel,
        hasContactId: !!contactId,
        limit,
      })

      try {
        // Build query parameters
        const queryParams = new URLSearchParams()
        queryParams.set('limit', String(limit))

        if (channel) {
          queryParams.set('channel', channel)
        }
        if (contactId) {
          queryParams.set('contactId', contactId)
        }

        const response = await client.get<ThreadListApiResponse>(
          `/api/threads?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          logger.error('thread_list API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to list threads',
          }
        }

        const { threads, total } = response.data

        logger.debug('thread_list completed', {
          userId,
          threadCount: threads.length,
          total,
        })

        // Format content for display
        const content = threads.length > 0
          ? threads.map((t) => {
              const contact = t.contactName || t.endpointValue
              const msgCount = `${t.messageCount} message${t.messageCount !== 1 ? 's' : ''}`
              return `[${t.channel}] ${contact} - ${msgCount}`
            }).join('\n')
          : 'No threads found.'

        return {
          success: true,
          data: {
            content,
            details: { threads, total, userId },
          },
        }
      } catch (error) {
        logger.error('thread_list failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while listing threads.',
        }
      }
    },
  }
}

// =====================================================
// Thread Get Tool
// =====================================================

/** Parameters for thread_get tool */
export const ThreadGetParamsSchema = z.object({
  threadId: z.string().min(1, 'Thread ID is required'),
  messageLimit: z
    .number()
    .int()
    .min(1, 'Message limit must be at least 1')
    .max(MAX_MESSAGE_LIMIT, `Message limit must be ${MAX_MESSAGE_LIMIT} or less`)
    .default(DEFAULT_MESSAGE_LIMIT),
})
export type ThreadGetParams = z.infer<typeof ThreadGetParamsSchema>

/** Thread detail */
interface ThreadDetail {
  id: string
  channel: string
  contactName?: string
  endpointValue?: string
}

/** Message in thread */
interface ThreadMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  subject?: string
  deliveryStatus?: string
  createdAt: string
}

/** API response for thread get */
interface ThreadGetApiResponse {
  thread: ThreadDetail
  messages: ThreadMessage[]
}

/** Successful tool result */
export interface ThreadGetSuccess {
  success: true
  data: {
    content: string
    details: {
      thread: ThreadDetail
      messages: ThreadMessage[]
      userId: string
    }
  }
}

/** Failed tool result */
export interface ThreadGetFailure {
  success: false
  error: string
}

export type ThreadGetResult = ThreadGetSuccess | ThreadGetFailure

/** Tool definition */
export interface ThreadGetTool {
  name: string
  description: string
  parameters: typeof ThreadGetParamsSchema
  execute: (params: ThreadGetParams) => Promise<ThreadGetResult>
}

/**
 * Creates the thread_get tool.
 */
export function createThreadGetTool(options: ThreadToolOptions): ThreadGetTool {
  const { client, logger, userId } = options

  return {
    name: 'thread_get',
    description:
      'Get a thread with its message history. Use to view the full conversation in a thread.',
    parameters: ThreadGetParamsSchema,

    async execute(params: ThreadGetParams): Promise<ThreadGetResult> {
      // Validate parameters
      const parseResult = ThreadGetParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const { threadId, messageLimit } = parseResult.data

      logger.info('thread_get invoked', {
        userId,
        threadId,
        messageLimit,
      })

      try {
        const queryParams = new URLSearchParams()
        queryParams.set('messageLimit', String(messageLimit))

        const response = await client.get<ThreadGetApiResponse>(
          `/api/threads/${threadId}?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          logger.error('thread_get API error', {
            userId,
            threadId,
            status: response.error.status,
            code: response.error.code,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to get thread',
          }
        }

        const { thread, messages } = response.data

        logger.debug('thread_get completed', {
          userId,
          threadId,
          messageCount: messages.length,
        })

        // Format content for display
        const contact = thread.contactName || thread.endpointValue || 'Unknown'
        const header = `Thread with ${contact} [${thread.channel}]`

        const messageContent = messages.length > 0
          ? messages.map((m) => {
              const prefix = m.direction === 'inbound' ? '←' : '→'
              const timestamp = new Date(m.createdAt).toLocaleString()
              return `${prefix} [${timestamp}] ${m.body}`
            }).join('\n')
          : 'No messages in this thread.'

        const content = `${header}\n\n${messageContent}`

        return {
          success: true,
          data: {
            content,
            details: { thread, messages, userId },
          },
        }
      } catch (error) {
        logger.error('thread_get failed', {
          userId,
          threadId,
          error: error instanceof Error ? error.message : String(error),
        })

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while getting thread.',
        }
      }
    },
  }
}
