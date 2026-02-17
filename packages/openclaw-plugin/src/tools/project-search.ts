/**
 * project_search tool implementation.
 * Provides semantic search specifically for projects (kind=project work items).
 * Uses the unified search API with work_item type filter and client-side kind filtering.
 * Geo-contextual ranking added in Issue #1218.
 *
 * Part of Issue #1217.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';
import { reverseGeocode } from '../utils/nominatim.js';

/** Parameters for project_search tool */
export const ProjectSearchParamsSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(1000, 'Query must be 1000 characters or less'),
  limit: z.number().int().min(1).max(50).optional(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
});
export type ProjectSearchParams = z.infer<typeof ProjectSearchParamsSchema>;

/** Search result item */
export interface ProjectSearchItem {
  id: string;
  title: string;
  snippet: string;
  score: number;
  kind?: string;
  status?: string;
}

/** Successful search result */
export interface ProjectSearchSuccess {
  success: true;
  data: {
    content: string;
    details: {
      count: number;
      results: ProjectSearchItem[];
      search_type: string;
      user_id: string;
    };
  };
}

/** Failed result */
export interface ProjectSearchFailure {
  success: false;
  error: string;
}

export type ProjectSearchResult = ProjectSearchSuccess | ProjectSearchFailure;

/** Tool configuration */
export interface ProjectSearchToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tool definition */
export interface ProjectSearchTool {
  name: string;
  description: string;
  parameters: typeof ProjectSearchParamsSchema;
  execute: (params: ProjectSearchParams) => Promise<ProjectSearchResult>;
}

/**
 * Sanitize query input to prevent injection and remove control characters.
 */
function sanitizeQuery(query: string): string {
  return query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Creates the project_search tool.
 */
export function createProjectSearchTool(options: ProjectSearchToolOptions): ProjectSearchTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'project_search',
    description:
      'Search projects by natural language query. Uses semantic and text search to find relevant projects. ' +
      'Optionally filter by status (active, completed, archived). ' +
      'Provide location (lat/lng) to boost results relevant to the current location.',
    parameters: ProjectSearchParamsSchema,

    async execute(params: ProjectSearchParams): Promise<ProjectSearchResult> {
      const parseResult = ProjectSearchParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, limit = 10, status, location } = parseResult.data;

      const sanitizedQuery = sanitizeQuery(query);
      if (sanitizedQuery.length === 0) {
        return { success: false, error: 'Query cannot be empty after sanitization' };
      }

      logger.info('project_search invoked', {
        user_id,
        queryLength: sanitizedQuery.length,
        limit,
        status: status ?? 'all',
        hasLocation: !!location,
      });

      try {
        // Augment query with location context for geo-contextual ranking (Issue #1218)
        let searchQuery = sanitizedQuery;
        if (location && config.nominatimUrl) {
          try {
            const geo = await reverseGeocode(location.lat, location.lng, config.nominatimUrl);
            if (geo?.place_label) {
              const augmented = `${sanitizedQuery} near ${geo.place_label}`;
              if (augmented.length <= 1000) {
                searchQuery = augmented;
              }
            }
          } catch {
            logger.warn('Reverse geocode failed, proceeding without location augmentation', { user_id });
          }
        }

        // Always over-fetch by 3x since we always filter to kind=project client-side
        const fetchLimit = Math.min(limit * 3, 50);

        const queryParams = new URLSearchParams({
          q: searchQuery,
          types: 'work_item',
          limit: String(fetchLimit),
          semantic: 'true',
          user_email: user_id,
        });

        const response = await client.get<{
          results: Array<{
            id: string;
            title: string;
            snippet: string;
            score: number;
            type: string;
            metadata?: { kind?: string; status?: string };
          }>;
          search_type: string;
          total: number;
        }>(`/api/search?${queryParams.toString()}`, { user_id });

        if (!response.success) {
          logger.error('project_search API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search projects',
          };
        }

        let results = response.data.results ?? [];

        // Always filter to kind=project since this is a project-specific search tool
        results = results.filter((r) => r.metadata?.kind === 'project');

        // Additional client-side filtering by status if specified
        if (status) {
          results = results.filter((r) => r.metadata?.status === status);
        }
        results = results.slice(0, limit);

        const items: ProjectSearchItem[] = results.map((r) => ({
          id: r.id,
          title: r.title,
          snippet: r.snippet,
          score: r.score,
          kind: r.metadata?.kind,
          status: r.metadata?.status,
        }));

        if (items.length === 0) {
          return {
            success: true,
            data: {
              content: 'No matching projects found.',
              details: {
                count: 0,
                results: [],
                search_type: response.data.search_type,
                user_id,
              },
            },
          };
        }

        const content = items
          .map((item) => {
            const statusStr = item.status ? ` (${item.status})` : '';
            const snippetStr = item.snippet ? ` - ${item.snippet}` : '';
            return `- **${item.title}**${statusStr}${snippetStr}`;
          })
          .join('\n');

        logger.debug('project_search completed', {
          user_id,
          resultCount: items.length,
          search_type: response.data.search_type,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              count: items.length,
              results: items,
              search_type: response.data.search_type,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('project_search failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
