/**
 * memory_recall tool implementation.
 * Provides semantic search through stored memories.
 * Tags filtering support added in Issue #492.
 * Relationship scope filtering added in Issue #493.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';
import { haversineDistanceKm, computeGeoScore, blendScores } from '../utils/geo.js';

/** Memory categories for filtering */
export const MemoryCategory = z.enum(['preference', 'fact', 'decision', 'context', 'entity', 'other']);
export type MemoryCategory = z.infer<typeof MemoryCategory>;

/** Parameters for memory_recall tool */
export const MemoryRecallParamsSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(1000, 'Query must be 1000 characters or less'),
  limit: z.number().int().min(1).max(20).optional(),
  category: MemoryCategory.optional(),
  tags: z.array(z.string().min(1).max(100)).max(20, 'Maximum 20 tags per filter').optional(),
  relationship_id: z.string().uuid('relationship_id must be a valid UUID').optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
  location_radius_km: z.number().min(0.1).max(100).optional(),
  location_weight: z.number().min(0).max(1).optional(),
});
export type MemoryRecallParams = z.infer<typeof MemoryRecallParamsSchema>;

/** Memory item returned from API */
export interface Memory {
  id: string;
  content: string;
  category: string;
  tags?: string[];
  score?: number;
  createdAt?: string;
  updatedAt?: string;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  place_label?: string | null;
}

/** Successful tool result */
export interface MemoryRecallSuccess {
  success: true;
  data: {
    content: string;
    details: {
      count: number;
      memories: Memory[];
      userId: string;
    };
  };
}

/** Failed tool result */
export interface MemoryRecallFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryRecallResult = MemoryRecallSuccess | MemoryRecallFailure;

/** Tool configuration */
export interface MemoryRecallToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface MemoryRecallTool {
  name: string;
  description: string;
  parameters: typeof MemoryRecallParamsSchema;
  execute: (params: MemoryRecallParams) => Promise<MemoryRecallResult>;
}

/**
 * Sanitize query input to prevent injection and remove control characters.
 */
function sanitizeQuery(query: string): string {
  // Remove control characters (ASCII 0-31 except tab, newline, carriage return)
  const sanitized = query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Trim whitespace
  return sanitized.trim();
}

/**
 * Format memories as a bullet list with category and tag annotations.
 */
function formatMemoriesAsText(memories: Memory[]): string {
  if (memories.length === 0) {
    return 'No relevant memories found.';
  }

  return memories
    .map((m) => {
      const tagSuffix = m.tags && m.tags.length > 0 ? ` {${m.tags.join(', ')}}` : '';
      return `- [${m.category}]${tagSuffix} ${m.content}`;
    })
    .join('\n');
}

/**
 * Creates the memory_recall tool.
 */
export function createMemoryRecallTool(options: MemoryRecallToolOptions): MemoryRecallTool {
  const { client, logger, config, userId } = options;

  return {
    name: 'memory_recall',
    description:
      'Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics. Optionally filter by tags for categorical queries (e.g., ["music", "food"]). Use relationship_id to scope search to a specific relationship between contacts.',
    parameters: MemoryRecallParamsSchema,

    async execute(params: MemoryRecallParams): Promise<MemoryRecallResult> {
      // Validate parameters
      const parseResult = MemoryRecallParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, limit = config.maxRecallMemories, category, tags, relationship_id, location, location_radius_km, location_weight } = parseResult.data;

      // Sanitize query
      const sanitizedQuery = sanitizeQuery(query);
      if (sanitizedQuery.length === 0) {
        return { success: false, error: 'Query cannot be empty after sanitization' };
      }

      // Log invocation (without query content for privacy)
      logger.info('memory_recall invoked', {
        userId,
        limit,
        category: category ?? 'all',
        tags: tags ?? [],
        queryLength: sanitizedQuery.length,
        hasLocation: !!location,
      });

      try {
        // If location is provided, over-fetch to allow geo re-ranking
        const apiLimit = location ? Math.min(limit * 3, 60) : limit;

        // Build API URL
        const queryParams = new URLSearchParams({
          q: sanitizedQuery,
          limit: String(apiLimit),
        });
        if (category) {
          queryParams.set('memory_type', category);
        }
        if (tags && tags.length > 0) {
          queryParams.set('tags', tags.join(','));
        }
        if (relationship_id) {
          queryParams.set('relationship_id', relationship_id);
        }

        const path = `/api/memories/search?${queryParams.toString()}`;

        // Call API
        const response = await client.get<{ results: Array<{ id: string; content: string; type: string; tags?: string[]; similarity?: number; createdAt?: string; updatedAt?: string; lat?: number | null; lng?: number | null; address?: string | null; place_label?: string | null }>; search_type: string }>(path, { userId });

        if (!response.success) {
          logger.error('memory_recall API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search memories',
          };
        }

        const rawResults = response.data.results ?? [];

        // Map API field names to plugin Memory interface
        // Reverse the category mapping: 'note' (API) → 'other' (plugin)
        let memories: Memory[] = rawResults.map((m) => ({
          id: m.id,
          content: m.content,
          category: m.type === 'note' ? 'other' : m.type,
          tags: m.tags,
          score: m.similarity,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          lat: m.lat,
          lng: m.lng,
          address: m.address,
          place_label: m.place_label,
        }));

        // Apply geo re-ranking if location is provided
        if (location) {
          const { lat: qLat, lng: qLng } = location;
          const weight = location_weight ?? 0.3;

          // Filter by radius if specified
          if (location_radius_km !== undefined) {
            memories = memories.filter((m) => {
              if (m.lat == null || m.lng == null) return false;
              return haversineDistanceKm(qLat, qLng, m.lat, m.lng) <= location_radius_km;
            });
          }

          // Compute blended scores and re-sort
          memories = memories
            .map((m) => {
              const contentScore = m.score ?? 0;
              let geoScore = 0.5; // neutral score for memories without location
              if (m.lat != null && m.lng != null) {
                geoScore = computeGeoScore(haversineDistanceKm(qLat, qLng, m.lat, m.lng));
              }
              return { ...m, score: blendScores(contentScore, geoScore, weight) };
            })
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, limit);
        }

        // Format response
        const content = formatMemoriesAsText(memories);

        logger.debug('memory_recall completed', {
          userId,
          resultCount: memories.length,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              count: memories.length,
              memories,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('memory_recall failed', {
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
