/**
 * context_search tool implementation.
 * Provides unified cross-entity recall across memories, todos, projects, and messages.
 * Fans out to memory, work-item, and message search APIs in parallel, normalizes scores,
 * and returns a blended ranked list.
 *
 * Part of Issue #1219, #1222.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { PluginConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { sanitizeMetadataField, wrapExternalMessage } from '../utils/injection-protection.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** Supported entity types for cross-entity search */
export const EntityType = z.enum(['memory', 'todo', 'project', 'message']);
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
  /** Optional metadata for entity-specific annotations (e.g. channel, timestamp) */
  metadata?: Record<string, string>;
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

/** Message API result shape (from /api/search?types=message) */
interface MessageApiResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  type: string;
  metadata?: { channel?: string; direction?: string; received_at?: string };
}

/**
 * Normalize an array of scores to 0-1 by dividing each by the max score in the set.
 * If maxScore <= 0, all scores are set to 0. All results are clamped to [0, 1].
 */
function normalizeScores(items: { score: number }[]): void {
  if (items.length === 0) return;
  const maxScore = Math.max(...items.map((i) => i.score));
  if (maxScore <= 0) {
    for (const item of items) {
      item.score = 0;
    }
    return;
  }
  for (const item of items) {
    item.score = Math.max(0, Math.min(1, item.score / maxScore));
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
    return 'No matching results found across memories, todos, projects, or messages.';
  }

  return results
    .map((r) => {
      const scoreStr = r.score.toFixed(2);
      const snippetStr = r.snippet ? ` - ${r.snippet}` : '';
      // Include metadata annotations for messages (channel, timestamp)
      let metaStr = '';
      if (r.entity_type === 'message' && r.metadata) {
        const parts: string[] = [];
        if (r.metadata.channel) parts.push(r.metadata.channel);
        if (r.metadata.received_at) parts.push(r.metadata.received_at);
        if (parts.length > 0) metaStr = ` [${parts.join(', ')}]`;
      }
      return `- [${r.entity_type}] ${r.title}${snippetStr}${metaStr} (score: ${scoreStr})`;
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
      'Search across memories, todos, projects, and messages simultaneously. Use when you need broad context about a topic, ' +
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
      const searchMessages = !entity_types || entity_types.includes('message');

      logger.info('context_search invoked', {
        userId,
        queryLength: sanitizedQuery.length,
        limit,
        entity_types: entity_types ?? 'all',
      });

      // Build tagged promises for parallel fan-out via Promise.allSettled
      type SearchTag = 'memory' | 'work_item' | 'message';
      const taggedPromises: Array<{ tag: SearchTag; promise: Promise<unknown> }> = [];

      if (searchMemories) {
        const memoryParams = new URLSearchParams({
          q: sanitizedQuery,
          limit: String(limit),
          user_email: userId,
        });
        taggedPromises.push({
          tag: 'memory',
          promise: client.get<{ results: MemoryApiResult[]; search_type: string }>(`/api/memories/search?${memoryParams.toString()}`, { userId }),
        });
      }

      if (searchWorkItems) {
        const searchParams = new URLSearchParams({
          q: sanitizedQuery,
          types: 'work_item',
          limit: String(Math.min(limit * 3, 50)), // Over-fetch for client-side filtering
          semantic: 'true',
          user_email: userId,
        });
        taggedPromises.push({
          tag: 'work_item',
          promise: client.get<{ results: WorkItemApiResult[]; search_type: string; total: number }>(`/api/search?${searchParams.toString()}`, { userId }),
        });
      }

      if (searchMessages) {
        const messageParams = new URLSearchParams({
          q: sanitizedQuery,
          types: 'message',
          limit: String(Math.min(limit * 2, 50)),
          semantic: 'true',
          user_email: userId,
        });
        taggedPromises.push({
          tag: 'message',
          promise: client.get<{ results: MessageApiResult[]; search_type: string; total: number }>(`/api/search?${messageParams.toString()}`, { userId }),
        });
      }

      const settled = await Promise.allSettled(taggedPromises.map((tp) => tp.promise));

      // Process results
      const warnings: string[] = [];
      const memoryItems: ContextSearchResultItem[] = [];
      const workItemResults: ContextSearchResultItem[] = [];
      const messageItems: ContextSearchResultItem[] = [];

      for (let i = 0; i < settled.length; i++) {
        const entry = settled[i];
        const tag = taggedPromises[i].tag;

        if (entry.status === 'rejected') {
          const safeMsg = sanitizeErrorMessage(entry.reason);
          warnings.push(`${tag} search failed: ${safeMsg}`);
          logger.error(`context_search ${tag} search failed`, { userId, error: safeMsg });
          continue;
        }

        const response = entry.value as { success: boolean; data?: unknown; error?: { message?: string } };

        if (!response.success) {
          const safeMsg = sanitizeErrorMessage(response.error?.message ?? 'Unknown error');
          warnings.push(`${tag} search failed: ${safeMsg}`);
          logger.error(`context_search ${tag} API error`, { userId, error: safeMsg });
          continue;
        }

        if (tag === 'memory') {
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
        } else if (tag === 'message') {
          const data = response.data as { results: MessageApiResult[] };
          const rawResults = data.results ?? [];
          for (const msg of rawResults) {
            // Sanitize external message content to prevent prompt injection
            const safeTitle = sanitizeMetadataField(msg.title ?? '');
            const safeSnippet = msg.snippet ? wrapExternalMessage(msg.snippet.substring(0, 100)) : '';
            const meta: Record<string, string> = {};
            if (msg.metadata?.channel) meta.channel = sanitizeMetadataField(msg.metadata.channel);
            if (msg.metadata?.received_at) meta.received_at = sanitizeMetadataField(msg.metadata.received_at);
            messageItems.push({
              id: msg.id,
              entity_type: 'message',
              title: safeTitle,
              snippet: safeSnippet,
              score: msg.score ?? 0,
              metadata: Object.keys(meta).length > 0 ? meta : undefined,
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
      if (memoryItems.length === 0 && workItemResults.length === 0 && messageItems.length === 0 && warnings.length === settled.length && settled.length > 0) {
        return {
          success: false,
          error: `All searches failed: ${warnings.join('; ')}`,
        };
      }

      // Normalize scores within each category
      normalizeScores(memoryItems);
      normalizeScores(workItemResults);
      normalizeScores(messageItems);

      // Merge all results
      let allResults = [...memoryItems, ...workItemResults, ...messageItems];

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
