/**
 * memory_reap tool implementation — Issue #2431.
 *
 * Triggers expired memory cleanup on demand (synaptic pruning).
 * Removes memories whose TTL has passed. Defaults to dry_run=true for safety.
 *
 * Maps to POST /memories/reap (PR2 Core API, Issue #2428).
 *
 * Security:
 * - Always sends X-Namespace header (Issue #2437)
 * - Defaults to dry_run=true — agent must explicitly opt into deletion
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Parameters for memory_reap tool */
export const MemoryReapParamsSchema = z.object({
  /**
   * Preview without deleting (default: true).
   * When true, returns the count of memories that WOULD be reaped without deleting them.
   * Set to false to actually delete expired memories.
   */
  dry_run: z.boolean().optional().describe('Preview without deleting (default: true). Set to false to actually delete expired memories.'),
});
export type MemoryReapParams = z.infer<typeof MemoryReapParamsSchema>;

/** Successful tool result */
export interface MemoryReapSuccess {
  success: true;
  data: {
    content: string;
    details: {
      reaped: number;
      dry_run: boolean;
      namespace: string;
      user_id: string;
    };
  };
}

/** Failed tool result */
export interface MemoryReapFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryReapResult = MemoryReapSuccess | MemoryReapFailure;

/** Tool configuration */
export interface MemoryReapToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
  /** Namespace to reap within (Issue #2437 — always send X-Namespace header) */
  namespace: string;
}

/** Tool definition */
export interface MemoryReapTool {
  name: string;
  description: string;
  parameters: typeof MemoryReapParamsSchema;
  execute: (params: MemoryReapParams) => Promise<MemoryReapResult>;
}

/**
 * Creates the memory_reap tool.
 *
 * Calls POST /memories/reap to clean up expired memories.
 * Defaults to dry_run=true — agent must explicitly opt into deletion.
 * Issue #2431.
 */
export function createMemoryReapTool(options: MemoryReapToolOptions): MemoryReapTool {
  const { client, logger, user_id, namespace } = options;

  return {
    name: 'memory_reap',
    description:
      'Clean up expired memories (synaptic pruning). Removes memories whose TTL has passed. ' +
      'Defaults to dry_run=true — use this first to preview what would be deleted. ' +
      'Set dry_run=false to actually delete expired memories. ' +
      'Use during end-of-day consolidation or periodic maintenance.',
    parameters: MemoryReapParamsSchema,

    async execute(params: MemoryReapParams): Promise<MemoryReapResult> {
      // Validate parameters
      const parseResult = MemoryReapParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');
        return { success: false, error: errorMessage };
      }

      // Default dry_run to true for safety (Issue #2431)
      const isDryRun = parseResult.data.dry_run ?? true;

      logger.info('memory_reap invoked', {
        user_id,
        namespace,
        dry_run: isDryRun,
      });

      try {
        // Build request body
        const body: Record<string, unknown> = {
          namespace,
          dry_run: isDryRun,
        };

        // Always send namespace header (Issue #2437)
        const response = await client.post<{
          deleted: number;
          namespace?: string;
        }>('/memories/reap', body, { user_id, namespace });

        if (!response.success) {
          logger.error('memory_reap API error', {
            user_id,
            namespace,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to reap memories',
          };
        }

        const reaped = response.data.deleted ?? 0;

        // Format response
        let content: string;
        if (isDryRun) {
          content = reaped === 0
            ? 'Preview: No expired memories found to reap.'
            : `Preview (dry run): ${reaped} expired memor${reaped === 1 ? 'y' : 'ies'} would be reaped. Run with dry_run=false to actually delete them.`;
        } else {
          content = reaped === 0
            ? 'No expired memories found to reap.'
            : `Reaped ${reaped} expired memor${reaped === 1 ? 'y' : 'ies'}.`;
        }

        logger.debug('memory_reap completed', {
          user_id,
          namespace,
          reaped,
          dry_run: isDryRun,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              reaped,
              dry_run: isDryRun,
              namespace,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('memory_reap failed', {
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
