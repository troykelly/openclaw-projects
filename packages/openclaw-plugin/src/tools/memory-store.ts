/**
 * memory_store tool implementation.
 * Persists important information to long-term memory.
 * Tags support added in Issue #492.
 * Relationship scope added in Issue #493.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { MemoryCategory } from './memory-recall.js';
import { sanitizeText, sanitizeErrorMessage, truncateForPreview } from '../utils/sanitize.js';

/** Parameters for memory_store tool — matches OpenClaw gateway: 'text' is primary, 'content' alias for compat */
export const MemoryStoreParamsSchema = z.object({
  text: z.string().min(1, 'Text cannot be empty').max(10000, 'Text must be 10000 characters or less').optional(),
  content: z.string().min(1, 'Content cannot be empty').max(10000, 'Content must be 10000 characters or less').optional(),
  category: MemoryCategory.optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1).max(100)).max(20, 'Maximum 20 tags per memory').optional(),
  relationship_id: z.string().uuid('relationship_id must be a valid UUID').optional(),
}).refine((data) => data.text || data.content, {
  message: 'Either text or content is required',
});
export type MemoryStoreParams = z.infer<typeof MemoryStoreParamsSchema>;

/** Stored memory response from API */
export interface StoredMemory {
  id: string;
  content: string;
  category?: string;
  importance?: number;
  tags?: string[];
  createdAt?: string;
}

/** Successful tool result */
export interface MemoryStoreSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      category: string;
      importance: number;
      tags: string[];
      userId: string;
    };
  };
}

/** Failed tool result */
export interface MemoryStoreFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryStoreResult = MemoryStoreSuccess | MemoryStoreFailure;

/** Tool configuration */
export interface MemoryStoreToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface MemoryStoreTool {
  name: string;
  description: string;
  parameters: typeof MemoryStoreParamsSchema;
  execute: (params: MemoryStoreParams) => Promise<MemoryStoreResult>;
}

/** Patterns that may indicate credentials */
const CREDENTIAL_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/i, // OpenAI-style API keys
  /api[_-]?key[:\s]*[a-zA-Z0-9]{16,}/i, // Generic API keys
  /password[:\s]*\S{8,}/i, // Passwords
  /secret[_-]?key[:\s]*[a-zA-Z0-9]{16,}/i, // Secret keys
  /bearer\s+[a-zA-Z0-9._-]{20,}/i, // Bearer tokens
];

/**
 * Check if text may contain credentials.
 */
function mayContainCredentials(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Creates the memory_store tool.
 */
export function createMemoryStoreTool(options: MemoryStoreToolOptions): MemoryStoreTool {
  const { client, logger, userId } = options;

  return {
    name: 'memory_store',
    description:
      'Save important information to long-term memory. Use for preferences, facts, decisions, or any information worth remembering. Optionally tag memories for structured retrieval (e.g., ["music", "work", "food"]). Use relationship_id to scope memories to a specific relationship between contacts (e.g., anniversaries, shared preferences).',
    parameters: MemoryStoreParamsSchema,

    async execute(params: MemoryStoreParams): Promise<MemoryStoreResult> {
      // Validate parameters
      const parseResult = MemoryStoreParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { text, content: contentAlias, category = 'other', importance = 0.7, tags = [], relationship_id } = parseResult.data;

      // Accept 'text' (OpenClaw native) or 'content' (backwards compat)
      const rawText = text || contentAlias;
      if (!rawText) {
        return { success: false, error: 'text is required' };
      }

      // Sanitize content
      const sanitizedText = sanitizeText(rawText);
      if (sanitizedText.length === 0) {
        return { success: false, error: 'Content cannot be empty after sanitization' };
      }

      // Check for potential credentials (warn but don't block)
      if (mayContainCredentials(sanitizedText)) {
        logger.warn('Potential credential detected in memory_store', {
          userId,
          contentLength: sanitizedText.length,
        });
      }

      // Log invocation (without content for privacy)
      logger.info('memory_store invoked', {
        userId,
        category,
        importance,
        tags,
        contentLength: sanitizedText.length,
      });

      try {
        // Store memory via API
        // Map plugin category to API memory_type ('other' has no API equivalent, use 'note')
        const memoryType = category === 'other' ? 'note' : category;

        const payload: Record<string, unknown> = {
          content: sanitizedText,
          memory_type: memoryType,
          importance,
          tags,
        };
        if (relationship_id) {
          payload.relationship_id = relationship_id;
        }

        const response = await client.post<StoredMemory>('/api/memories/unified', payload, { userId });

        if (!response.success) {
          logger.error('memory_store API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to store memory',
          };
        }

        const stored = response.data;

        // Format response
        const preview = truncateForPreview(sanitizedText);
        const tagSuffix = tags.length > 0 ? ` (tags: ${tags.join(', ')})` : '';
        const content = `Stored memory [${category}]: "${preview}"${tagSuffix}`;

        logger.debug('memory_store completed', {
          userId,
          memoryId: stored.id,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              id: stored.id,
              category,
              importance,
              tags,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('memory_store failed', {
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
