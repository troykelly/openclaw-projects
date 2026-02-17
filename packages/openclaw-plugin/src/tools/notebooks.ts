/**
 * Notebook tools for OpenClaw agents.
 * Part of Epic #339, Issue #363
 *
 * Provides tools for:
 * - notebook_list: List user's notebooks
 * - notebook_create: Create a new notebook
 * - notebook_get: Get a notebook by ID
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeText, sanitizeErrorMessage } from '../utils/sanitize.js';

// ─────────────────────────────────────────────────────────────────────────────
// Common Types
// ─────────────────────────────────────────────────────────────────────────────

/** Notebook from API */
export interface Notebook {
  id: string;
  name: string;
  description: string | null;
  user_email: string;
  isArchived: boolean;
  noteCount?: number;
  created_at: string;
  updated_at: string;
}

/** Tool options shared by all notebook tools */
export interface NotebookToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// notebook_list Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NotebookListParamsSchema = z.object({
  includeArchived: z.boolean().optional().default(false),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});
export type NotebookListParams = z.infer<typeof NotebookListParamsSchema>;

export interface NotebookListSuccess {
  success: true;
  data: {
    notebooks: Array<{
      id: string;
      name: string;
      description: string | null;
      isArchived: boolean;
      noteCount: number;
      url?: string;
    }>;
    total: number;
    limit: number;
    offset: number;
  };
}

export interface NotebookListFailure {
  success: false;
  error: string;
}

export type NotebookListResult = NotebookListSuccess | NotebookListFailure;

export interface NotebookListTool {
  name: string;
  description: string;
  parameters: typeof NotebookListParamsSchema;
  execute: (params: NotebookListParams) => Promise<NotebookListResult>;
}

