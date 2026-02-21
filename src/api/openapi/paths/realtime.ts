/**
 * OpenAPI path definitions for realtime communication endpoints.
 * Routes: GET /api/ws (WebSocket), GET /api/ws/stats,
 *         GET /api/events (SSE), GET /api/activity/stream (SSE)
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonResponse } from '../helpers.ts';

export function realtimePaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Realtime', description: 'WebSocket, SSE, and real-time streaming endpoints' },
    ],
    schemas: {
      WebSocketStatsResponse: {
        type: 'object',
        required: ['connected_clients'],
        properties: {
          connected_clients: {
            type: 'integer',
            description: 'Number of currently connected WebSocket clients',
            example: 42,
          },
        },
      },
      SSEConnectionEvent: {
        type: 'object',
        properties: {
          event: {
            type: 'string',
            description: 'SSE event type identifier',
            example: 'connection:established',
          },
          data: {
            type: 'object',
            description: 'Event payload data',
            properties: {
              connected_at: {
                type: 'string',
                format: 'date-time',
                description: 'Timestamp when the SSE connection was established',
                example: '2026-02-21T14:30:00Z',
              },
            },
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the event was emitted',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      ActivityStreamEvent: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the activity event',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          type: {
            type: 'string',
            description: 'Activity type indicating what action occurred',
            example: 'work_item.updated',
          },
          work_item_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the work item associated with this activity',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          work_item_title: {
            type: 'string',
            description: 'Title of the associated work item',
            example: 'Fix login bug',
          },
          entity_type: {
            type: 'string',
            description: 'Type of entity that was affected (e.g. "task", "project")',
            example: 'task',
          },
          actor_email: {
            type: 'string',
            format: 'email',
            nullable: true,
            description: 'Email of the user or agent that performed the action',
            example: 'alice@example.com',
          },
          description: {
            type: 'string',
            nullable: true,
            description: 'Human-readable description of what happened',
            example: 'Status changed from "in_progress" to "done"',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the activity occurred',
            example: '2026-02-21T14:30:00Z',
          },
          read_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the activity was marked as read (null if unread)',
            example: null,
          },
        },
      },
    },
    paths: {
      '/api/ws': {
        get: {
          operationId: 'connectWebSocket',
          summary: 'WebSocket connection',
          description: 'Establishes a WebSocket connection for real-time updates. Authenticates via JWT in the Authorization header or via a `token` query parameter. Sends connection:ping events and expects connection:pong responses for heartbeat.',
          tags: ['Realtime'],
          parameters: [
            {
              name: 'token',
              in: 'query',
              description: 'JWT access token (for WebSocket clients that cannot set HTTP headers)',
              example: 'eyJhbGciOiJSUzI1NiIs...',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '101': {
              description: 'WebSocket upgrade successful — connection established',
            },
            '401': {
              description: 'Unauthorized — missing or invalid token (WebSocket close code 4001)',
            },
            '426': {
              description: 'Upgrade Required — request must use WebSocket protocol upgrade',
            },
          },
        },
      },
      '/api/ws/stats': {
        get: {
          operationId: 'getWebSocketStats',
          summary: 'WebSocket connection stats',
          description: 'Returns the number of currently connected WebSocket clients. Useful for monitoring.',
          tags: ['Realtime'],
          responses: {
            '200': jsonResponse('WebSocket stats', { $ref: '#/components/schemas/WebSocketStatsResponse' }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/events': {
        get: {
          operationId: 'subscribeEvents',
          summary: 'SSE event stream',
          description: 'Server-Sent Events (SSE) fallback for clients that cannot use WebSockets. Sends an initial connection:established event followed by periodic keepalive comments every 30 seconds. Requires JWT authentication.',
          tags: ['Realtime'],
          responses: {
            '200': {
              description: 'SSE event stream',
              content: {
                'text/event-stream': {
                  schema: {
                    type: 'string',
                    description: 'Server-sent events stream with event types: connection:established, keepalive, and domain events',
                    example: 'event: connection:established\ndata: {"connected_at":"2026-02-21T14:30:00Z"}\n\n',
                  },
                },
              },
            },
            ...errorResponses(401),
          },
        },
      },
    },
  };
}
