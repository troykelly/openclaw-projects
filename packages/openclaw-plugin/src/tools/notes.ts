/**
 * Note tools for OpenClaw agents.
 * Part of Epic #339, Issues #359, #360, #361, #362
 *
 * Provides tools for:
 * - note_create: Create a new note
 * - note_get: Get a note by ID
 * - note_update: Update a note
 * - note_delete: Delete a note
 * - note_search: Search notes
 */

import { z } from 'zod'
import type { ApiClient } from '../api-client.js'
import type { Logger } from '../logger.js'
import type { PluginConfig } from '../config.js'
import { sanitizeText, sanitizeErrorMessage, truncateForPreview } from '../utils/sanitize.js'

// ─────────────────────────────────────────────────────────────────────────────
// Common Types
// ─────────────────────────────────────────────────────────────────────────────

/** Note visibility levels */
export const NoteVisibility = z.enum(['private', 'shared', 'public'])
export type NoteVisibility = z.infer<typeof NoteVisibility>

/** Note from API */
export interface Note {
  id: string
  title: string
  content: string
  notebookId: string | null
  userEmail: string
  tags: string[]
  visibility: NoteVisibility
  hideFromAgents: boolean
  summary: string | null
  isPinned: boolean
  createdAt: string
  updatedAt: string
}

/** Tool options shared by all note tools */
export interface NoteToolOptions {
  client: ApiClient
  logger: Logger
  config: PluginConfig
  userId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// note_create Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteCreateParamsSchema = z.object({
  title: z
    .string()
    .min(1, 'Title cannot be empty')
    .max(500, 'Title must be 500 characters or less'),
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(100000, 'Content must be 100,000 characters or less'),
  notebookId: z.string().uuid().optional(),
  tags: z.array(z.string()).max(20).optional(),
  visibility: NoteVisibility.optional().default('private'),
  summary: z.string().max(1000).optional(),
})
export type NoteCreateParams = z.infer<typeof NoteCreateParamsSchema>

export interface NoteCreateSuccess {
  success: true
  data: {
    id: string
    title: string
    notebookId: string | null
    visibility: string
    createdAt: string
    url?: string
  }
}

export interface NoteCreateFailure {
  success: false
  error: string
}

export type NoteCreateResult = NoteCreateSuccess | NoteCreateFailure

export interface NoteCreateTool {
  name: string
  description: string
  parameters: typeof NoteCreateParamsSchema
  execute: (params: NoteCreateParams) => Promise<NoteCreateResult>
}

