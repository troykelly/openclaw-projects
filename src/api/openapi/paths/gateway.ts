/**
 * OpenAPI path definitions for Gateway WebSocket endpoints.
 * Routes: GET /gateway/status
 *
 * Issue #2162 — OpenAPI spec for gateway WebSocket connection.
 * Epic #2153 — API-to-Gateway Permanent WebSocket Connection.
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonResponse } from '../helpers.ts';

export function gatewayPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Gateway', description: 'Gateway WebSocket connection management and status' },
    ],
    schemas: {
      GatewayStatus: {
        type: 'object',
        required: ['connected', 'configured'],
        properties: {
          connected: {
            type: 'boolean',
            description: 'Whether the API server is currently connected to the OpenClaw gateway via WebSocket',
          },
          configured: {
            type: 'boolean',
            description: 'Whether OPENCLAW_GATEWAY_URL is set and the gateway connection was attempted. When false, the gateway is not in use and no degraded banner should be shown.',
          },
          gateway_url: {
            type: 'string',
            nullable: true,
            description: 'Gateway host (without credentials). Null when not configured.',
          },
          connected_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'When the last successful connection was established. Null if never connected.',
          },
          last_tick_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'When the last heartbeat tick was received. Null if no tick received yet.',
          },
          metrics: {
            type: 'object',
            description: 'In-memory counters for gateway WebSocket lifecycle events. Reset on server restart.',
            properties: {
              connect_attempts: {
                type: 'integer',
                description: 'Total connection attempts',
              },
              reconnects: {
                type: 'integer',
                description: 'Total reconnection attempts (excludes first connect)',
              },
              events_received: {
                type: 'integer',
                description: 'Total events received from gateway',
              },
              chat_events_routed: {
                type: 'integer',
                description: 'Total chat events routed to users',
              },
              duplicate_events_suppressed: {
                type: 'integer',
                description: 'Total duplicate events suppressed by dedup',
              },
              auth_failures: {
                type: 'integer',
                description: 'Total authentication failures',
              },
              chat_dispatch_ws: {
                type: 'integer',
                description: 'Total chat messages dispatched via WebSocket',
              },
              chat_dispatch_http: {
                type: 'integer',
                description: 'Total chat messages dispatched via HTTP fallback',
              },
            },
          },
        },
      },
    },
    paths: {
      '/gateway/status': {
        get: {
          operationId: 'getGatewayStatus',
          summary: 'Gateway WebSocket connection status',
          description:
            'Returns the current connection state of the API server\'s permanent WebSocket connection to the OpenClaw gateway, including lifecycle metrics.',
          tags: ['Gateway'],
          responses: {
            '200': jsonResponse('Gateway connection status', {
              $ref: '#/components/schemas/GatewayStatus',
            }),
            ...errorResponses(401),
          },
        },
      },
    },
  };
}
