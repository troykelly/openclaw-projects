/**
 * Terminal search and annotation tools.
 * Provides semantic search across session entries and annotation creation.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/** UUID validation regex */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 date format (YYYY-MM-DD) */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate UUID format.
 */
function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Validate ISO 8601 date format (YYYY-MM-DD).
 */
function isValidIsoDate(date: string): boolean {
  if (!ISO_DATE_REGEX.test(date)) return false;
  const parsed = new Date(date);
  return !Number.isNaN(parsed.getTime());
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/**
 * Sanitize query input.
 */
function sanitizeQuery(query: string): string {
  return query.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

// ==================== Shared Types ====================

/** Tool configuration */
export interface TerminalSearchToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Search result entry from API */
export interface TerminalSearchEntry {
  id: string;
  session_id: string;
  kind: string;
  content: string;
  similarity?: number;
  captured_at: string;
  metadata?: Record<string, unknown>;
  session?: { id: string; tmux_session_name: string };
  connection?: { id: string; name: string; host?: string };
}

/** Failure result */
export interface TerminalSearchFailure {
  success: false;
  error: string;
}

// ==================== terminal_search ====================

/** Entry kind enum */
export const TerminalEntryKind = z.enum(['command', 'output', 'scrollback', 'annotation', 'error']);

/** Parameters for terminal_search */
export const TerminalSearchParamsSchema = z.object({
  query: z.string().min(1, 'Search query is required').max(500, 'Query must be 500 characters or less'),
  connection_id: z.string().optional(),
  session_id: z.string().optional(),
  kind: TerminalEntryKind.optional(),
  tags: z.string().max(500, 'Tags must be 500 characters or less').optional(),
  host: z.string().max(253, 'Host must be 253 characters or less').optional(),
  session_name: z.string().max(100, 'Session name must be 100 characters or less').optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type TerminalSearchParams = z.infer<typeof TerminalSearchParamsSchema>;

/** Successful search result */
export interface TerminalSearchSuccess {
  success: true;
  data: {
    content: string;
    details: {
      entries: TerminalSearchEntry[];
      total: number;
      user_id: string;
    };
  };
}

export type TerminalSearchResult = TerminalSearchSuccess | TerminalSearchFailure;

export interface TerminalSearchTool {
  name: string;
  description: string;
  parameters: typeof TerminalSearchParamsSchema;
  execute: (params: TerminalSearchParams) => Promise<TerminalSearchResult>;
}

/**
 * Creates the terminal_search tool.
 */
export function createTerminalSearchTool(options: TerminalSearchToolOptions): TerminalSearchTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_search',
    description: 'Semantic search across terminal session entries. Find past commands, output, and annotations by meaning. Filter by connection, session, kind, tags, host, or date range.',
    parameters: TerminalSearchParamsSchema,

    async execute(params: TerminalSearchParams): Promise<TerminalSearchResult> {
      const parseResult = TerminalSearchParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { query, connection_id, session_id, kind, tags, host, session_name, date_from, date_to, limit = 10 } = parseResult.data;

      const sanitizedQuery = sanitizeQuery(query);
      if (sanitizedQuery.length === 0) {
        return { success: false, error: 'Search query cannot be empty' };
      }

      if (connection_id && !isValidUuid(connection_id)) {
        return { success: false, error: 'Invalid connection_id format. Expected UUID.' };
      }

      if (session_id && !isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session_id format. Expected UUID.' };
      }

      if (date_from && !isValidIsoDate(date_from)) {
        return { success: false, error: 'Invalid date_from format. Expected YYYY-MM-DD.' };
      }

      if (date_to && !isValidIsoDate(date_to)) {
        return { success: false, error: 'Invalid date_to format. Expected YYYY-MM-DD.' };
      }

      logger.info('terminal_search invoked', {
        user_id,
        queryLength: sanitizedQuery.length,
        hasConnectionId: !!connection_id,
        hasSessionId: !!session_id,
        kind,
        limit,
      });

      try {
        const body: Record<string, unknown> = { query: sanitizedQuery, limit };
        if (connection_id) body.connection_id = connection_id;
        if (session_id) body.session_id = session_id;
        if (kind) body.kind = kind;
        if (tags) body.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
        if (host) body.host = host;
        if (session_name) body.session_name = session_name;
        if (date_from) body.date_from = date_from;
        if (date_to) body.date_to = date_to;

        const response = await client.post<{ entries?: TerminalSearchEntry[]; items?: TerminalSearchEntry[]; total?: number }>(
          '/api/terminal/search',
          body,
          { user_id },
        );

        if (!response.success) {
          logger.error('terminal_search API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return { success: false, error: response.error.message || 'Failed to search terminal entries' };
        }

        const entries = response.data.entries ?? response.data.items ?? [];
        const total = response.data.total ?? entries.length;

        if (entries.length === 0) {
          return {
            success: true,
            data: {
              content: 'No matching terminal entries found.',
              details: { entries: [], total: 0, user_id },
            },
          };
        }

        const content = entries
          .map((e) => {
            const parts = [`[${e.kind}]`];
            if (e.session?.tmux_session_name) parts.push(`session: ${e.session.tmux_session_name}`);
            if (e.connection?.name) parts.push(`on: ${e.connection.name}`);
            if (e.similarity !== undefined) parts.push(`(${(e.similarity * 100).toFixed(0)}% match)`);
            parts.push(`\n  ${e.content.substring(0, 200)}${e.content.length > 200 ? '...' : ''}`);
            return parts.join(' ');
          })
          .join('\n\n');

        logger.debug('terminal_search completed', { user_id, count: entries.length });

        return {
          success: true,
          data: {
            content,
            details: { entries, total, user_id },
          },
        };
      } catch (error) {
        logger.error('terminal_search failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== terminal_annotate ====================

/** Parameters for terminal_annotate */
export const TerminalAnnotateParamsSchema = z.object({
  session_id: z.string().min(1, 'Session ID is required'),
  content: z.string().min(1, 'Annotation content is required').max(5000, 'Content must be 5000 characters or less'),
  tags: z.string().max(500, 'Tags must be 500 characters or less').optional(),
});
export type TerminalAnnotateParams = z.infer<typeof TerminalAnnotateParamsSchema>;

/** Successful annotate result */
export interface TerminalAnnotateSuccess {
  success: true;
  data: {
    content: string;
    details: {
      entry_id: string;
      session_id: string;
      user_id: string;
    };
  };
}

export type TerminalAnnotateResult = TerminalAnnotateSuccess | TerminalSearchFailure;

export interface TerminalAnnotateTool {
  name: string;
  description: string;
  parameters: typeof TerminalAnnotateParamsSchema;
  execute: (params: TerminalAnnotateParams) => Promise<TerminalAnnotateResult>;
}

/**
 * Creates the terminal_annotate tool.
 */
export function createTerminalAnnotateTool(options: TerminalSearchToolOptions): TerminalAnnotateTool {
  const { client, logger, user_id } = options;

  return {
    name: 'terminal_annotate',
    description: 'Add an annotation to a terminal session. Annotations are always embedded for semantic search and exempt from retention cleanup.',
    parameters: TerminalAnnotateParamsSchema,

    async execute(params: TerminalAnnotateParams): Promise<TerminalAnnotateResult> {
      const parseResult = TerminalAnnotateParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { session_id, content, tags } = parseResult.data;

      if (!isValidUuid(session_id)) {
        return { success: false, error: 'Invalid session ID format. Expected UUID.' };
      }

      const sanitizedContent = stripHtml(content);
      if (sanitizedContent.length === 0) {
        return { success: false, error: 'Annotation content cannot be empty after sanitization' };
      }

      logger.info('terminal_annotate invoked', {
        user_id,
        sessionId: session_id,
        contentLength: sanitizedContent.length,
        hasTags: !!tags,
      });

      try {
        const body: Record<string, unknown> = { content: sanitizedContent };
        if (tags) body.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);

        const response = await client.post<{ id: string }>(
          `/api/terminal/sessions/${session_id}/annotate`,
          body,
          { user_id },
        );

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Session not found.' };
          }
          logger.error('terminal_annotate API error', {
            user_id,
            sessionId: session_id,
            status: response.error.status,
          });
          return { success: false, error: response.error.message || 'Failed to create annotation' };
        }

        logger.debug('terminal_annotate completed', {
          user_id,
          sessionId: session_id,
          entryId: response.data.id,
        });

        return {
          success: true,
          data: {
            content: `Annotation added to session ${session_id} (entry ID: ${response.data.id})`,
            details: {
              entry_id: response.data.id,
              session_id,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('terminal_annotate failed', {
          user_id,
          sessionId: session_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
