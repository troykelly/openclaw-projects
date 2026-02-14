/**
 * context_search tool implementation.
 * Provides unified cross-entity recall across memories, todos, and projects.
 * Fans out to memory and work-item search APIs in parallel, normalizes scores,
 * and returns a blended ranked list.
 *
 * Part of Issue #1219.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { PluginConfig } from '../config.js';
import type { Logger } from '../logger.js';

/** Supported entity types for cross-entity search */
export const EntityType = z.enum(['memory', 'todo', 'project']);
export type EntityType = z.infer<typeof EntityType>;

/** Parameters for context_search tool */
export const ContextSearchParamsSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(1000, 'Query must be 1000 characters or less'),
  entity_types: z.array(EntityType).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  // TODO: location and location_weight params will be added when #1204 (geo-aware memory) ships
});
export type ContextSearchParams = z.infer<typeof ContextSearchParamsSchema>;

/** A single result in the blended list */
export interface ContextSearchResultItem {
  id: string;
  entity_type: EntityType;
  title: string;
  snippet: string;
  score: number;
}

/** Successful tool result */
export interface ContextSearchSuccess {
  success: true;
  data: {
    content: string;
    details: {
      count: number;
      results: ContextSearchResultItem[];
      warnings?: string[];
      userId: string;
    };
  };
}

/** Failed tool result */
export interface ContextSearchFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type ContextSearchResult = ContextSearchSuccess | ContextSearchFailure;

/** Tool configuration */
export interface ContextSearchToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  userId: string;
}

/** Tool definition */
export interface ContextSearchTool {
  name: string;
  description: string;
  parameters: typeof ContextSearchParamsSchema;
  execute: (params: ContextSearchParams) => Promise<ContextSearchResult>;
}

/**
 * Sanitize query input to prevent injection and remove control characters.
 */
function sanitizeQuery(query: string): string {
  return query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/** Memory API result shape */
interface MemoryApiResult {
  id: string;
  content: string;
  type: string;
  tags?: string[];
  similarity?: number;
}

/** Work item API result shape */
interface WorkItemApiResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  type: string;
  metadata?: { kind?: string; status?: string };
}

/**
 * Normalize an array of scores to 0-1 by dividing each by the max score in the set.
 * Returns original scores if max is 0 or no scores exist.
 */
function normalizeScores(items: { score: number }[]): void {
  if (items.length === 0) return;
  const maxScore = Math.max(...items.map((i) => i.score));
  if (maxScore <= 0) return;
  for (const item of items) {
    item.score = item.score / maxScore;
  }
}

/**
 * Determine entity_type for a work item based on its metadata.kind.
 */
function classifyWorkItem(kind?: string): EntityType {
  return kind === 'project' ? 'project' : 'todo';
}

/**
 * Format context search results as a text list with entity type annotations.
 */
function formatResultsAsText(results: ContextSearchResultItem[]): string {
  if (results.length === 0) {
    return 'No matching results found across memories, todos, or projects.';
  }

  return results
    .map((r) => {
      const scoreStr = r.score.toFixed(2);
      const snippetStr = r.snippet ? ` - ${r.snippet}` : '';
      return `- [${r.entity_type}] ${r.title}${snippetStr} (score: ${scoreStr})`;
    })
    .join('\n');
}

/**
 * Creates the context_search tool.
 */
