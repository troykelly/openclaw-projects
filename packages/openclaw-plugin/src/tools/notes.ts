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

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeText, sanitizeErrorMessage, truncateForPreview } from '../utils/sanitize.js';

// ─────────────────────────────────────────────────────────────────────────────
// Common Types
// ─────────────────────────────────────────────────────────────────────────────

/** Note visibility levels */
export const NoteVisibility = z.enum(['private', 'shared', 'public']);
export type NoteVisibility = z.infer<typeof NoteVisibility>;

/** Note from API */
export interface Note {
  id: string;
  title: string;
  content: string;
  notebook_id: string | null;
  user_email: string;
  tags: string[];
  visibility: NoteVisibility;
  hideFromAgents: boolean;
  summary: string | null;
  isPinned: boolean;
  created_at: string;
  updated_at: string;
}

/** Tool options shared by all note tools */
export interface NoteToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// note_create Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteCreateParamsSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').max(500, 'Title must be 500 characters or less'),
  content: z.string().min(1, 'Content cannot be empty').max(100000, 'Content must be 100,000 characters or less'),
  notebook_id: z.string().uuid().optional(),
  tags: z.array(z.string()).max(20).optional(),
  visibility: NoteVisibility.optional().default('private'),
  summary: z.string().max(1000).optional(),
});
export type NoteCreateParams = z.infer<typeof NoteCreateParamsSchema>;

export interface NoteCreateSuccess {
  success: true;
  data: {
    id: string;
    title: string;
    notebook_id: string | null;
    visibility: string;
    created_at: string;
    url?: string;
  };
}

export interface NoteCreateFailure {
  success: false;
  error: string;
}

export type NoteCreateResult = NoteCreateSuccess | NoteCreateFailure;

export interface NoteCreateTool {
  name: string;
  description: string;
  parameters: typeof NoteCreateParamsSchema;
  execute: (params: NoteCreateParams) => Promise<NoteCreateResult>;
}

