/**
 * OpenAPI path definitions for Terminal semantic search.
 *
 * Epic #1667 — TMux Session Management.
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  ref,
  errorResponses,
  jsonBody,
  jsonResponse,
  namespaceParam,
} from '../helpers.ts';

export function terminalSearchPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Search',
        description: 'Semantic search across terminal session entries',
      },
    ],

    schemas: {
      TerminalSearchRequest: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search query text' },
          connection_id: { type: 'string', format: 'uuid', description: 'Filter by connection' },
          session_id: { type: 'string', format: 'uuid', description: 'Filter by session' },
          kind: {
            type: 'array',
            items: { type: 'string', enum: ['command', 'output', 'scrollback', 'annotation', 'error'] },
            description: 'Filter by entry kinds',
          },
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by session tags' },
          host: { type: 'string', description: 'Filter by connection host (partial match)' },
          session_name: { type: 'string', description: 'Filter by session name (partial match)' },
          date_from: { type: 'string', format: 'date-time', description: 'Start of date range' },
          date_to: { type: 'string', format: 'date-time', description: 'End of date range' },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          offset: { type: 'integer', default: 0, minimum: 0 },
        },
      },

      TerminalSearchResultItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          session_id: { type: 'string', format: 'uuid' },
          session_name: { type: 'string' },
          connection_name: { type: 'string' },
          connection_host: { type: 'string' },
          kind: { type: 'string', enum: ['command', 'output', 'scrollback', 'annotation', 'error'] },
          content: { type: 'string' },
          captured_at: { type: 'string', format: 'date-time' },
          similarity: { type: 'number', description: 'Relevance score' },
          context: {
            type: 'object',
            properties: {
              before: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    content: { type: 'string' },
                  },
                },
              },
              after: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string' },
                    content: { type: 'string' },
                  },
                },
              },
            },
            description: 'Surrounding entries for context',
          },
          metadata: { type: 'object', nullable: true, additionalProperties: true },
        },
      },

      TerminalSearchResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: ref('TerminalSearchResultItem') },
          total: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          search_mode: {
            type: 'string',
            enum: ['semantic', 'text'],
            description: 'Whether search used pgvector cosine similarity (semantic) or ILIKE text matching (text fallback)',
          },
        },
      },
    },

    paths: {
      '/api/terminal/search': {
        post: {
          operationId: 'searchTerminalEntries',
          summary: 'Semantic search across terminal entries',
          description:
            'Searches terminal session entries using pgvector cosine similarity when embeddings are available, ' +
            'with ILIKE text matching as fallback. Supports filters for connection, session, entry kind, tags, host, date range. ' +
            'Results include surrounding context entries and a similarity score.',
          tags: ['Terminal Search'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalSearchRequest')),
          responses: {
            '200': jsonResponse('Search results', ref('TerminalSearchResponse')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
    },
  };
}
