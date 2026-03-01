/**
 * Thread tools implementation.
 * Provides thread_list and thread_get tools for viewing message threads.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { PluginConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { injectionLogLimiter } from '../utils/injection-log-rate-limiter.js';
import {
  createBoundaryMarkers,
  detectInjectionPatternsAsync,
  sanitizeMessageForContext,
  sanitizeMetadataField,
} from '../utils/injection-protection.js';

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
  contact_id: z.string().uuid().optional(),
  limit: z.number().int().min(1, 'Limit must be at least 1').max(MAX_LIST_LIMIT, `Limit must be ${MAX_LIST_LIMIT} or less`).default(DEFAULT_LIST_LIMIT),
});
export type ThreadListParams = z.infer<typeof ThreadListParamsSchema>;

/** Thread item from the threads API */
interface ThreadListItem {
  id: string;
  channel: string;
  contact_id: string | null;
  contact_name: string | null;
  last_message_at: string;
  message_count: number;
  created_at: string;
}

/** API response for GET /api/threads */
interface ThreadListApiResponse {
  threads: ThreadListItem[];
  total: number;
  limit: number;
  offset: number;
}

/** Successful tool result */
export interface ThreadListSuccess {
  success: true;
  data: {
    content: string;
    details: {
      results: ThreadListItem[];
      total: number;
      user_id: string;
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
  user_id: string;
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
  const { client, logger, user_id } = options;

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

      const { channel, contact_id, limit } = parseResult.data;

      logger.info('thread_list invoked', {
        user_id,
        channel,
        hasContactId: !!contact_id,
        limit,
      });

      try {
        // Build query parameters for the threads endpoint
        const queryParams = new URLSearchParams();
        queryParams.set('limit', String(limit));

        if (channel) {
          queryParams.set('channel', channel);
        }
        if (contact_id) {
          queryParams.set('contact_id', contact_id);
        }

        const response = await client.get<ThreadListApiResponse>(`/api/threads?${queryParams}`, { user_id });

        if (!response.success) {
          logger.error('thread_list API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to list threads',
          };
        }

        const { threads, total } = response.data;

        logger.debug('thread_list completed', {
          user_id,
          resultCount: threads.length,
          total,
        });

        // Format content for display with injection protection.
        // Sanitize contact names since they may contain external content.
        // Generate a per-invocation nonce for boundary markers (#1255)
        const { nonce } = createBoundaryMarkers();
        const content =
          threads.length > 0
            ? threads
                .map((t) => {
                  const safeName = sanitizeMetadataField(t.contact_name || 'Unknown', nonce);
                  const safeChannel = sanitizeMetadataField(t.channel, nonce);
                  const lastMsg = t.last_message_at ? new Date(t.last_message_at).toLocaleString() : 'N/A';
                  return `${safeName} [${safeChannel}] — ${t.message_count} messages, last: ${lastMsg} (ID: ${t.id})`;
                })
                .join('\n')
            : 'No threads found.';

        return {
          success: true,
          data: {
            content,
            details: { results: threads, total, user_id },
          },
        };
      } catch (error) {
        logger.error('thread_list failed', {
          user_id,
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
  thread_id: z.string().min(1, 'Thread ID is required'),
  message_limit: z
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
  display_name: string;
  notes?: string;
}

/** Thread info from API */
interface ThreadInfo {
  id: string;
  channel: string;
  external_thread_key: string;
  contact: ThreadContact;
  created_at: string;
  updated_at: string;
}

/** Message in thread */
interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  subject?: string;
  fromAddress?: string;
  received_at: string;
  created_at: string;
}

/** API response for thread history */
interface ThreadHistoryApiResponse {
  thread: ThreadInfo;
  messages: ThreadMessage[];
  related_work_items: Array<{
    id: string;
    title: string;
    status: string;
    work_item_kind: string;
  }>;
  contact_memories: Array<{
    id: string;
    memory_type: string;
    title: string;
    content: string;
  }>;
  pagination: {
    has_more: boolean;
    oldest_timestamp?: string;
    newest_timestamp?: string;
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
      user_id: string;
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
  const { client, logger, config, user_id } = options;

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

      const { thread_id, message_limit: messageLimit } = parseResult.data;

      logger.info('thread_get invoked', {
        user_id,
        thread_id,
        messageLimit,
      });

      try {
        const queryParams = new URLSearchParams();
        queryParams.set('limit', String(messageLimit));

        const response = await client.get<ThreadHistoryApiResponse>(`/api/threads/${thread_id}/history?${queryParams}`, { user_id });

        if (!response.success) {
          logger.error('thread_get API error', {
            user_id,
            thread_id,
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
          user_id,
          thread_id,
          message_count: messages.length,
        });

        // Format content for display — sanitize metadata fields interpolated outside boundary wrappers
        // Generate a per-invocation nonce for boundary markers (#1255)
        const { nonce: threadGetNonce } = createBoundaryMarkers();
        const contact = sanitizeMetadataField(thread.contact?.display_name || 'Unknown', threadGetNonce);
        const safeChannel = sanitizeMetadataField(thread.channel, threadGetNonce);
        const header = `Thread with ${contact} [${safeChannel}]`;

        // Detect and log potential injection patterns in inbound messages
        // Rate-limited to prevent log flooding from volume attacks. (#1257)
        for (const m of messages) {
          if (m.direction === 'inbound' && m.body) {
            const detection = await detectInjectionPatternsAsync(m.body, {
              promptGuardUrl: config.promptGuardUrl,
            });
            if (detection.detected) {
              const logDecision = injectionLogLimiter.shouldLog(user_id);
              if (logDecision.log) {
                logger.warn(
                  logDecision.summary ? 'injection detection log summary for previous window' : 'potential prompt injection detected in thread_get result',
                  {
                    user_id,
                    thread_id,
                    message_id: m.id,
                    patterns: detection.patterns,
                    source: detection.source,
                    ...(logDecision.suppressed > 0 && { suppressedCount: logDecision.suppressed }),
                  },
                );
              }
            }
          }
        }

        const messageContent =
          messages.length > 0
            ? messages
                .map((m) => {
                  const prefix = m.direction === 'inbound' ? '←' : '→';
                  const timestamp = new Date(m.created_at).toLocaleString();
                  const body = sanitizeMessageForContext(m.body || '', {
                    direction: m.direction,
                    channel: thread.channel,
                    sender: contact,
                    nonce: threadGetNonce,
                  });
                  return `${prefix} [${timestamp}] ${body}`;
                })
                .join('\n')
            : 'No messages in this thread.';

        const content = `${header}\n\n${messageContent}`;

        return {
          success: true,
          data: {
            content,
            details: { thread, messages, user_id },
          },
        };
      } catch (error) {
        logger.error('thread_get failed', {
          user_id,
          thread_id,
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
