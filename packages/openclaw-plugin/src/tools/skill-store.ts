/**
 * Skill Store tools for OpenClaw plugin (Issue #800).
 *
 * Provides CRUD operations for skill-scoped persistent storage:
 * - skill_store_put: Create or upsert items
 * - skill_store_get: Get by ID or composite key
 * - skill_store_list: List/filter/paginate items
 * - skill_store_delete: Soft delete by ID or composite key
 */

import { z } from 'zod'
import type { ApiClient } from '../api-client.js'
import type { Logger } from '../logger.js'
import type { PluginConfig } from '../config.js'

/** Maximum serialized size of the data field (1MB). */
const DATA_MAX_BYTES = 1_048_576

/** Patterns that may indicate credentials in content fields. */
const CREDENTIAL_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/i,
  /api[_-]?key[:\s]*[a-zA-Z0-9]{16,}/i,
  /password[:\s]*\S{8,}/i,
  /secret[_-]?key[:\s]*[a-zA-Z0-9]{16,}/i,
  /bearer\s+[a-zA-Z0-9._-]{20,}/i,
]

/**
 * Validate skill_id format: alphanumeric, hyphens, underscores, max 100 chars.
 */
const SkillIdSchema = z
  .string()
  .min(1, 'skill_id cannot be empty')
  .max(100, 'skill_id must be 100 characters or less')
  .regex(/^[a-zA-Z0-9_-]+$/, 'skill_id must contain only alphanumeric characters, hyphens, and underscores')

/**
 * Validate collection name: alphanumeric, hyphens, underscores, dots, colons.
 * Prevents path traversal, control characters, and injection.
 */
const CollectionSchema = z
  .string()
  .max(200, 'collection must be 200 characters or less')
  .regex(/^[a-zA-Z0-9_.:-]+$/, 'collection must contain only alphanumeric characters, hyphens, underscores, dots, and colons')

/**
 * Validate key name: printable ASCII, no control characters.
 * Keys can contain slashes, @, #, and other common safe chars.
 */