export function createContextSearchTool(options: ContextSearchToolOptions): ContextSearchTool {
  const { client, logger, userId } = options;

  return {
    name: 'context_search',
    description:
      'Search across memories, todos, and projects simultaneously. Use when you need broad context about a topic, ' +
      'person, or project. Returns a blended ranked list from all entity types. Optionally filter by entity_types to narrow the search.',
    parameters: ContextSearchParamsSchema,

    async execute(params: ContextSearchParams): Promise<ContextSearchResult> {
      // Validate parameters
      const parseResult = ContextSearchParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, entity_types, limit = 10 } = parseResult.data;

      // Sanitize query
      const sanitizedQuery = sanitizeQuery(query);
      if (sanitizedQuery.length === 0) {
        return { success: false, error: 'Query cannot be empty after sanitization' };
      }

      // Determine which searches to run
      const searchMemories = !entity_types || entity_types.includes('memory');
      const searchWorkItems = !entity_types || entity_types.includes('todo') || entity_types.includes('project');

      logger.info('context_search invoked', {
        userId,
        queryLength: sanitizedQuery.length,
        limit,
        entity_types: entity_types ?? 'all',
      });

      // Build promises for parallel fan-out
      const promises: Array<Promise<{ type: 'memory' | 'work_item'; result: PromiseSettledResult<unknown> }>> = [];

      if (searchMemories) {
        const memoryPromise = (async () => {
          const queryParams = new URLSearchParams({
            q: sanitizedQuery,
            limit: String(limit),
          });
          return client.get<{ results: MemoryApiResult[]; search_type: string }>(`/api/memories/search?${queryParams.toString()}`, { userId });
        })();
        promises.push(
          memoryPromise
            .then((r) => ({ type: 'memory' as const, result: { status: 'fulfilled' as const, value: r } }))
            .catch((e) => ({ type: 'memory' as const, result: { status: 'rejected' as const, reason: e } })),
        );
      }

      if (searchWorkItems) {
        const searchPromise = (async () => {
          const queryParams = new URLSearchParams({
            q: sanitizedQuery,
            types: 'work_item',
            limit: String(Math.min(limit * 3, 50)), // Over-fetch for client-side filtering
            semantic: 'true',
            user_email: userId,
          });
          return client.get<{ results: WorkItemApiResult[]; search_type: string; total: number }>(`/api/search?${queryParams.toString()}`, { userId });
        })();
        promises.push(
          searchPromise
            .then((r) => ({ type: 'work_item' as const, result: { status: 'fulfilled' as const, value: r } }))
            .catch((e) => ({ type: 'work_item' as const, result: { status: 'rejected' as const, reason: e } })),
        );
      }

      const settled = await Promise.all(promises);

      // Process results
      const warnings: string[] = [];
      const memoryItems: ContextSearchResultItem[] = [];
      const workItemResults: ContextSearchResultItem[] = [];

      for (const entry of settled) {
        if (entry.result.status === 'rejected') {
          const errorMsg = entry.result.reason instanceof Error ? entry.result.reason.message : String(entry.result.reason);
          warnings.push(`${entry.type} search failed: ${errorMsg}`);
          logger.error(`context_search ${entry.type} search failed`, { userId, error: errorMsg });
          continue;
        }

        const response = entry.result.value as { success: boolean; data?: unknown; error?: { message?: string } };

        if (!response.success) {
          const errorMsg = response.error?.message ?? 'Unknown error';
          warnings.push(`${entry.type} search failed: ${errorMsg}`);
          logger.error(`context_search ${entry.type} API error`, { userId, error: errorMsg });
          continue;
        }

        if (entry.type === 'memory') {
          const data = response.data as { results: MemoryApiResult[] };
          const rawResults = data.results ?? [];
          for (const m of rawResults) {
            memoryItems.push({
              id: m.id,
              entity_type: 'memory',
              title: m.content,
              snippet: '',
              score: m.similarity ?? 0,
            });
          }
        } else {
          const data = response.data as { results: WorkItemApiResult[] };
          const rawResults = data.results ?? [];
          for (const w of rawResults) {
            const entityType = classifyWorkItem(w.metadata?.kind);
            workItemResults.push({
              id: w.id,
              entity_type: entityType,
              title: w.title,
              snippet: w.snippet,
              score: w.score ?? 0,
            });
          }
        }
      }

      // If all searches failed, return error
      if (memoryItems.length === 0 && workItemResults.length === 0 && warnings.length === settled.length && settled.length > 0) {
        return {
          success: false,
          error: `All searches failed: ${warnings.join('; ')}`,
        };
      }

      // Normalize scores within each category
      normalizeScores(memoryItems);
      normalizeScores(workItemResults);

      // Merge all results
      let allResults = [...memoryItems, ...workItemResults];

      // Filter by entity_types if specified
      if (entity_types) {
        allResults = allResults.filter((r) => entity_types.includes(r.entity_type));
      }

      // Sort by normalized score descending
      allResults.sort((a, b) => b.score - a.score);

      // Apply limit
      allResults = allResults.slice(0, limit);

      // Format output
      const content = formatResultsAsText(allResults);

      logger.debug('context_search completed', {
        userId,
        resultCount: allResults.length,
        warningCount: warnings.length,
      });

      return {
        success: true,
        data: {
          content,
          details: {
            count: allResults.length,
            results: allResults,
            warnings: warnings.length > 0 ? warnings : undefined,
            userId,
          },
        },
      };
    },
  };
}
