/**
 * memory_digest tool implementation — Issue #2430.
 *
 * Agent-facing rehearsal detection: clusters memories from a time period by
 * semantic similarity to identify repeated topics. Use during end-of-day
 * consolidation to identify ephemeral memories worth promoting to permanent storage.
 *
 * Maps to POST /memories/digest (PR2 Core API, Issue #2427).
 *
 * Security:
 * - Always sends X-Namespace header (Issue #2437)
 * - Does not expose raw similarity scores in output (inference attack prevention)
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage, truncateForPreview } from '../utils/sanitize.js';
import { resolveRelativeTime } from '../utils/temporal.js';

/** Parameters for memory_digest tool */
export const MemoryDigestParamsSchema = z.object({
  /**
   * Start of the time period to analyse.
   * Accepts relative durations ("24h", "7d") or ISO datetime with timezone.
   */
  since: z.string().min(1, 'since is required').max(100, 'since must be 100 characters or less'),
  /**
   * End of the time period (defaults to now if omitted).
   * Accepts relative durations or ISO datetime with timezone.
   */
  before: z.string().max(100, 'before must be 100 characters or less').optional(),
  /**
   * Similarity threshold for clustering (0–1, default 0.82).
   * Higher values = tighter clusters (fewer, more cohesive groups).
   * Lower values = looser clusters (more groups, wider topics).
   */
  threshold: z.number().min(0, 'threshold must be >= 0').max(1, 'threshold must be <= 1').optional(),
  /**
   * Minimum memories per cluster (default 2).
   * Memories below this count are returned as orphans.
   */
  min_cluster: z.number().int().min(1, 'min_cluster must be at least 1').optional(),
  /**
   * Include full memory content in cluster output (default false).
   * When false, only titles/previews are returned.
   */
  include_content: z.boolean().optional(),
});
export type MemoryDigestParams = z.infer<typeof MemoryDigestParamsSchema>;

/** A memory entry within a cluster */
export interface DigestMemoryEntry {
  id: string;
  title: string;
  content?: string;
  created_at: string;
}

/** A cluster of related memories */
export interface DigestCluster {
  id: string;
  size: number;
  /** Representative topic label from the cluster centroid */
  topic: string;
  memories: DigestMemoryEntry[];
  time_span: { first: string; last: string };
}

/** An unclustered memory (below min_cluster threshold) */
export interface DigestOrphan {
  id: string;
  title: string;
  content?: string;
  created_at: string;
}

/** Successful tool result */
export interface MemoryDigestSuccess {
  success: true;
  data: {
    content: string;
    details: {
      clusters: DigestCluster[];
      orphans: DigestOrphan[];
      total_memories: number;
      total_clusters: number;
      total_orphans: number;
      user_id: string;
    };
  };
}

/** Failed tool result */
export interface MemoryDigestFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryDigestResult = MemoryDigestSuccess | MemoryDigestFailure;

/** Tool configuration */
export interface MemoryDigestToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
  /** Namespace to cluster within (Issue #2437 — always send X-Namespace header) */
  namespace: string;
}

/** Tool definition */
export interface MemoryDigestTool {
  name: string;
  description: string;
  parameters: typeof MemoryDigestParamsSchema;
  execute: (params: MemoryDigestParams) => Promise<MemoryDigestResult>;
}

/**
 * Format clusters and orphans as readable text for agent consumption.
 * Does NOT expose raw similarity scores (Issue #2430 security note).
 */
function formatDigestAsText(
  clusters: DigestCluster[],
  orphans: DigestOrphan[],
  totalMemories: number,
): string {
  if (totalMemories === 0) {
    return 'No memories found in this time period.';
  }

  const lines: string[] = [];

  if (clusters.length === 0) {
    lines.push(`No repeated topics found. ${orphans.length} individual memories in this period.`);
  } else {
    lines.push(`Found ${clusters.length} topic cluster${clusters.length === 1 ? '' : 's'} from ${totalMemories} memories:`);
    lines.push('');

    for (const cluster of clusters) {
      lines.push(`## ${cluster.topic} (${cluster.size} memories)`);
      for (const m of cluster.memories) {
        const preview = truncateForPreview(m.title || m.content || '', 200);
        lines.push(`  - [${m.id}] ${preview}`);
      }
      lines.push('');
    }
  }

  if (orphans.length > 0) {
    lines.push(`### Unclustered memories (${orphans.length}):`);
    for (const orphan of orphans) {
      const preview = truncateForPreview(orphan.title || orphan.content || '', 200);
      lines.push(`  - [${orphan.id}] ${preview}`);
    }
  }

  return lines.join('\n').trim();
}

/**
 * Creates the memory_digest tool.
 *
 * Calls POST /memories/digest and formats cluster results for agent readability.
 * Issue #2430.
 */
