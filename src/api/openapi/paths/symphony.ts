/**
 * OpenAPI path definitions for Symphony orchestration endpoints.
 * Routes: GET /api/symphony/feed (WebSocket), GET /api/symphony/feed/stats,
 *         GET /api/symphony/dead-letter, POST /api/symphony/dead-letter/:id/resolve
 * Issue #2205, #2212
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonResponse } from '../helpers.ts';

export function symphonyPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Symphony', description: 'Symphony orchestration WebSocket feed, dead-letter queue, and observability' },
    ],
    schemas: {
      SymphonyFeedEvent: {
        type: 'object',
        required: ['type', 'data', 'timestamp', 'namespace'],
        properties: {
          type: {
            type: 'string',
            enum: [
              'symphony:run_state_changed',
              'symphony:stage_updated',
              'symphony:provisioning_progress',
              'symphony:run_failed',
              'symphony:run_succeeded',
              'symphony:queue_changed',
              'symphony:heartbeat',
            ],
            description: 'Symphony event type',
          },
          data: {
            type: 'object',
            description: 'Event payload data',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the event was emitted',
          },
          namespace: {
            type: 'string',
            description: 'Namespace this event belongs to',
          },
        },
      },
      SymphonyFeedStatsResponse: {
        type: 'object',
        required: ['total_connections', 'authenticated_connections'],
        properties: {
          total_connections: {
            type: 'integer',
            description: 'Total WebSocket connections (including unauthenticated)',
          },
          authenticated_connections: {
            type: 'integer',
            description: 'Number of authenticated connections',
          },
        },
      },
      SymphonyDeadLetterEntry: {
        type: 'object',
        required: ['id', 'namespace', 'payload', 'error', 'source', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          payload: { type: 'object', description: 'Failed write payload' },
          error: { type: 'string', description: 'Error message from the failed write' },
          source: { type: 'string', description: 'Source of the write (e.g. run_event, activity)' },
          created_at: { type: 'string', format: 'date-time' },
          resolved_at: { type: 'string', format: 'date-time', nullable: true },
          resolved_by: { type: 'string', nullable: true },
        },
      },
    },
    paths: {
      '/api/symphony/feed': {
        get: {
          operationId: 'connectSymphonyFeed',
          summary: 'Symphony WebSocket feed',
          description:
            'Establishes a WebSocket connection for real-time Symphony orchestration events. ' +
            'Authenticate via JWT in the Authorization header or send a `{ type: "auth", token: "..." }` message within 5 seconds. ' +
            'Events are namespace-scoped. Use `auth_refresh` messages to refresh expired tokens mid-connection.',
          tags: ['Symphony'],
          parameters: [
            {
              name: 'Authorization',
              in: 'header',
              description: 'Bearer JWT access token',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '101': { description: 'WebSocket upgrade successful' },
            '401': { description: 'Unauthorized — close code 4001' },
          },
        },
      },
      '/api/symphony/feed/stats': {
        get: {
          operationId: 'getSymphonyFeedStats',
          summary: 'Symphony feed connection stats',
          description: 'Returns the number of active Symphony feed connections.',
          tags: ['Symphony'],
          responses: {
            '200': jsonResponse('Feed stats', { $ref: '#/components/schemas/SymphonyFeedStatsResponse' }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/symphony/dead-letter': {
        get: {
          operationId: 'getSymphonyDeadLetters',
          summary: 'List unresolved dead-letter entries',
          description: 'Returns unresolved dead-letter queue entries for Symphony durable writes.',
          tags: ['Symphony'],
          parameters: [
            { name: 'namespace', in: 'query', schema: { type: 'string' } },
            { name: 'source', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          ],
          responses: {
            '200': jsonResponse('Dead-letter entries', {
              type: 'array',
              items: { $ref: '#/components/schemas/SymphonyDeadLetterEntry' },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/symphony/dead-letter/{id}/resolve': {
        post: {
          operationId: 'resolveSymphonyDeadLetter',
          summary: 'Resolve a dead-letter entry',
          description: 'Marks a dead-letter entry as resolved (replayed or dismissed).',
          tags: ['Symphony'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': jsonResponse('Resolved', { type: 'object', properties: { resolved: { type: 'boolean' } } }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
    },
  };
}