export function createNoteCreateTool(options: NoteToolOptions): NoteCreateTool {
  const { client, logger, config, userId } = options

  return {
    name: 'note_create',
    description:
      'Create a new note with markdown content. Use for meeting notes, documentation, ' +
      'research, or any information worth preserving as a document.',
    parameters: NoteCreateParamsSchema,

    async execute(params: NoteCreateParams): Promise<NoteCreateResult> {
      const parseResult = NoteCreateParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const { title, content, notebookId, tags, visibility, summary } = parseResult.data

      const sanitizedTitle = sanitizeText(title)
      const sanitizedContent = sanitizeText(content)

      if (sanitizedTitle.length === 0) {
        return { success: false, error: 'Title cannot be empty after sanitization' }
      }
      if (sanitizedContent.length === 0) {
        return { success: false, error: 'Content cannot be empty after sanitization' }
      }

      logger.info('note_create invoked', {
        userId,
        titleLength: sanitizedTitle.length,
        contentLength: sanitizedContent.length,
        notebookId,
        visibility,
      })

      try {
        const response = await client.post<Note>(
          '/api/notes',
          {
            title: sanitizedTitle,
            content: sanitizedContent,
            notebook_id: notebookId,
            tags,
            visibility,
            summary,
          },
          { userId }
        )

        if (!response.success) {
          logger.error('note_create API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to create note',
          }
        }

        const note = response.data

        logger.debug('note_create completed', {
          userId,
          noteId: note.id,
        })

        return {
          success: true,
          data: {
            id: note.id,
            title: note.title,
            notebookId: note.notebookId,
            visibility: note.visibility,
            createdAt: note.createdAt,
            ...(config.baseUrl ? { url: `${config.baseUrl}/notes/${note.id}` } : {}),
          },
        }
      } catch (error) {
        logger.error('note_create failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          success: false,
          error: sanitizeErrorMessage(error),
        }
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// note_get Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteGetParamsSchema = z.object({
  noteId: z.string().uuid('Note ID must be a valid UUID'),
  includeVersions: z.boolean().optional().default(false),
})
export type NoteGetParams = z.infer<typeof NoteGetParamsSchema>

export interface NoteGetSuccess {
  success: true
  data: {
    id: string
    title: string
    content: string
    notebookId: string | null
    tags: string[]
    visibility: string
    summary: string | null
    isPinned: boolean
    createdAt: string
    updatedAt: string
    url?: string
    versionCount?: number
  }
}

export interface NoteGetFailure {
  success: false
  error: string
}

export type NoteGetResult = NoteGetSuccess | NoteGetFailure

export interface NoteGetTool {
  name: string
  description: string
  parameters: typeof NoteGetParamsSchema
  execute: (params: NoteGetParams) => Promise<NoteGetResult>
}

export function createNoteGetTool(options: NoteToolOptions): NoteGetTool {
  const { client, logger, config, userId } = options

  return {
    name: 'note_get',
    description:
      'Get a note by its ID. Returns the full content and metadata of the note. ' +
      'Only accessible if you have permission to view the note.',
    parameters: NoteGetParamsSchema,

    async execute(params: NoteGetParams): Promise<NoteGetResult> {
      const parseResult = NoteGetParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const { noteId, includeVersions } = parseResult.data

      logger.info('note_get invoked', {
        userId,
        noteId,
        includeVersions,
      })

      try {
        const queryParams = new URLSearchParams({ user_email: userId })
        if (includeVersions) {
          queryParams.set('includeVersions', 'true')
        }

        const response = await client.get<Note>(
          `/api/notes/${noteId}?${queryParams}`,
          { userId }
        )

        if (!response.success) {
          if (response.error.status === 404) {
            return { success: false, error: 'Note not found or access denied' }
          }
          logger.error('note_get API error', {
            userId,
            noteId,
            status: response.error.status,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to get note',
          }
        }

        const note = response.data

        logger.debug('note_get completed', {
          userId,
          noteId,
        })

        return {
          success: true,
          data: {
            id: note.id,
            title: note.title,
            content: note.content,
            notebookId: note.notebookId,
            tags: note.tags,
            visibility: note.visibility,
            summary: note.summary,
            isPinned: note.isPinned,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            ...(config.baseUrl ? { url: `${config.baseUrl}/notes/${note.id}` } : {}),
            versionCount: (note as Note & { versionCount?: number }).versionCount,
          },
        }
      } catch (error) {
        logger.error('note_get failed', {
          userId,
          noteId,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          success: false,
          error: sanitizeErrorMessage(error),
        }
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// note_update Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteUpdateParamsSchema = z.object({
  noteId: z.string().uuid('Note ID must be a valid UUID'),
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(100000).optional(),
  notebookId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).max(20).optional(),
  visibility: NoteVisibility.optional(),
  summary: z.string().max(1000).nullable().optional(),
  isPinned: z.boolean().optional(),
})
export type NoteUpdateParams = z.infer<typeof NoteUpdateParamsSchema>

export interface NoteUpdateSuccess {
  success: true
  data: {
    id: string
    title: string
    visibility: string
    updatedAt: string
    url?: string
    changes: string[]
  }
}

export interface NoteUpdateFailure {
  success: false
  error: string
}

export type NoteUpdateResult = NoteUpdateSuccess | NoteUpdateFailure

export interface NoteUpdateTool {
  name: string
  description: string
  parameters: typeof NoteUpdateParamsSchema
  execute: (params: NoteUpdateParams) => Promise<NoteUpdateResult>
}

export function createNoteUpdateTool(options: NoteToolOptions): NoteUpdateTool {
  const { client, logger, config, userId } = options

  return {
    name: 'note_update',
    description:
      'Update an existing note. Can update title, content, tags, visibility, or move to a different notebook. ' +
      'Creates a version in history when content changes.',
    parameters: NoteUpdateParamsSchema,

    async execute(params: NoteUpdateParams): Promise<NoteUpdateResult> {
      const parseResult = NoteUpdateParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const { noteId, title, content, notebookId, tags, visibility, summary, isPinned } =
        parseResult.data

      // Track what's being changed
      const changes: string[] = []
      const updateData: Record<string, unknown> = { user_email: userId }

      if (title !== undefined) {
        const sanitizedTitle = sanitizeText(title)
        if (sanitizedTitle.length === 0) {
          return { success: false, error: 'Title cannot be empty after sanitization' }
        }
        updateData.title = sanitizedTitle
        changes.push('title')
      }

      if (content !== undefined) {
        const sanitizedContent = sanitizeText(content)
        if (sanitizedContent.length === 0) {
          return { success: false, error: 'Content cannot be empty after sanitization' }
        }
        updateData.content = sanitizedContent
        changes.push('content')
      }

      if (notebookId !== undefined) {
        updateData.notebook_id = notebookId
        changes.push('notebook')
      }

      if (tags !== undefined) {
        updateData.tags = tags
        changes.push('tags')
      }

      if (visibility !== undefined) {
        updateData.visibility = visibility
        changes.push('visibility')
      }

      if (summary !== undefined) {
        updateData.summary = summary
        changes.push('summary')
      }

      if (isPinned !== undefined) {
        updateData.is_pinned = isPinned
        changes.push('isPinned')
      }

      if (changes.length === 0) {
        return { success: false, error: 'No changes specified' }
      }

      logger.info('note_update invoked', {
        userId,
        noteId,
        changes,
      })

      try {
        const response = await client.put<Note>(`/api/notes/${noteId}`, updateData, { userId })

        if (!response.success) {
          if (response.error.status === 404) {
            return { success: false, error: 'Note not found or access denied' }
          }
          if (response.error.status === 403) {
            return { success: false, error: 'You do not have permission to update this note' }
          }
          logger.error('note_update API error', {
            userId,
            noteId,
            status: response.error.status,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to update note',
          }
        }

        const note = response.data

        logger.debug('note_update completed', {
          userId,
          noteId,
          changes,
        })

        return {
          success: true,
          data: {
            id: note.id,
            title: note.title,
            visibility: note.visibility,
            updatedAt: note.updatedAt,
            ...(config.baseUrl ? { url: `${config.baseUrl}/notes/${note.id}` } : {}),
            changes,
          },
        }
      } catch (error) {
        logger.error('note_update failed', {
          userId,
          noteId,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          success: false,
          error: sanitizeErrorMessage(error),
        }
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// note_delete Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteDeleteParamsSchema = z.object({
  noteId: z.string().uuid('Note ID must be a valid UUID'),
})
export type NoteDeleteParams = z.infer<typeof NoteDeleteParamsSchema>

export interface NoteDeleteSuccess {
  success: true
  data: {
    id: string
    message: string
  }
}

export interface NoteDeleteFailure {
  success: false
  error: string
}

export type NoteDeleteResult = NoteDeleteSuccess | NoteDeleteFailure

export interface NoteDeleteTool {
  name: string
  description: string
  parameters: typeof NoteDeleteParamsSchema
  execute: (params: NoteDeleteParams) => Promise<NoteDeleteResult>
}

export function createNoteDeleteTool(options: NoteToolOptions): NoteDeleteTool {
  const { client, logger, userId } = options

  return {
    name: 'note_delete',
    description:
      'Delete a note. This soft-deletes the note, which can be restored later. ' +
      'Only the note owner can delete a note.',
    parameters: NoteDeleteParamsSchema,

    async execute(params: NoteDeleteParams): Promise<NoteDeleteResult> {
      const parseResult = NoteDeleteParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const { noteId } = parseResult.data

      logger.info('note_delete invoked', {
        userId,
        noteId,
      })

      try {
        const response = await client.delete<void>(
          `/api/notes/${noteId}?user_email=${encodeURIComponent(userId)}`,
          { userId }
        )

        if (!response.success) {
          if (response.error.status === 404) {
            return { success: false, error: 'Note not found' }
          }
          if (response.error.status === 403) {
            return { success: false, error: 'Only the note owner can delete this note' }
          }
          logger.error('note_delete API error', {
            userId,
            noteId,
            status: response.error.status,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to delete note',
          }
        }

        logger.debug('note_delete completed', {
          userId,
          noteId,
        })

        return {
          success: true,
          data: {
            id: noteId,
            message: 'Note deleted successfully',
          },
        }
      } catch (error) {
        logger.error('note_delete failed', {
          userId,
          noteId,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          success: false,
          error: sanitizeErrorMessage(error),
        }
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// note_search Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteSearchParamsSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty').max(500),
  searchType: z.enum(['hybrid', 'text', 'semantic']).optional().default('hybrid'),
  notebookId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  visibility: NoteVisibility.optional(),
  limit: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
})
export type NoteSearchParams = z.infer<typeof NoteSearchParamsSchema>

export interface NoteSearchResult {
  id: string
  title: string
  snippet: string
  score: number
  tags: string[]
  visibility: string
  updatedAt: string
}

export interface NoteSearchSuccess {
  success: true
  data: {
    query: string
    searchType: string
    results: Array<{
      id: string
      title: string
      snippet: string
      score: number
      tags: string[]
      visibility: string
      url?: string
    }>
    total: number
    limit: number
    offset: number
  }
}

export interface NoteSearchFailure {
  success: false
  error: string
}

export type NoteSearchToolResult = NoteSearchSuccess | NoteSearchFailure

export interface NoteSearchTool {
  name: string
  description: string
  parameters: typeof NoteSearchParamsSchema
  execute: (params: NoteSearchParams) => Promise<NoteSearchToolResult>
}

export function createNoteSearchTool(options: NoteToolOptions): NoteSearchTool {
  const { client, logger, config, userId } = options

  return {
    name: 'note_search',
    description:
      'Search notes using text search, semantic search, or hybrid (combines both). ' +
      'Respects privacy settings - private notes are only visible to their owner.',
    parameters: NoteSearchParamsSchema,

    async execute(params: NoteSearchParams): Promise<NoteSearchToolResult> {
      const parseResult = NoteSearchParamsSchema.safeParse(params)
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ')
        return { success: false, error: errorMessage }
      }

      const { query, searchType, notebookId, tags, visibility, limit, offset } = parseResult.data

      logger.info('note_search invoked', {
        userId,
        queryLength: query.length,
        searchType,
        notebookId,
        limit,
      })

      try {
        const queryParams = new URLSearchParams({
          user_email: userId,
          q: query,
          searchType,
          limit: String(limit),
          offset: String(offset),
        })

        if (notebookId) queryParams.set('notebookId', notebookId)
        if (tags && tags.length > 0) queryParams.set('tags', tags.join(','))
        if (visibility) queryParams.set('visibility', visibility)

        const response = await client.get<{
          query: string
          searchType: string
          results: NoteSearchResult[]
          total: number
          limit: number
          offset: number
        }>(`/api/notes/search?${queryParams}`, { userId, isAgent: true })

        if (!response.success) {
          logger.error('note_search API error', {
            userId,
            status: response.error.status,
          })
          return {
            success: false,
            error: response.error.message || 'Failed to search notes',
          }
        }

        const searchResult = response.data

        logger.debug('note_search completed', {
          userId,
          resultsCount: searchResult.results.length,
          total: searchResult.total,
        })

        return {
          success: true,
          data: {
            query: searchResult.query,
            searchType: searchResult.searchType,
            results: searchResult.results.map((r) => ({
              id: r.id,
              title: r.title,
              snippet: truncateForPreview(r.snippet, 200),
              score: r.score,
              tags: r.tags,
              visibility: r.visibility,
              ...(config.baseUrl ? { url: `${config.baseUrl}/notes/${r.id}` } : {}),
            })),
            total: searchResult.total,
            limit: searchResult.limit,
            offset: searchResult.offset,
          },
        }
      } catch (error) {
        logger.error('note_search failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          success: false,
          error: sanitizeErrorMessage(error),
        }
      }
    },
  }
}
