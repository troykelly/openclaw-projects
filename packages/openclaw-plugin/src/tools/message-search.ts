/**
 * message_search tool implementation.
 * Searches message history semantically using pgvector embeddings.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { detectInjectionPatterns, sanitizeMetadataField, wrapExternalMessage } from '../utils/injection-protection.js';

/** Channel type enum */
const ChannelType = z.enum(['sms', 'email', 'all']);

/** Maximum results limit */
const MAX_LIMIT = 100;

/** Default results limit */
const DEFAULT_LIMIT = 10;

/** Parameters for message_search tool */
export const MessageSearchParamsSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  channel: ChannelType.default('all'),
  contactId: z.string().uuid().optional(),
  limit: z.number().int().min(1, 'Limit must be at least 1').max(MAX_LIMIT, `Limit must be ${MAX_LIMIT} or less`).default(DEFAULT_LIMIT),
  includeThread: z.boolean().default(false),
});
export type MessageSearchParams = z.infer<typeof MessageSearchParamsSchema>;

/** Search result from unified search API */
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

/** Message result for tool output */
interface MessageResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** Successful tool result */
export interface MessageSearchSuccess {
  success: true;
  data: {
    content: string;
    details: {
      messages: MessageResult[];
      total: number;
      userId: string;
    };
  };
}

/** Failed tool result */
export interface MessageSearchFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MessageSearchResult = MessageSearchSuccess | MessageSearchFailure;

/** Tool configuration */
export interface MessageSearchToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface MessageSearchTool {
  name: string;
  description: string;
  parameters: typeof MessageSearchParamsSchema;
  execute: (params: MessageSearchParams) => Promise<MessageSearchResult>;
}

/**
 * Creates the message_search tool.
 */
export function createMessageSearchTool(options: MessageSearchToolOptions): MessageSearchTool {
  const { client, logger, userId } = options;

  return {
    name: 'message_search',
    description:
      'Search message history semantically. Use when you need to find past conversations, ' +
      'messages about specific topics, or communications with contacts. ' +
      'Supports filtering by channel (SMS/email) and contact.',
    parameters: MessageSearchParamsSchema,

    async execute(params: MessageSearchParams): Promise<MessageSearchResult> {
      // Validate parameters
      const parseResult = MessageSearchParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, channel, contactId, limit, includeThread } = parseResult.data;

      // Log invocation
      logger.info('message_search invoked', {
        userId,
        queryLength: query.length,
        channel,
        hasContactId: !!contactId,
        limit,
        includeThread,
      });

      try {
        // Build query parameters
        const queryParams = new URLSearchParams();
        queryParams.set('q', query);
        queryParams.set('types', 'message');
        queryParams.set('limit', String(limit));

        if (channel !== 'all') {
          queryParams.set('channel', channel);
        }
        if (contactId) {
          queryParams.set('contactId', contactId);
        }
        if (includeThread) {
          queryParams.set('includeThread', 'true');
        }

        // Call API
        const response = await client.get<SearchApiResponse>(`/api/search?${queryParams}`, { userId });

        if (!response.success) {
          logger.error('message_search API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search messages',
          };
        }

        const { results, total } = response.data;

        // Transform results
        const messages: MessageResult[] = results.map((r) => ({
          id: r.id,
          title: r.title,
          snippet: r.snippet,
          score: r.score,
          metadata: r.metadata,
        }));

        logger.debug('message_search completed', {
          userId,
          resultCount: messages.length,
          total,
        });

        // Detect and log potential injection patterns in message snippets
        for (const m of messages) {
          if (m.snippet) {
            const detection = detectInjectionPatterns(m.snippet);
            if (detection.detected) {
              logger.warn('potential prompt injection detected in message_search result', {
                userId,
                messageId: m.id,
                patterns: detection.patterns,
              });
            }
          }
        }

        // Format content for display with injection protection.
        // Boundary-wrap all snippets since they may contain external message content.
        const content =
          messages.length > 0
            ? messages
                .map((m) => {
                  const score = `(${Math.round(m.score * 100)}%)`;
                  const truncatedSnippet = m.snippet.substring(0, 100) + (m.snippet.length > 100 ? '...' : '');
                  const wrappedSnippet = wrapExternalMessage(truncatedSnippet);
                  const safeTitle = sanitizeMetadataField(m.title);
                  return `${safeTitle} ${score}: ${wrappedSnippet}`;
                })
                .join('\n')
            : 'No messages found matching your query.';

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
        };
      } catch (error) {
        logger.error('message_search failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while searching messages.',
        };
      }
    },
  };
}