export function createNoteCreateTool(options: NoteToolOptions): NoteCreateTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'note_create',
    description:
      'Create a new note with markdown content. Use for meeting notes, documentation, ' + 'research, or any information worth preserving as a document.',
    parameters: NoteCreateParamsSchema,

    async execute(params: NoteCreateParams): Promise<NoteCreateResult> {
      const parseResult = NoteCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { title, content, notebook_id, tags, visibility, summary } = parseResult.data;

      const sanitizedTitle = sanitizeText(title);
      const sanitizedContent = sanitizeText(content);

      if (sanitizedTitle.length === 0) {
        return { success: false, error: 'Title cannot be empty after sanitization' };
      }
      if (sanitizedContent.length === 0) {
        return { success: false, error: 'Content cannot be empty after sanitization' };
      }

      logger.info('note_create invoked', {
        user_id,
        titleLength: sanitizedTitle.length,
        contentLength: sanitizedContent.length,
        notebook_id,
        visibility,
      });

      try {
        const response = await client.post<Note>(
          '/api/notes',
          {
            title: sanitizedTitle,
            content: sanitizedContent,
            notebook_id: notebook_id,
            tags,
            visibility,
            summary,
          },
          { user_id },
        );

        if (!response.success) {
          logger.error('note_create API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to create note',
          };
        }

        const note = response.data;

        logger.debug('note_create completed', {
          user_id,
          noteId: note.id,
        });

        return {
          success: true,
          data: {
            id: note.id,
            title: note.title,
            notebook_id: note.notebook_id,
            visibility: note.visibility,
            created_at: note.created_at,
            ...(config.baseUrl ? { url: `${config.baseUrl}/notes/${note.id}` } : {}),
          },
        };
      } catch (error) {
        logger.error('note_create failed', {
          user_id,
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

// ─────────────────────────────────────────────────────────────────────────────
// note_get Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteGetParamsSchema = z.object({
  noteId: z.string().uuid('Note ID must be a valid UUID'),
  includeVersions: z.boolean().optional().default(false),
});
export type NoteGetParams = z.infer<typeof NoteGetParamsSchema>;

export interface NoteGetSuccess {
  success: true;
  data: {
    id: string;
    title: string;
    content: string;
    notebook_id: string | null;
    tags: string[];
    visibility: string;
    summary: string | null;
    isPinned: boolean;
    created_at: string;
    updated_at: string;
    url?: string;
    versionCount?: number;
  };
}

export interface NoteGetFailure {
  success: false;
  error: string;
}

export type NoteGetResult = NoteGetSuccess | NoteGetFailure;

export interface NoteGetTool {
  name: string;
  description: string;
  parameters: typeof NoteGetParamsSchema;
  execute: (params: NoteGetParams) => Promise<NoteGetResult>;
}

export function createNoteGetTool(options: NoteToolOptions): NoteGetTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'note_get',
    description: 'Get a note by its ID. Returns the full content and metadata of the note. ' + 'Only accessible if you have permission to view the note.',
    parameters: NoteGetParamsSchema,

    async execute(params: NoteGetParams): Promise<NoteGetResult> {
      const parseResult = NoteGetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { noteId, includeVersions } = parseResult.data;

      logger.info('note_get invoked', {
        user_id,
        noteId,
        includeVersions,
      });

      try {
        const queryParams = new URLSearchParams({ user_email: user_id });
        if (includeVersions) {
          queryParams.set('includeVersions', 'true');
        }

        const response = await client.get<Note>(`/api/notes/${noteId}?${queryParams}`, { user_id });

        if (!response.success) {
          if (response.error.status === 404) {
            return { success: false, error: 'Note not found or access denied' };
          }
          logger.error('note_get API error', {
            user_id,
            noteId,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to get note',
          };
        }

        const note = response.data;

        logger.debug('note_get completed', {
          user_id,
          noteId,
        });

        return {
          success: true,
          data: {
            id: note.id,
            title: note.title,
            content: note.content,
            notebook_id: note.notebook_id,
            tags: note.tags,
            visibility: note.visibility,
            summary: note.summary,
            isPinned: note.isPinned,
            created_at: note.created_at,
            updated_at: note.updated_at,
            ...(config.baseUrl ? { url: `${config.baseUrl}/notes/${note.id}` } : {}),
            versionCount: (note as Note & { versionCount?: number }).versionCount,
          },
        };
      } catch (error) {
        logger.error('note_get failed', {
          user_id,
          noteId,
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

// ─────────────────────────────────────────────────────────────────────────────
// note_update Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteUpdateParamsSchema = z.object({
  noteId: z.string().uuid('Note ID must be a valid UUID'),
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(100000).optional(),
  notebook_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).max(20).optional(),
  visibility: NoteVisibility.optional(),
  summary: z.string().max(1000).nullable().optional(),
  isPinned: z.boolean().optional(),
});
export type NoteUpdateParams = z.infer<typeof NoteUpdateParamsSchema>;

export interface NoteUpdateSuccess {
  success: true;
  data: {
    id: string;
    title: string;
    visibility: string;
    updated_at: string;
    url?: string;
    changes: string[];
  };
}

export interface NoteUpdateFailure {
  success: false;
  error: string;
}

export type NoteUpdateResult = NoteUpdateSuccess | NoteUpdateFailure;

export interface NoteUpdateTool {
  name: string;
  description: string;
  parameters: typeof NoteUpdateParamsSchema;
  execute: (params: NoteUpdateParams) => Promise<NoteUpdateResult>;
}

export function createNoteUpdateTool(options: NoteToolOptions): NoteUpdateTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'note_update',
    description:
      'Update an existing note. Can update title, content, tags, visibility, or move to a different notebook. ' +
      'Creates a version in history when content changes.',
    parameters: NoteUpdateParamsSchema,

    async execute(params: NoteUpdateParams): Promise<NoteUpdateResult> {
      const parseResult = NoteUpdateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { noteId, title, content, notebook_id, tags, visibility, summary, isPinned } = parseResult.data;

      // Track what's being changed
      const changes: string[] = [];
      const updateData: Record<string, unknown> = { user_email: user_id };

      if (title !== undefined) {
        const sanitizedTitle = sanitizeText(title);
        if (sanitizedTitle.length === 0) {
          return { success: false, error: 'Title cannot be empty after sanitization' };
        }
        updateData.title = sanitizedTitle;
        changes.push('title');
      }

      if (content !== undefined) {
        const sanitizedContent = sanitizeText(content);
        if (sanitizedContent.length === 0) {
          return { success: false, error: 'Content cannot be empty after sanitization' };
        }
        updateData.content = sanitizedContent;
        changes.push('content');
      }

      if (notebook_id !== undefined) {
        updateData.notebook_id = notebook_id;
        changes.push('notebook');
      }

      if (tags !== undefined) {
        updateData.tags = tags;
        changes.push('tags');
      }

      if (visibility !== undefined) {
        updateData.visibility = visibility;
        changes.push('visibility');
      }

      if (summary !== undefined) {
        updateData.summary = summary;
        changes.push('summary');
      }

      if (isPinned !== undefined) {
        updateData.is_pinned = isPinned;
        changes.push('isPinned');
      }

      if (changes.length === 0) {
        return { success: false, error: 'No changes specified' };
      }

      logger.info('note_update invoked', {
        user_id,
        noteId,
        changes,
      });

      try {
        const response = await client.put<Note>(`/api/notes/${noteId}`, updateData, { user_id });

        if (!response.success) {
          if (response.error.status === 404) {
            return { success: false, error: 'Note not found or access denied' };
          }
          if (response.error.status === 403) {
            return { success: false, error: 'You do not have permission to update this note' };
          }
          logger.error('note_update API error', {
            user_id,
            noteId,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to update note',
          };
        }

        const note = response.data;

        logger.debug('note_update completed', {
          user_id,
          noteId,
          changes,
        });

        return {
          success: true,
          data: {
            id: note.id,
            title: note.title,
            visibility: note.visibility,
            updated_at: note.updated_at,
            ...(config.baseUrl ? { url: `${config.baseUrl}/notes/${note.id}` } : {}),
            changes,
          },
        };
      } catch (error) {
        logger.error('note_update failed', {
          user_id,
          noteId,
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

// ─────────────────────────────────────────────────────────────────────────────
// note_delete Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteDeleteParamsSchema = z.object({
  noteId: z.string().uuid('Note ID must be a valid UUID'),
});
export type NoteDeleteParams = z.infer<typeof NoteDeleteParamsSchema>;

export interface NoteDeleteSuccess {
  success: true;
  data: {
    id: string;
    message: string;
  };
}

export interface NoteDeleteFailure {
  success: false;
  error: string;
}

export type NoteDeleteResult = NoteDeleteSuccess | NoteDeleteFailure;

export interface NoteDeleteTool {
  name: string;
  description: string;
  parameters: typeof NoteDeleteParamsSchema;
  execute: (params: NoteDeleteParams) => Promise<NoteDeleteResult>;
}

export function createNoteDeleteTool(options: NoteToolOptions): NoteDeleteTool {
  const { client, logger, user_id } = options;

  return {
    name: 'note_delete',
    description: 'Delete a note. This soft-deletes the note, which can be restored later. ' + 'Only the note owner can delete a note.',
    parameters: NoteDeleteParamsSchema,

    async execute(params: NoteDeleteParams): Promise<NoteDeleteResult> {
      const parseResult = NoteDeleteParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { noteId } = parseResult.data;

      logger.info('note_delete invoked', {
        user_id,
        noteId,
      });

      try {
        const response = await client.delete<void>(`/api/notes/${noteId}?user_email=${encodeURIComponent(user_id)}`, { user_id });

        if (!response.success) {
          if (response.error.status === 404) {
            return { success: false, error: 'Note not found' };
          }
          if (response.error.status === 403) {
            return { success: false, error: 'Only the note owner can delete this note' };
          }
          logger.error('note_delete API error', {
            user_id,
            noteId,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to delete note',
          };
        }

        logger.debug('note_delete completed', {
          user_id,
          noteId,
        });

        return {
          success: true,
          data: {
            id: noteId,
            message: 'Note deleted successfully',
          },
        };
      } catch (error) {
        logger.error('note_delete failed', {
          user_id,
          noteId,
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

// ─────────────────────────────────────────────────────────────────────────────
// note_search Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NoteSearchParamsSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty').max(500),
  search_type: z.enum(['hybrid', 'text', 'semantic']).optional().default('hybrid'),
  notebook_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  visibility: NoteVisibility.optional(),
  limit: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});
export type NoteSearchParams = z.infer<typeof NoteSearchParamsSchema>;

export interface NoteSearchResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  tags: string[];
  visibility: string;
  updated_at: string;
}

export interface NoteSearchSuccess {
  success: true;
  data: {
    query: string;
    search_type: string;
    results: Array<{
      id: string;
      title: string;
      snippet: string;
      score: number;
      tags: string[];
      visibility: string;
      url?: string;
    }>;
    total: number;
    limit: number;
    offset: number;
  };
}

export interface NoteSearchFailure {
  success: false;
  error: string;
}

export type NoteSearchToolResult = NoteSearchSuccess | NoteSearchFailure;

export interface NoteSearchTool {
  name: string;
  description: string;
  parameters: typeof NoteSearchParamsSchema;
  execute: (params: NoteSearchParams) => Promise<NoteSearchToolResult>;
}

export function createNoteSearchTool(options: NoteToolOptions): NoteSearchTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'note_search',
    description:
      'Search notes using text search, semantic search, or hybrid (combines both). ' +
      'Respects privacy settings - private notes are only visible to their owner.',
    parameters: NoteSearchParamsSchema,

    async execute(params: NoteSearchParams): Promise<NoteSearchToolResult> {
      const parseResult = NoteSearchParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, search_type, notebook_id, tags, visibility, limit, offset } = parseResult.data;

      logger.info('note_search invoked', {
        user_id,
        queryLength: query.length,
        search_type,
        notebook_id,
        limit,
      });

      try {
        const queryParams = new URLSearchParams({
          user_email: user_id,
          q: query,
          search_type,
          limit: String(limit),
          offset: String(offset),
        });

        if (notebook_id) queryParams.set('notebook_id', notebook_id);
        if (tags && tags.length > 0) queryParams.set('tags', tags.join(','));
        if (visibility) queryParams.set('visibility', visibility);

        const response = await client.get<{
          query: string;
          search_type: string;
          results: NoteSearchResult[];
          total: number;
          limit: number;
          offset: number;
        }>(`/api/notes/search?${queryParams}`, { user_id, isAgent: true });

        if (!response.success) {
          logger.error('note_search API error', {
            user_id,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search notes',
          };
        }

        const searchResult = response.data;

        logger.debug('note_search completed', {
          user_id,
          resultsCount: searchResult.results.length,
          total: searchResult.total,
        });

        return {
          success: true,
          data: {
            query: searchResult.query,
            search_type: searchResult.search_type,
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
        };
      } catch (error) {
        logger.error('note_search failed', {
          user_id,
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
