/**
 * OpenAPI path definitions for Terminal session entries (history).
 *
 * Covers entry listing and export.
 * Epic #1667 — TMux Session Management.
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  ref,
  uuidParam,
  paginationParams,
  errorResponses,
  jsonResponse,
  namespaceParam,
} from '../helpers.ts';

export function terminalEntriesPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Entries',
        description: 'Session history entries — commands, output, scrollback, annotations',
      },
    ],

    schemas: {
      TerminalSessionEntry: {
        type: 'object',
        required: ['id', 'session_id', 'namespace', 'kind', 'content', 'sequence', 'captured_at', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          session_id: { type: 'string', format: 'uuid' },
          pane_id: { type: 'string', format: 'uuid', nullable: true },
          namespace: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['command', 'output', 'scrollback', 'annotation', 'error'],
          },
          content: { type: 'string' },
          is_embedded: { type: 'boolean', description: 'Whether this entry has been embedded via pgvector' },
          sequence: { type: 'integer', description: 'Ordering within session' },
          captured_at: { type: 'string', format: 'date-time' },
          metadata: { type: 'object', nullable: true, additionalProperties: true, description: 'Entry-specific metadata (exit_code, duration_ms, etc.)' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },

    paths: {
      '/api/terminal/sessions/{id}/entries': {
        parameters: [uuidParam('id', 'Session UUID')],
        get: {
          operationId: 'listTerminalEntries',
          summary: 'List session entries',
          description: 'Returns a paginated list of session entries (commands, output, annotations, etc.).',
          tags: ['Terminal Entries'],
          parameters: [
            namespaceParam(),
            ...paginationParams(),
            {
              name: 'kind',
              in: 'query',
              description: 'Comma-separated entry kinds to include',
              schema: { type: 'string' },
              example: 'command,output',
            },
            {
              name: 'from',
              in: 'query',
              description: 'Start time (ISO 8601)',
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'to',
              in: 'query',
              description: 'End time (ISO 8601)',
              schema: { type: 'string', format: 'date-time' },
            },
          ],
          responses: {
            '200': jsonResponse('List of entries', {
              type: 'object',
              properties: {
                entries: { type: 'array', items: ref('TerminalSessionEntry') },
                total: { type: 'integer' },
              },
            }),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/terminal/sessions/{id}/entries/export': {
        parameters: [uuidParam('id', 'Session UUID')],
        get: {
          operationId: 'exportTerminalEntries',
          summary: 'Export session entries',
          description: 'Exports all session entries as plain text or markdown.',
          tags: ['Terminal Entries'],
          parameters: [
            namespaceParam(),
            {
              name: 'format',
              in: 'query',
              description: 'Export format',
              schema: { type: 'string', enum: ['text', 'markdown'], default: 'text' },
            },
          ],
          responses: {
            '200': {
              description: 'Exported session content',
              content: {
                'text/plain': {
                  schema: { type: 'string', description: 'Plain text export' },
                },
                'text/markdown': {
                  schema: { type: 'string', description: 'Markdown export' },
                },
              },
            },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
    },
  };
}
