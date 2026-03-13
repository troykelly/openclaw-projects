/**
 * memory_promote tool implementation — Issue #2431.
 *
 * Promotes a cluster of ephemeral memories into a single permanent memory
 * (memory reconsolidation). Creates a new durable memory, then marks the
 * source memories as superseded.
 *
 * Composite operation:
 *   1. POST /memories/unified — create new permanent memory
 *   2. POST /memories/bulk-supersede — mark sources as superseded
 *
 * If step 1 succeeds but step 2 fails, returns partial success with the
 * new memory ID and an error note about supersession.
 *
 * Security:
 * - Always sends X-Namespace header on both calls (Issue #2437)
 * - New memory has no expires_at (it is permanent)
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { MemoryCategory } from './memory-recall.js';
import { sanitizeText, sanitizeErrorMessage, truncateForPreview } from '../utils/sanitize.js';

/** Parameters for memory_promote tool */
export const MemoryPromoteParamsSchema = z.object({
  /**
   * Content for the new permanent memory.
   * Agent provides the consolidated summary — the tool does not auto-summarise.
   */
  text: z.string().min(1, 'text is required').max(10000, 'text must be 10000 characters or less'),
  /**
   * Memory category for the new permanent memory.
   */
  category: MemoryCategory.optional(),
  /**
   * Tags for the new permanent memory.
   */
  tags: z.array(z.string().min(1).max(100)).max(20, 'Maximum 20 tags per memory').optional(),
  /**
   * Importance score for the new permanent memory (0–1, default 0.8).
   * Promoted memories default to high importance since they represent
   * consolidated knowledge.
   */
  importance: z.number().min(0).max(1).optional(),
  /**
   * IDs of the ephemeral memories being consolidated.
   * These will be marked as superseded by the new permanent memory.
   */
  source_ids: z.array(z.string().min(1)).min(1, 'source_ids must contain at least one memory ID').max(100, 'Maximum 100 source_ids'),
  /**
   * Soft-delete source memories after promotion (default: true).
   * When true, sources are marked is_active=false.
   */
  deactivate_sources: z.boolean().optional(),
});
export type MemoryPromoteParams = z.infer<typeof MemoryPromoteParamsSchema>;

/** Successful tool result */
export interface MemoryPromoteSuccess {
  success: true;
  data: {
    content: string;
    details: {
      memory_id: string;
      superseded: number;
      user_id: string;
    };
  };
}

/** Failed tool result */
export interface MemoryPromoteFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryPromoteResult = MemoryPromoteSuccess | MemoryPromoteFailure;

/** Tool configuration */
export interface MemoryPromoteToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
  /** Namespace to promote within (Issue #2437 — always send X-Namespace header) */
  namespace: string;
}

/** Tool definition */
export interface MemoryPromoteTool {
  name: string;
  description: string;
  parameters: typeof MemoryPromoteParamsSchema;
  execute: (params: MemoryPromoteParams) => Promise<MemoryPromoteResult>;
}

/** Response from unified memory store */
interface StoredMemoryResponse {
  id: string;
  content: string;
  category?: string;
  importance?: number;
  tags?: string[];
  created_at?: string;
}

/** Response from bulk-supersede */
interface BulkSupersedeResponse {
  superseded: number;
  target_id: string;
}

/**
 * Creates the memory_promote tool.
 *
 * Composite operation: creates a new permanent memory, then marks source
 * memories as superseded. Handles partial failure gracefully.
 * Issue #2431.
 */
export function createMemoryPromoteTool(options: MemoryPromoteToolOptions): MemoryPromoteTool {
  const { client, logger, user_id, namespace } = options;

  return {
    name: 'memory_promote',
    description:
      'Promote a cluster of related ephemeral memories into a single permanent memory (memory reconsolidation). ' +
      'Creates a new durable memory from the provided content, then marks the source memories as superseded. ' +
      'Use after memory_digest identifies important clusters. ' +
      'Provide the consolidated summary text — the tool does not auto-summarise. ' +
      'The new memory will not expire (permanent storage).',
    parameters: MemoryPromoteParamsSchema,

    async execute(params: MemoryPromoteParams): Promise<MemoryPromoteResult> {
      // Validate parameters
      const parseResult = MemoryPromoteParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');
        return { success: false, error: errorMessage };
      }

      const {
        text,
        category = 'fact',
        tags = [],
        importance = 0.8,
        source_ids,
        deactivate_sources = true,
      } = parseResult.data;

      // Sanitize content
      const sanitizedText = sanitizeText(text);
      if (sanitizedText.length === 0) {
        return { success: false, error: 'text cannot be empty after sanitization' };
      }

      logger.info('memory_promote invoked', {
        user_id,
        namespace,
        category,
        importance,
        sourceCount: source_ids.length,
      });

      try {
        // Step 1: Create new permanent memory (no expires_at — it is permanent)
        const storePayload: Record<string, unknown> = {
          content: sanitizedText,
          memory_type: category,
          importance,
          tags,
        };
        // Deliberately omit expires_at — promoted memories are permanent (Issue #2431)

        const storeResponse = await client.post<StoredMemoryResponse>(
          '/memories/unified',
          storePayload,
          { user_id, namespace },
        );

        if (!storeResponse.success) {
          logger.error('memory_promote store error', {
            user_id,
            namespace,
            status: storeResponse.error.status,
            code: storeResponse.error.code,
          });
          return {
            success: false,
            error: storeResponse.error.message || 'Failed to create promoted memory',
          };
        }

        const newMemoryId = storeResponse.data.id;

        logger.debug('memory_promote: new memory stored', {
          user_id,
          namespace,
          memory_id: newMemoryId,
        });

        // Step 2: Bulk-supersede source memories
        const supersedBody: Record<string, unknown> = {
          target_id: newMemoryId,
          source_ids,
          deactivate_sources,
        };

        const supersedResponse = await client.post<BulkSupersedeResponse>(
          '/memories/bulk-supersede',
          supersedBody,
          { user_id, namespace },
        );

        // Step 2 partial failure: store succeeded but supersession failed
        // Return partial success so agent knows the new memory ID
        if (!supersedResponse.success) {
          logger.warn('memory_promote: supersession failed after store succeeded', {
            user_id,
            namespace,
            memory_id: newMemoryId,
            status: supersedResponse.error.status,
            code: supersedResponse.error.code,
          });

          const preview = truncateForPreview(sanitizedText);
          return {
            success: true,
            data: {
              content:
                `Promoted memory created [${category}]: "${preview}". ` +
                `Note: supersession of source memories failed (${supersedResponse.error.message ?? 'unknown error'}). ` +
                `New memory ID: ${newMemoryId}. You may need to manually mark source memories as superseded.`,
              details: {
                memory_id: newMemoryId,
                superseded: 0,
                user_id,
              },
            },
          };
        }

        const supersededCount = supersedResponse.data.superseded ?? source_ids.length;

        const preview = truncateForPreview(sanitizedText);
        const tagSuffix = tags.length > 0 ? ` (tags: ${tags.join(', ')})` : '';
        const content =
          `Promoted memory [${category}]: "${preview}"${tagSuffix}. ` +
          `Superseded ${supersededCount} ephemeral memor${supersededCount === 1 ? 'y' : 'ies'}.`;

        logger.debug('memory_promote completed', {
          user_id,
          namespace,
          memory_id: newMemoryId,
          superseded: supersededCount,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              memory_id: newMemoryId,
              superseded: supersededCount,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('memory_promote failed', {
          user_id,
          namespace,
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