export function createMemoryDigestTool(options: MemoryDigestToolOptions): MemoryDigestTool {
  const { client, logger, user_id, namespace } = options;

  return {
    name: 'memory_digest',
    description:
      'Analyse memories from a time period to identify repeated topics and cluster patterns. ' +
      'Returns clusters of related memories ranked by frequency. ' +
      'Use during end-of-day consolidation to identify ephemeral memories worth promoting to permanent storage. ' +
      'Pass since="24h" to analyse the last 24 hours. ' +
      'Use memory_promote to consolidate important clusters into permanent memories.',
    parameters: MemoryDigestParamsSchema,

    async execute(params: MemoryDigestParams): Promise<MemoryDigestResult> {
      // Validate parameters
      const parseResult = MemoryDigestParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');
        return { success: false, error: errorMessage };
      }

      const { since, before, threshold, min_cluster, include_content } = parseResult.data;

      // Resolve since to ISO timestamp (UTC)
      const now = new Date();
      const sinceDate = resolveRelativeTime(since, now);
      if (!sinceDate) {
        return {
          success: false,
          error: `Invalid since format: "${since}". Use relative durations ("24h", "7d") or ISO datetime with timezone.`,
        };
      }

      // Resolve before to ISO timestamp (defaults to now)
      let beforeDate: Date = now;
      if (before) {
        const resolved = resolveRelativeTime(before, now);
        if (!resolved) {
          return {
            success: false,
            error: `Invalid before format: "${before}". Use relative durations ("24h", "7d") or ISO datetime with timezone.`,
          };
        }
        beforeDate = resolved;
      }

      if (sinceDate >= beforeDate) {
        return {
          success: false,
          error: 'since must be earlier than before',
        };
      }

      logger.info('memory_digest invoked', {
        user_id,
        namespace,
        since: sinceDate.toISOString(),
        before: beforeDate.toISOString(),
        threshold,
        min_cluster,
      });

      try {
        // Build request body
        const body: Record<string, unknown> = {
          namespace,
          since: sinceDate.toISOString(),
          before: beforeDate.toISOString(),
        };
        if (threshold !== undefined) {
          body.similarity_threshold = threshold;
        }
        if (min_cluster !== undefined) {
          body.min_cluster_size = min_cluster;
        }
        if (include_content !== undefined) {
          body.include_content = include_content;
        }

        // Always send namespace header (Issue #2437)
        const response = await client.post<{
          clusters: Array<{
            id: string;
            size: number;
            centroid_text: string;
            memories: Array<{
              id: string;
              title: string;
              content?: string;
              created_at: string | Date;
            }>;
            avg_similarity: number;
            time_span: { first: string | Date; last: string | Date };
          }>;
          orphans: Array<{
            id: string;
            title: string;
            content?: string;
            created_at: string | Date;
          }>;
          total_memories: number;
          total_clusters: number;
          total_orphans: number;
        }>('/memories/digest', body, { user_id, namespace });

        if (!response.success) {
          logger.error('memory_digest API error', {
            user_id,
            namespace,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to digest memories',
          };
        }

        const data = response.data;

        // Map API response to plugin types — omit similarity scores (Issue #2430 security)
        const clusters: DigestCluster[] = (data.clusters ?? []).map((c) => ({
          id: c.id,
          size: c.size,
          topic: c.centroid_text,
          memories: c.memories.map((m) => ({
            id: m.id,
            title: m.title,
            content: include_content ? m.content : undefined,
            created_at: typeof m.created_at === 'string' ? m.created_at : m.created_at instanceof Date ? m.created_at.toISOString() : String(m.created_at),
          })),
          time_span: {
            first: typeof c.time_span.first === 'string' ? c.time_span.first : c.time_span.first instanceof Date ? c.time_span.first.toISOString() : String(c.time_span.first),
            last: typeof c.time_span.last === 'string' ? c.time_span.last : c.time_span.last instanceof Date ? c.time_span.last.toISOString() : String(c.time_span.last),
          },
        }));

        const orphans: DigestOrphan[] = (data.orphans ?? []).map((o) => ({
          id: o.id,
          title: o.title,
          content: include_content ? o.content : undefined,
          created_at: typeof o.created_at === 'string' ? o.created_at : o.created_at instanceof Date ? o.created_at.toISOString() : String(o.created_at),
        }));

        const totalMemories = data.total_memories ?? 0;
        const totalClusters = data.total_clusters ?? clusters.length;
        const totalOrphans = data.total_orphans ?? orphans.length;

        const content = formatDigestAsText(clusters, orphans, totalMemories);

        logger.debug('memory_digest completed', {
          user_id,
          namespace,
          totalMemories,
          totalClusters,
          totalOrphans,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              clusters,
              orphans,
              total_memories: totalMemories,
              total_clusters: totalClusters,
              total_orphans: totalOrphans,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('memory_digest failed', {
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
