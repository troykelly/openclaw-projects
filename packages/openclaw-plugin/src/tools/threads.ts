/**
 * Thread tools implementation.
 * Provides thread_list and thread_get tools for viewing message threads.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';

/** Channel type enum */
const ChannelType = z.enum(['sms', 'email']);

/** Default and max limits */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;

// =====================================================
// Thread List Tool
// =====================================================

/** Parameters for thread_list tool */
export const ThreadListParamsSchema = z.object({
  channel: ChannelType.optional(),
  contactId: z.string().uuid().optional(),
  limit: z.number().int().min(1, 'Limit must be at least 1').max(MAX_LIST_LIMIT, `Limit must be ${MAX_LIST_LIMIT} or less`).default(DEFAULT_LIST_LIMIT),
});
export type ThreadListParams = z.infer<typeof ThreadListParamsSchema>;

/** Search result item from unified search API */
interface SearchResultItem {
  type: string;
  id: string;
  title: string;
  snippet: string;
  score: number;
  url?: string;
  metadata?: Record<string, unknown>;
}

/** API response for unified search */
interface SearchApiResponse {
  query: string;
  search_type: string;
  results: SearchResultItem[];
  facets: Record<string, number>;
  total: number;
}

/** Thread in list response (mapped from search results) */
interface ThreadListItem {
  id: string;
  title: string;
  snippet: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** Successful tool result */
export interface ThreadListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      results: ThreadListItem[];
      total: number;
      userId: string;
    };
  };
}

/** Failed tool result */
export interface ThreadListFailure {
  success: false;
  error: string;
}

export type ThreadListResult = ThreadListSuccess | ThreadListFailure;

/** Tool configuration */
export interface ThreadToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface ThreadListTool {
  name: string;
  description: string;
  parameters: typeof ThreadListParamsSchema;
  execute: (params: ThreadListParams) => Promise<ThreadListResult>;
}

/**
 * Creates the thread_list tool.
 */
export function createThreadListTool(options: ThreadToolOptions): ThreadListTool {
  const { client, logger, userId } = options;

  return {
    name: 'thread_list',
    description: 'List message threads (conversations). Use to see recent conversations with contacts. ' + 'Can filter by channel (SMS/email) or contact.',
    parameters: ThreadListParamsSchema,

    async execute(params: ThreadListParams): Promise<ThreadListResult> {
      // Validate parameters
      const parseResult = ThreadListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { channel, contactId, limit } = parseResult.data;

      logger.info('thread_list invoked', {
        userId,
        channel,
        hasContactId: !!contactId,
        limit,
      });

      try {
        // Build query parameters — use unified search with types=message
        const queryParams = new URLSearchParams();
        queryParams.set('types', 'message');
        queryParams.set('limit', String(limit));

        if (channel) {
          queryParams.set('q', channel);
        } else {
          queryParams.set('q', '*');
        }
        if (contactId) {
          queryParams.set('contactId', contactId);
        }

        const response = await client.get<SearchApiResponse>(`/api/search?${queryParams}`, { userId });

        if (!response.success) {
          logger.error('thread_list API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to list threads',
          };
        }

        const { results, total } = response.data;

        // Map search results to thread list items
        const threadItems: ThreadListItem[] = results.map((r) => ({
          id: r.id,
          title: r.title,
          snippet: r.snippet,
          score: r.score,
          metadata: r.metadata,
        }));

        logger.debug('thread_list completed', {
          userId,
          resultCount: threadItems.length,
          total,
        });

        // Format content for display
        const content =
          threadItems.length > 0
            ? threadItems
                .map((t) => {
                  return `${t.title}: ${t.snippet}`;
                })
                .join('\n')
            : 'No threads found.';

        return {
          success: true,
          data: {
            content,
            details: { results: threadItems, total, userId },
          },
        };
      } catch (error) {
        logger.error('thread_list failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while listing threads.',
        };
      }
    },
  };
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
});
export type ThreadGetParams = z.infer<typeof ThreadGetParamsSchema>;

/** Thread contact info from API */
interface ThreadContact {
  id: string;
  displayName: string;
  notes?: string;
}

/** Thread info from API */
interface ThreadInfo {
  id: string;
  channel: string;
  externalThreadKey: string;
  contact: ThreadContact;
  createdAt: string;
  updatedAt: string;
}

/** Message in thread */
interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  subject?: string;
  fromAddress?: string;
  receivedAt: string;
  createdAt: string;
}

/** API response for thread history */
interface ThreadHistoryApiResponse {
  thread: ThreadInfo;
  messages: ThreadMessage[];
  relatedWorkItems: Array<{
    id: string;
    title: string;
    status: string;
    workItemKind: string;
  }>;
  contactMemories: Array<{
    id: string;
    memoryType: string;
    title: string;
    content: string;
  }>;
  pagination: {
    hasMore: boolean;
    oldestTimestamp?: string;
    newestTimestamp?: string;
  };
}

/** Successful tool result */
export interface ThreadGetSuccess {
  success: true;
  data: {
    content: string;
    details: {
      thread: ThreadInfo;
      messages: ThreadMessage[];
      userId: string;
    };
  };
}

/** Failed tool result */
export interface ThreadGetFailure {
  success: false;
  error: string;
}

export type ThreadGetResult = ThreadGetSuccess | ThreadGetFailure;

/** Tool definition */
export interface ThreadGetTool {
  name: string;
  description: string;
  parameters: typeof ThreadGetParamsSchema;
  execute: (params: ThreadGetParams) => Promise<ThreadGetResult>;
}

/**
 * Creates the thread_get tool.
 */
export function createThreadGetTool(options: ThreadToolOptions): ThreadGetTool {
  const { client, logger, userId } = options;

  return {
    name: 'thread_get',
    description: 'Get a thread with its message history. Use to view the full conversation in a thread.',
    parameters: ThreadGetParamsSchema,

    async execute(params: ThreadGetParams): Promise<ThreadGetResult> {
      // Validate parameters
      const parseResult = ThreadGetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { threadId, messageLimit } = parseResult.data;

      logger.info('thread_get invoked', {
        userId,
        threadId,
        messageLimit,
      });

      try {
        const queryParams = new URLSearchParams();
        queryParams.set('limit', String(messageLimit));

        const response = await client.get<ThreadHistoryApiResponse>(`/api/threads/${threadId}/history?${queryParams}`, { userId });

        if (!response.success) {
          logger.error('thread_get API error', {
            userId,
            threadId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to get thread',
          };
        }

        const { thread, messages } = response.data;

        logger.debug('thread_get completed', {
          userId,
          threadId,
          messageCount: messages.length,
        });

        // Format content for display
        const contact = thread.contact?.displayName || 'Unknown';
        const header = `Thread with ${contact} [${thread.channel}]`;

        const messageContent =
          messages.length > 0
            ? messages
                .map((m) => {
                  const prefix = m.direction === 'inbound' ? '←' : '→';
                  const timestamp = new Date(m.createdAt).toLocaleString();
                  return `${prefix} [${timestamp}] ${m.body || ''}`;
                })
                .join('\n')
            : 'No messages in this thread.';

        const content = `${header}\n\n${messageContent}`;

        return {
          success: true,
          data: {
            content,
            details: { thread, messages, userId },
          },
        };
      } catch (error) {
        logger.error('thread_get failed', {
          userId,
          threadId,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while getting thread.',
        };
      }
    },
  };
}