export function createNotebookListTool(options: NotebookToolOptions): NotebookListTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'notebook_list',
    description:
      'List available notebooks for the user. Notebooks are used to organize notes ' +
      'into collections. Returns notebook IDs that can be used with note_create.',
    parameters: NotebookListParamsSchema,

    async execute(params: NotebookListParams): Promise<NotebookListResult> {
      const parseResult = NotebookListParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { includeArchived, limit, offset } = parseResult.data;

      logger.info('notebook_list invoked', {
        user_id,
        includeArchived,
        limit,
      });

      try {
        const queryParams = new URLSearchParams({
          user_email: user_id,
          limit: String(limit),
          offset: String(offset),
        });

        if (includeArchived) {
          queryParams.set('includeArchived', 'true');
        }

        const response = await client.get<{
          notebooks: Notebook[];
          total: number;
          limit: number;
          offset: number;
        }>(`/api/notebooks?${queryParams}`, { user_id });

        if (!response.success) {
          logger.error('notebook_list API error', {
            user_id,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to list notebooks',
          };
        }

        const result = response.data;

        logger.debug('notebook_list completed', {
          user_id,
          count: result.notebooks.length,
        });

        return {
          success: true,
          data: {
            notebooks: result.notebooks.map((nb) => ({
              id: nb.id,
              name: nb.name,
              description: nb.description,
              isArchived: nb.isArchived,
              noteCount: nb.noteCount ?? 0,
              ...(config.baseUrl ? { url: `${config.baseUrl}/notebooks/${nb.id}` } : {}),
            })),
            total: result.total,
            limit: result.limit,
            offset: result.offset,
          },
        };
      } catch (error) {
        logger.error('notebook_list failed', {
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
// notebook_create Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NotebookCreateParamsSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').max(200, 'Name must be 200 characters or less'),
  description: z.string().max(1000).optional(),
});
export type NotebookCreateParams = z.infer<typeof NotebookCreateParamsSchema>;

export interface NotebookCreateSuccess {
  success: true;
  data: {
    id: string;
    name: string;
    description: string | null;
    created_at: string;
    url?: string;
  };
}

export interface NotebookCreateFailure {
  success: false;
  error: string;
}

export type NotebookCreateResult = NotebookCreateSuccess | NotebookCreateFailure;

export interface NotebookCreateTool {
  name: string;
  description: string;
  parameters: typeof NotebookCreateParamsSchema;
  execute: (params: NotebookCreateParams) => Promise<NotebookCreateResult>;
}

export function createNotebookCreateTool(options: NotebookToolOptions): NotebookCreateTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'notebook_create',
    description:
      'Create a new notebook to organize notes. Use notebooks to group related notes ' +
      'together (e.g., "Meeting Notes", "Project Documentation", "Research").',
    parameters: NotebookCreateParamsSchema,

    async execute(params: NotebookCreateParams): Promise<NotebookCreateResult> {
      const parseResult = NotebookCreateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { name, description } = parseResult.data;

      const sanitizedName = sanitizeText(name);
      if (sanitizedName.length === 0) {
        return { success: false, error: 'Name cannot be empty after sanitization' };
      }

      logger.info('notebook_create invoked', {
        user_id,
        nameLength: sanitizedName.length,
      });

      try {
        const response = await client.post<Notebook>(
          '/api/notebooks',
          {
            user_email: user_id,
            name: sanitizedName,
            description: description ? sanitizeText(description) : undefined,
          },
          { user_id },
        );

        if (!response.success) {
          logger.error('notebook_create API error', {
            user_id,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to create notebook',
          };
        }

        const notebook = response.data;

        logger.debug('notebook_create completed', {
          user_id,
          notebook_id: notebook.id,
        });

        return {
          success: true,
          data: {
            id: notebook.id,
            name: notebook.name,
            description: notebook.description,
            created_at: notebook.created_at,
            ...(config.baseUrl ? { url: `${config.baseUrl}/notebooks/${notebook.id}` } : {}),
          },
        };
      } catch (error) {
        logger.error('notebook_create failed', {
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
// notebook_get Tool
// ─────────────────────────────────────────────────────────────────────────────

export const NotebookGetParamsSchema = z.object({
  notebook_id: z.string().uuid('Notebook ID must be a valid UUID'),
  includeNotes: z.boolean().optional().default(false),
});
export type NotebookGetParams = z.infer<typeof NotebookGetParamsSchema>;

export interface NotebookNote {
  id: string;
  title: string;
  visibility: string;
  updated_at: string;
}

export interface NotebookGetSuccess {
  success: true;
  data: {
    id: string;
    name: string;
    description: string | null;
    isArchived: boolean;
    noteCount: number;
    created_at: string;
    updated_at: string;
    url?: string;
    notes?: Array<{
      id: string;
      title: string;
      visibility: string;
      url?: string;
    }>;
  };
}

export interface NotebookGetFailure {
  success: false;
  error: string;
}

export type NotebookGetResult = NotebookGetSuccess | NotebookGetFailure;

export interface NotebookGetTool {
  name: string;
  description: string;
  parameters: typeof NotebookGetParamsSchema;
  execute: (params: NotebookGetParams) => Promise<NotebookGetResult>;
}

export function createNotebookGetTool(options: NotebookToolOptions): NotebookGetTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'notebook_get',
    description:
      'Get a notebook by its ID. Optionally include a list of notes in the notebook. ' + 'Only accessible if you own the notebook or have shared access.',
    parameters: NotebookGetParamsSchema,

    async execute(params: NotebookGetParams): Promise<NotebookGetResult> {
      const parseResult = NotebookGetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { notebook_id, includeNotes } = parseResult.data;

      logger.info('notebook_get invoked', {
        user_id,
        notebook_id,
        includeNotes,
      });

      try {
        const queryParams = new URLSearchParams({ user_email: user_id });
        if (includeNotes) {
          queryParams.set('expand', 'notes');
        }

        const response = await client.get<Notebook & { notes?: NotebookNote[] }>(`/api/notebooks/${notebook_id}?${queryParams}`, { user_id });

        if (!response.success) {
          if (response.error.status === 404) {
            return { success: false, error: 'Notebook not found or access denied' };
          }
          logger.error('notebook_get API error', {
            user_id,
            notebook_id,
            status: response.error.status,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to get notebook',
          };
        }

        const notebook = response.data;

        logger.debug('notebook_get completed', {
          user_id,
          notebook_id,
        });

        const result: NotebookGetSuccess = {
          success: true,
          data: {
            id: notebook.id,
            name: notebook.name,
            description: notebook.description,
            isArchived: notebook.isArchived,
            noteCount: notebook.noteCount ?? 0,
            created_at: notebook.created_at,
            updated_at: notebook.updated_at,
            ...(config.baseUrl ? { url: `${config.baseUrl}/notebooks/${notebook.id}` } : {}),
          },
        };

        if (includeNotes && notebook.notes) {
          result.data.notes = notebook.notes.map((n) => ({
            id: n.id,
            title: n.title,
            visibility: n.visibility,
            ...(config.baseUrl ? { url: `${config.baseUrl}/notes/${n.id}` } : {}),
          }));
        }

        return result;
      } catch (error) {
        logger.error('notebook_get failed', {
          user_id,
          notebook_id,
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
