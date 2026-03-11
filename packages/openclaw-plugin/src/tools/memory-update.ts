/**
 * memory_update tool implementation.
 * Provides in-place editing of existing memories.
 * Created for Issue #2378.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { MemoryCategory } from './memory-recall.js';
import { sanitizeText, sanitizeErrorMessage, truncateForPreview } from '../utils/sanitize.js';

/** Parameters for memory_update tool */
export const MemoryUpdateParamsSchema = z.object({
  memory_id: z.string().min(1, 'memory_id is required'),
  text: z.string().min(1, 'Text cannot be empty').max(10000, 'Text must be 10000 characters or less').optional(),
  category: MemoryCategory.optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1).max(100)).max(20, 'Maximum 20 tags per memory').optional(),
  expires_at: z.string().nullable().optional(),
  pinned: z.boolean().optional().describe('When true, this memory is always included in context injection regardless of semantic similarity'),
}).refine(
  (data) => data.text !== undefined || data.category !== undefined || data.importance !== undefined || data.tags !== undefined || data.expires_at !== undefined || data.pinned !== undefined,
  { message: 'At least one field besides memory_id must be provided' },
);
export type MemoryUpdateParams = z.infer<typeof MemoryUpdateParamsSchema>;

/** Updated memory response from API */
export interface UpdatedMemory {
  id: string;
  content: string;
  type?: string;
  importance?: number;
  tags?: string[];
  updated_at?: string;
}

/** Successful tool result */
export interface MemoryUpdateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      category?: string;
      importance?: number;
      tags?: string[];
      user_id: string;
    };
  };
}

/** Failed tool result */
export interface MemoryUpdateFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryUpdateResult = MemoryUpdateSuccess | MemoryUpdateFailure;

/** Tool configuration */
export interface MemoryUpdateToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tool definition */
export interface MemoryUpdateTool {
  name: string;
  description: string;
  parameters: typeof MemoryUpdateParamsSchema;
  execute: (params: MemoryUpdateParams) => Promise<MemoryUpdateResult>;
}

/**
 * Creates the memory_update tool.
 */
export function createMemoryUpdateTool(options: MemoryUpdateToolOptions): MemoryUpdateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'memory_update',
    description:
      'Update an existing memory in-place. Use when you need to modify a memory\'s content, category, tags, importance, or expiry without deleting and recreating it. Preserves the original creation timestamp and memory ID.',
    parameters: MemoryUpdateParamsSchema,

    async execute(params: MemoryUpdateParams): Promise<MemoryUpdateResult> {
      // Validate parameters
      const parseResult = MemoryUpdateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { memory_id, text, category, importance, tags, expires_at, pinned } = parseResult.data;

      // Log invocation (without content for privacy)
      logger.info('memory_update invoked', {
        user_id,
        memory_id,
        hasText: text !== undefined,
        hasCategory: category !== undefined,
        hasImportance: importance !== undefined,
        hasTags: tags !== undefined,
        hasExpiresAt: expires_at !== undefined,
        hasPinned: pinned !== undefined,
      });

      try {
        // Build update payload
        const payload: Record<string, unknown> = {};

        if (text !== undefined) {
          const sanitized = sanitizeText(text);
          if (sanitized.length === 0) {
            return { success: false, error: 'Text cannot be empty after sanitization' };
          }
          payload.content = sanitized;
        }
        if (category !== undefined) {
          payload.memory_type = category === 'other' ? 'note' : category;
        }
        if (importance !== undefined) {
          payload.importance = importance;
        }
        if (tags !== undefined) {
          payload.tags = tags;
        }
        if (expires_at !== undefined) {
          payload.expires_at = expires_at;
        }
        if (pinned !== undefined) {
          payload.pinned = pinned;
        }

        // Call API
        const response = await client.patch<UpdatedMemory>(`/memories/${memory_id}`, payload, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: `Memory ${memory_id} not found` };
          }
          logger.error('memory_update API error', {
            user_id,
            memory_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to update memory',
          };
        }

        const updated = response.data;
        const updatedCategory = updated.type === 'note' ? 'other' : (updated.type ?? category);

        // Format response
        const preview = truncateForPreview(updated.content ?? text ?? '');
        const content = `Updated memory ${memory_id}: "${preview}"`;

        logger.debug('memory_update completed', {
          user_id,
          memory_id,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              id: memory_id,
              category: updatedCategory,
              importance: updated.importance ?? importance,
              tags: updated.tags ?? tags,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('memory_update failed', {
          user_id,
          memory_id,
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
