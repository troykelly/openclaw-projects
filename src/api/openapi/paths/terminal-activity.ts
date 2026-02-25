/**
 * OpenAPI path definitions for Terminal activity/audit log.
 *
 * Epic #1667 — TMux Session Management.
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  ref,
  paginationParams,
  errorResponses,
  jsonResponse,
  namespaceParam,
} from '../helpers.ts';

export function terminalActivityPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Activity',
        description: 'Terminal audit trail and activity log',
      },
    ],

    schemas: {
      TerminalActivity: {
        type: 'object',
        required: ['id', 'namespace', 'actor', 'action', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          session_id: { type: 'string', format: 'uuid', nullable: true },
          connection_id: { type: 'string', format: 'uuid', nullable: true },
          actor: { type: 'string', description: 'Agent ID, user ID, or "system"' },
          action: { type: 'string', description: 'Action type (e.g. session.create, command.send)', example: 'session.create' },
          detail: { type: 'object', nullable: true, additionalProperties: true, description: 'Action-specific metadata' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },

    paths: {
      '/api/terminal/activity': {
        get: {
          operationId: 'listTerminalActivity',
          summary: 'Query terminal audit trail',
          description: 'Returns a paginated audit log of terminal actions, filtered by session, connection, actor, action, or date range.',
          tags: ['Terminal Activity'],
          parameters: [
            namespaceParam(),
            ...paginationParams(),
            {
              name: 'session_id',
              in: 'query',
              description: 'Filter by session UUID',
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'connection_id',
              in: 'query',
              description: 'Filter by connection UUID',
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'actor',
              in: 'query',
              description: 'Filter by actor (agent/user ID)',
              schema: { type: 'string' },
            },
            {
              name: 'action',
              in: 'query',
              description: 'Filter by action type',
              schema: { type: 'string' },
              example: 'session.create',
            },
            {
              name: 'from',
              in: 'query',
              description: 'Start of date range (ISO 8601)',
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'to',
              in: 'query',
              description: 'End of date range (ISO 8601)',
              schema: { type: 'string', format: 'date-time' },
            },
          ],
          responses: {
            '200': jsonResponse('Activity log', {
              type: 'object',
              properties: {
                items: { type: 'array', items: ref('TerminalActivity') },
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
              },
            }),
            ...errorResponses(400, 403, 500),
          },
        },
      },
    },
  };
}