const KeySchema = z
  .string()
  .max(500, 'key must be 500 characters or less')
  .regex(/^[a-zA-Z0-9_.:\-/@# ]+$/, 'key must contain only alphanumeric characters, hyphens, underscores, dots, colons, slashes, @, #, and spaces')

/** Zod schema for skill_store_put parameters */
export const SkillStorePutParamsSchema = z.object({
  skill_id: SkillIdSchema,
  collection: CollectionSchema.optional(),
  key: KeySchema.optional(),
  title: z.string().max(500).optional(),
  summary: z.string().max(2000).optional(),
  content: z.string().max(50000).optional(),
  data: z.record(z.unknown()).optional(),
  media_url: z.string().url().optional(),
  media_type: z.string().max(100).optional(),
  source_url: z.string().url().optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  expires_at: z.string().datetime().optional(),
  pinned: z.boolean().optional(),
  user_email: z.string().email().optional(),
})
export type SkillStorePutParams = z.infer<typeof SkillStorePutParamsSchema>

/** Zod schema for skill_store_get parameters */
export const SkillStoreGetParamsSchema = z.object({
  id: z.string().uuid().optional(),
  skill_id: SkillIdSchema.optional(),
  collection: CollectionSchema.optional(),
  key: KeySchema.optional(),
})
export type SkillStoreGetParams = z.infer<typeof SkillStoreGetParamsSchema>

/** Zod schema for skill_store_list parameters */
export const SkillStoreListParamsSchema = z.object({
  skill_id: SkillIdSchema,
  collection: CollectionSchema.optional(),
  status: z.enum(['active', 'archived', 'processing']).optional(),
  tags: z.array(z.string().max(100)).optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  order_by: z.enum(['created_at', 'updated_at', 'title', 'priority']).optional(),
  user_email: z.string().email().optional(),
})
export type SkillStoreListParams = z.infer<typeof SkillStoreListParamsSchema>

/** Zod schema for skill_store_delete parameters */
export const SkillStoreDeleteParamsSchema = z.object({
  id: z.string().uuid().optional(),
  skill_id: SkillIdSchema.optional(),
  collection: CollectionSchema.optional(),
  key: KeySchema.optional(),
})
export type SkillStoreDeleteParams = z.infer<typeof SkillStoreDeleteParamsSchema>

/** Skill store item response from API */
export interface SkillStoreItem {
  id: string
  skill_id: string
  collection: string
  key: string | null
  title: string | null
  summary: string | null
  content: string | null
  data: Record<string, unknown>
  media_url: string | null
  media_type: string | null
  source_url: string | null
  status: string
  tags: string[]
  priority: number | null
  expires_at: string | null
  pinned: boolean
  user_email: string | null
  created_at: string
  updated_at: string
}

/** Tool result types */
export interface SkillStoreToolSuccess {
  success: true
  data: {
    content: string
    details: Record<string, unknown>
  }
}

export interface SkillStoreToolFailure {
  success: false
  error: string
}

export type SkillStoreToolResult = SkillStoreToolSuccess | SkillStoreToolFailure

/** Tool options */
export interface SkillStoreToolOptions {
  client: ApiClient
  logger: Logger
  config?: PluginConfig
  userId: string
}

/** Tool definition interface */
export interface SkillStoreTool {
  name: string
  description: string
  parameters: z.ZodType
  execute: (params: Record<string, unknown>) => Promise<SkillStoreToolResult>
}

/**
 * Sanitize text input to remove control characters.
 */
function sanitizeText(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim()
}

/**
 * Check if text may contain credentials.
 */
function mayContainCredentials(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Sanitize error message to not expose internal details.
 */
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[host]')
      .replace(/:\d{2,5}\b/g, '')
      .replace(/\b(?:localhost|internal[-\w]*)\b/gi, '[internal]')

    if (message.includes('[internal]') || message.includes('[host]')) {
      return 'Operation failed. Please try again.'
    }

    return message
  }
  return 'An unexpected error occurred.'
}

/**
 * Truncate text for display preview.
 */
function truncateForPreview(text: string, maxLength = 100): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

/**
 * Create the skill_store_put tool.
 */
export function createSkillStorePutTool(options: SkillStoreToolOptions): SkillStoreTool {
  const { client, logger, userId } = options

  return {
    name: 'skill_store_put',
    description:
      'Store or update data in the skill store. Use for persisting skill state, configuration, cached results, or any structured data. When a key is provided, existing items with the same (skill_id, collection, key) are updated.',
    parameters: SkillStorePutParamsSchema,

    async execute(params: Record<string, unknown>): Promise<SkillStoreToolResult> {
      const parseResult = SkillStorePutParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const validated = parseResult.data

      // Validate data size
      if (validated.data !== undefined) {
        const serialized = JSON.stringify(validated.data)
        if (serialized.length > DATA_MAX_BYTES) {
          return {
            success: false,
            error: `data field exceeds maximum size of 1MB (${serialized.length} bytes)`,
          }
        }
      }

      // Check for potential credentials in content fields and data
      const textFields = [validated.title, validated.summary, validated.content].filter(Boolean) as string[]
      if (validated.data !== undefined) {
        textFields.push(JSON.stringify(validated.data))
      }
      for (const text of textFields) {
        if (mayContainCredentials(text)) {
          logger.warn('Potential credential detected in skill_store_put', {
            userId,
            skillId: validated.skill_id,
            textLength: text.length,
          })
        }
      }

      // Sanitize text fields
      const payload: Record<string, unknown> = {
        skill_id: validated.skill_id,
      }

      if (validated.collection) payload.collection = validated.collection
      if (validated.key) payload.key = validated.key
      if (validated.title) payload.title = sanitizeText(validated.title)
      if (validated.summary) payload.summary = sanitizeText(validated.summary)
      if (validated.content) payload.content = sanitizeText(validated.content)
      if (validated.data !== undefined) payload.data = validated.data
      if (validated.media_url) payload.media_url = validated.media_url
      if (validated.media_type) payload.media_type = validated.media_type
      if (validated.source_url) payload.source_url = validated.source_url
      if (validated.tags) payload.tags = validated.tags
      if (validated.priority !== undefined) payload.priority = validated.priority
      if (validated.expires_at) payload.expires_at = validated.expires_at
      if (validated.pinned !== undefined) payload.pinned = validated.pinned
      if (validated.user_email) payload.user_email = validated.user_email

      logger.info('skill_store_put invoked', {
        userId,
        skillId: validated.skill_id,
        collection: validated.collection,
        key: validated.key,
        hasData: validated.data !== undefined,
      })

      try {
        const response = await client.post<SkillStoreItem>(
          '/api/skill-store/items',
          payload,
          { userId }
        )

        if (!response.success) {
          logger.error('skill_store_put API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to store item',
          }
        }

        const item = response.data
        const keyInfo = item.key ? ` (key: ${item.key})` : ''
        const titleInfo = item.title ? `: "${truncateForPreview(item.title)}"` : ''
        const content = `Stored item in ${item.collection}${keyInfo}${titleInfo} (ID: ${item.id})`

        return {
          success: true,
          data: {
            content,
            details: {
              id: item.id,
              skill_id: item.skill_id,
              collection: item.collection,
              key: item.key,
              status: item.status,
              userId,
            },
          },
        }
      } catch (error) {
        logger.error('skill_store_put failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { success: false, error: sanitizeErrorMessage(error) }
      }
    },
  }
}

/**
 * Create the skill_store_get tool.
 */
export function createSkillStoreGetTool(options: SkillStoreToolOptions): SkillStoreTool {
  const { client, logger, userId } = options

  return {
    name: 'skill_store_get',
    description:
      'Retrieve an item from the skill store by ID or by composite key (skill_id + collection + key). Returns the full item including data payload.',
    parameters: SkillStoreGetParamsSchema,

    async execute(params: Record<string, unknown>): Promise<SkillStoreToolResult> {
      const parseResult = SkillStoreGetParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const validated = parseResult.data

      // Must provide either id or (skill_id + key)
      if (!validated.id && (!validated.skill_id || !validated.key)) {
        return {
          success: false,
          error: 'Either id or (skill_id + key) must be provided',
        }
      }

      logger.info('skill_store_get invoked', {
        userId,
        id: validated.id,
        skillId: validated.skill_id,
        key: validated.key,
      })

      try {
        let response

        if (validated.id) {
          response = await client.get<SkillStoreItem>(
            `/api/skill-store/items/${validated.id}`,
            { userId }
          )
        } else {
          const queryParams = new URLSearchParams({
            skill_id: validated.skill_id!,
            key: validated.key!,
          })
          if (validated.collection) {
            queryParams.set('collection', validated.collection)
          }
          response = await client.get<SkillStoreItem>(
            `/api/skill-store/items/by-key?${queryParams}`,
            { userId }
          )
        }

        if (!response.success) {
          if (response.error.status === 404) {
            return { success: false, error: 'Item not found' }
          }
          return {
            success: false,
            error: response.error.message || 'Failed to get item',
          }
        }

        const item = response.data
        const lines: string[] = []
        lines.push(`Item: ${item.id} [${item.status}]`)
        if (item.title) lines.push(`Title: ${item.title}`)
        if (item.summary) lines.push(`Summary: ${item.summary}`)
        if (item.content) lines.push(`Content: ${truncateForPreview(item.content, 200)}`)
        lines.push(`Collection: ${item.collection}`)
        if (item.key) lines.push(`Key: ${item.key}`)
        if (item.tags.length > 0) lines.push(`Tags: ${item.tags.join(', ')}`)
        if (Object.keys(item.data).length > 0) {
          lines.push(`Data: ${truncateForPreview(JSON.stringify(item.data), 500)}`)
        }

        return {
          success: true,
          data: {
            content: lines.join('\n'),
            details: { item, userId },
          },
        }
      } catch (error) {
        logger.error('skill_store_get failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { success: false, error: sanitizeErrorMessage(error) }
      }
    },
  }
}

/**
 * Create the skill_store_list tool.
 */
export function createSkillStoreListTool(options: SkillStoreToolOptions): SkillStoreTool {
  const { client, logger, userId } = options

  return {
    name: 'skill_store_list',
    description:
      'List items in the skill store with filtering and pagination. Requires skill_id. Can filter by collection, status, tags, date range, and user email.',
    parameters: SkillStoreListParamsSchema,

    async execute(params: Record<string, unknown>): Promise<SkillStoreToolResult> {
      const parseResult = SkillStoreListParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const validated = parseResult.data

      logger.info('skill_store_list invoked', {
        userId,
        skillId: validated.skill_id,
        collection: validated.collection,
        limit: validated.limit,
      })

      try {
        const queryParams = new URLSearchParams({
          skill_id: validated.skill_id,
        })

        if (validated.collection) queryParams.set('collection', validated.collection)
        if (validated.status) queryParams.set('status', validated.status)
        if (validated.tags && validated.tags.length > 0) queryParams.set('tags', validated.tags.join(','))
        if (validated.since) queryParams.set('since', validated.since)
        if (validated.limit !== undefined) queryParams.set('limit', String(validated.limit))
        if (validated.offset !== undefined) queryParams.set('offset', String(validated.offset))
        if (validated.order_by) queryParams.set('order_by', validated.order_by)
        if (validated.user_email) queryParams.set('user_email', validated.user_email)

        const response = await client.get<{
          items: SkillStoreItem[]
          total: number
          has_more: boolean
        }>(
          `/api/skill-store/items?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          return {
            success: false,
            error: response.error.message || 'Failed to list items',
          }
        }

        const { items, total, has_more } = response.data

        const content = items.length > 0
          ? items
              .map((item) => {
                const key = item.key ? ` (key: ${item.key})` : ''
                const title = item.title ? `: ${item.title}` : ''
                return `- [${item.status}] ${item.collection}${key}${title}`
              })
              .join('\n')
          : 'No items found.'

        const summary = `Found ${total} item${total !== 1 ? 's' : ''}${has_more ? ' (more available)' : ''}`

        return {
          success: true,
          data: {
            content: `${summary}\n${content}`,
            details: { items, total, has_more, userId },
          },
        }
      } catch (error) {
        logger.error('skill_store_list failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { success: false, error: sanitizeErrorMessage(error) }
      }
    },
  }
}

/**
 * Create the skill_store_delete tool.
 */
export function createSkillStoreDeleteTool(options: SkillStoreToolOptions): SkillStoreTool {
  const { client, logger, userId } = options

  return {
    name: 'skill_store_delete',
    description:
      'Delete an item from the skill store by ID or by composite key (skill_id + collection + key). Performs a soft delete by default.',
    parameters: SkillStoreDeleteParamsSchema,

    async execute(params: Record<string, unknown>): Promise<SkillStoreToolResult> {
      const parseResult = SkillStoreDeleteParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const validated = parseResult.data

      // Must provide either id or (skill_id + key)
      if (!validated.id && (!validated.skill_id || !validated.key)) {
        return {
          success: false,
          error: 'Either id or (skill_id + key) must be provided',
        }
      }

      logger.info('skill_store_delete invoked', {
        userId,
        id: validated.id,
        skillId: validated.skill_id,
        key: validated.key,
      })

      try {
        if (validated.id) {
          // Delete by ID
          const response = await client.delete(
            `/api/skill-store/items/${validated.id}`,
            { userId }
          )

          if (!response.success) {
            if (response.error.status === 404) {
              return { success: false, error: 'Item not found' }
            }
            return {
              success: false,
              error: response.error.message || 'Failed to delete item',
            }
          }

          return {
            success: true,
            data: {
              content: `Deleted item ${validated.id}`,
              details: { id: validated.id, userId },
            },
          }
        }

        // Delete by key: first look up the item, then delete by ID
        const queryParams = new URLSearchParams({
          skill_id: validated.skill_id!,
          key: validated.key!,
        })
        if (validated.collection) {
          queryParams.set('collection', validated.collection)
        }

        const getResponse = await client.get<SkillStoreItem>(
          `/api/skill-store/items/by-key?${queryParams}`,
          { userId }
        )

        if (!getResponse.success) {
          if (getResponse.error.status === 404) {
            return { success: false, error: 'Item not found' }
          }
          return {
            success: false,
            error: getResponse.error.message || 'Failed to find item for deletion',
          }
        }

        const itemId = getResponse.data.id

        const deleteResponse = await client.delete(
          `/api/skill-store/items/${itemId}`,
          { userId }
        )

        if (!deleteResponse.success) {
          return {
            success: false,
            error: deleteResponse.error.message || 'Failed to delete item',
          }
        }

        return {
          success: true,
          data: {
            content: `Deleted item ${validated.key} from ${validated.collection || '_default'} (ID: ${itemId})`,
            details: {
              id: itemId,
              skill_id: validated.skill_id,
              collection: validated.collection,
              key: validated.key,
              userId,
            },
          },
        }
      } catch (error) {
        logger.error('skill_store_delete failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { success: false, error: sanitizeErrorMessage(error) }
      }
    },
  }
}

// ── Search, Collections, Aggregate tools (Issue #801) ─────────────────

/** Zod schema for skill_store_search parameters */
export const SkillStoreSearchParamsSchema = z.object({
  skill_id: SkillIdSchema,
  query: z
    .string()
    .min(1, 'Search query cannot be empty')
    .max(2000, 'Search query must be 2000 characters or less'),
  collection: CollectionSchema.optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  semantic: z.boolean().optional(),
  min_similarity: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  user_email: z.string().email().optional(),
})
export type SkillStoreSearchParams = z.infer<typeof SkillStoreSearchParamsSchema>

/** Zod schema for skill_store_collections parameters */
export const SkillStoreCollectionsParamsSchema = z.object({
  skill_id: SkillIdSchema,
  user_email: z.string().email().optional(),
})
export type SkillStoreCollectionsParams = z.infer<typeof SkillStoreCollectionsParamsSchema>

/** Zod schema for skill_store_aggregate parameters */
export const SkillStoreAggregateParamsSchema = z.object({
  skill_id: SkillIdSchema,
  collection: CollectionSchema.optional(),
  operation: z.enum(['count', 'count_by_tag', 'count_by_status', 'latest', 'oldest']),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  user_email: z.string().email().optional(),
})
export type SkillStoreAggregateParams = z.infer<typeof SkillStoreAggregateParamsSchema>

/** Search result from API (full-text mode) */
interface SearchApiResult {
  id: string
  skill_id: string
  collection: string
  key: string | null
  title: string | null
  summary: string | null
  content: string | null
  data: Record<string, unknown>
  tags: string[]
  status: string
  priority: number
  user_email: string | null
  created_at: string
  updated_at: string
  relevance?: number
  similarity?: number
  score?: number
}

/** Full-text search API response */
interface FullTextSearchApiResponse {
  results: SearchApiResult[]
  total: number
}

/** Semantic search API response */
interface SemanticSearchApiResponse {
  results: SearchApiResult[]
  search_type: 'semantic' | 'text' | 'hybrid'
  query_embedding_provider?: string
  semantic_weight?: number
}

/** Collections API response */
interface CollectionsApiResponse {
  collections: Array<{
    collection: string
    count: number
    latest_at: string | null
  }>
}

/** Aggregate API response */
interface AggregateApiResponse {
  result: Record<string, unknown>
}

/**
 * Format search results for display.
 */
function formatSearchResults(results: SearchApiResult[]): string {
  if (results.length === 0) {
    return 'No items found matching your query.'
  }

  return results
    .map((r) => {
      const title = r.title || r.key || r.id
      const score = r.relevance ?? r.similarity ?? r.score
      const scoreStr = score !== undefined ? ` (${Math.round(Number(score) * 100)}%)` : ''
      const collection = r.collection !== '_default' ? ` [${r.collection}]` : ''
      const summary = r.summary
        ? `: ${truncateForPreview(r.summary)}`
        : r.content
          ? `: ${truncateForPreview(r.content)}`
          : ''
      return `- ${title}${collection}${scoreStr}${summary}`
    })
    .join('\n')
}

/**
 * Format aggregate result for display based on operation type.
 */
function formatAggregateResult(operation: string, result: Record<string, unknown>): string {
  switch (operation) {
    case 'count':
      return `Total items: ${result.count}`

    case 'count_by_tag': {
      const tags = result.tags
      if (!Array.isArray(tags) || tags.length === 0) return 'No tags found.'
      return tags
        .filter((t): t is { tag: string; count: number } =>
          t != null && typeof t === 'object' && 'tag' in t && 'count' in t)
        .map((t) => `- ${t.tag}: ${t.count}`)
        .join('\n') || 'No tags found.'
    }

    case 'count_by_status': {
      const statuses = result.statuses
      if (!Array.isArray(statuses) || statuses.length === 0) return 'No items found.'
      return statuses
        .filter((s): s is { status: string; count: number } =>
          s != null && typeof s === 'object' && 'status' in s && 'count' in s)
        .map((s) => `- ${s.status}: ${s.count}`)
        .join('\n') || 'No items found.'
    }

    case 'latest':
    case 'oldest': {
      const item = result.item
      if (item == null || typeof item !== 'object') return 'No items found.'
      const record = item as Record<string, unknown>
      const title = String(record.title || record.key || record.id || 'Unknown')
      const date = String(record.created_at || '')
      return `${operation === 'latest' ? 'Most recent' : 'Oldest'}: ${title} (${date})`
    }

    default:
      return JSON.stringify(result)
  }
}

/**
 * Create the skill_store_search tool.
 */
export function createSkillStoreSearchTool(options: SkillStoreToolOptions): SkillStoreTool {
  const { client, logger, userId } = options

  return {
    name: 'skill_store_search',
    description:
      'Search skill store items by text or semantic similarity. Use when looking for stored data, ' +
      'notes, or content by topic. Supports full-text search (default) and optional semantic/vector search ' +
      'with graceful fallback to text when embeddings are not available.',
    parameters: SkillStoreSearchParamsSchema,

    async execute(params: Record<string, unknown>): Promise<SkillStoreToolResult> {
      const parseResult = SkillStoreSearchParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const validated = parseResult.data

      logger.info('skill_store_search invoked', {
        userId,
        skillId: validated.skill_id,
        queryLength: validated.query.length,
        semantic: !!validated.semantic,
        collection: validated.collection,
      })

      try {
        const useSemantic = !!validated.semantic

        // Build request body
        const body: Record<string, unknown> = {
          skill_id: validated.skill_id,
          query: validated.query,
        }
        if (validated.collection) body.collection = validated.collection
        if (validated.tags) body.tags = validated.tags
        if (validated.limit !== undefined) body.limit = validated.limit
        if (validated.user_email) body.user_email = validated.user_email

        if (useSemantic) {
          if (validated.min_similarity !== undefined) body.min_similarity = validated.min_similarity

          const response = await client.post<SemanticSearchApiResponse>(
            '/api/skill-store/search/semantic',
            body,
            { userId }
          )

          if (!response.success) {
            logger.error('skill_store_search semantic API error', {
              userId,
              status: response.error.status,
              code: response.error.code,
            })
            return {
              success: false,
              error: response.error.message || 'Failed to search items',
            }
          }

          const { results, search_type, query_embedding_provider } = response.data

          const content = formatSearchResults(results)

          return {
            success: true,
            data: {
              content,
              details: {
                results,
                search_type,
                query_embedding_provider,
                userId,
              },
            },
          }
        }

        // Full-text search
        const response = await client.post<FullTextSearchApiResponse>(
          '/api/skill-store/search',
          body,
          { userId }
        )

        if (!response.success) {
          logger.error('skill_store_search API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to search items',
          }
        }

        const { results, total } = response.data

        const content = formatSearchResults(results)

        return {
          success: true,
          data: {
            content,
            details: { results, total, userId },
          },
        }
      } catch (error) {
        logger.error('skill_store_search failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { success: false, error: sanitizeErrorMessage(error) }
      }
    },
  }
}

/**
 * Create the skill_store_collections tool.
 */
export function createSkillStoreCollectionsTool(options: SkillStoreToolOptions): SkillStoreTool {
  const { client, logger, userId } = options

  return {
    name: 'skill_store_collections',
    description:
      'List all collections for a skill with item counts. Use to discover what data categories exist ' +
      'and how many items each collection contains.',
    parameters: SkillStoreCollectionsParamsSchema,

    async execute(params: Record<string, unknown>): Promise<SkillStoreToolResult> {
      const parseResult = SkillStoreCollectionsParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const validated = parseResult.data

      logger.info('skill_store_collections invoked', {
        userId,
        skillId: validated.skill_id,
      })

      try {
        const queryParams = new URLSearchParams({
          skill_id: validated.skill_id,
        })
        if (validated.user_email) {
          queryParams.set('user_email', validated.user_email)
        }

        const response = await client.get<CollectionsApiResponse>(
          `/api/skill-store/collections?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          logger.error('skill_store_collections API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to list collections',
          }
        }

        const { collections } = response.data

        if (collections.length === 0) {
          return {
            success: true,
            data: {
              content: 'No collections found for this skill.',
              details: { collections: [], userId },
            },
          }
        }

        const content = collections
          .map((c) => `- ${c.collection}: ${c.count} item${c.count !== 1 ? 's' : ''}`)
          .join('\n')

        const totalItems = collections.reduce((sum, c) => sum + c.count, 0)

        return {
          success: true,
          data: {
            content: `${collections.length} collection${collections.length !== 1 ? 's' : ''} (${totalItems} total items)\n${content}`,
            details: { collections, userId },
          },
        }
      } catch (error) {
        logger.error('skill_store_collections failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { success: false, error: sanitizeErrorMessage(error) }
      }
    },
  }
}

/**
 * Create the skill_store_aggregate tool.
 */
export function createSkillStoreAggregateTool(options: SkillStoreToolOptions): SkillStoreTool {
  const { client, logger, userId } = options

  return {
    name: 'skill_store_aggregate',
    description:
      'Run simple aggregations on skill store items. Useful for understanding data volume, ' +
      'distribution, and boundaries. Operations: count (total items), count_by_tag, count_by_status, ' +
      'latest (most recent item), oldest (first item).',
    parameters: SkillStoreAggregateParamsSchema,

    async execute(params: Record<string, unknown>): Promise<SkillStoreToolResult> {
      const parseResult = SkillStoreAggregateParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const validated = parseResult.data

      logger.info('skill_store_aggregate invoked', {
        userId,
        skillId: validated.skill_id,
        operation: validated.operation,
        collection: validated.collection,
      })

      try {
        const queryParams = new URLSearchParams({
          skill_id: validated.skill_id,
          operation: validated.operation,
        })
        if (validated.collection) queryParams.set('collection', validated.collection)
        if (validated.since) queryParams.set('since', validated.since)
        if (validated.until) queryParams.set('until', validated.until)
        if (validated.user_email) queryParams.set('user_email', validated.user_email)

        const response = await client.get<AggregateApiResponse>(
          `/api/skill-store/aggregate?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          logger.error('skill_store_aggregate API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to aggregate items',
          }
        }

        const { result } = response.data
        const content = formatAggregateResult(validated.operation, result)

        return {
          success: true,
          data: {
            content,
            details: { result, operation: validated.operation, userId },
          },
        }
      } catch (error) {
        logger.error('skill_store_aggregate failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        return { success: false, error: sanitizeErrorMessage(error) }
      }
    },
  }
}
