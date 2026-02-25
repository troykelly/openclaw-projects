/**
 * OpenAPI path definitions for Terminal SSH tunnel management.
 *
 * Covers tunnel CRUD (local, remote, dynamic/SOCKS).
 * Epic #1667 — TMux Session Management.
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  ref,
  uuidParam,
  paginationParams,
  errorResponses,
  jsonBody,
  jsonResponse,
  namespaceParam,
} from '../helpers.ts';

export function terminalTunnelsPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Tunnels',
        description: 'SSH tunnel management — local, remote, and dynamic (SOCKS)',
      },
    ],

    schemas: {
      TerminalTunnel: {
        type: 'object',
        required: ['id', 'namespace', 'connection_id', 'direction', 'bind_port', 'status', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          connection_id: { type: 'string', format: 'uuid' },
          session_id: { type: 'string', format: 'uuid', nullable: true, description: 'Optional session association' },
          direction: { type: 'string', enum: ['local', 'remote', 'dynamic'] },
          bind_host: { type: 'string', default: '127.0.0.1' },
          bind_port: { type: 'integer', minimum: 1, maximum: 65535 },
          target_host: { type: 'string', nullable: true, description: 'Null for dynamic/SOCKS tunnels' },
          target_port: { type: 'integer', nullable: true },
          status: { type: 'string', enum: ['active', 'failed', 'closed'] },
          error_message: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },

      TerminalTunnelCreateInput: {
        type: 'object',
        required: ['connection_id', 'direction', 'bind_port'],
        properties: {
          connection_id: { type: 'string', format: 'uuid' },
          session_id: { type: 'string', format: 'uuid', description: 'Optional session association' },
          direction: { type: 'string', enum: ['local', 'remote', 'dynamic'] },
          bind_host: { type: 'string', default: '127.0.0.1' },
          bind_port: { type: 'integer', minimum: 1, maximum: 65535 },
          target_host: { type: 'string', description: 'Required for local and remote tunnels' },
          target_port: { type: 'integer', minimum: 1, maximum: 65535, description: 'Required for local and remote tunnels' },
        },
      },
    },

    paths: {
      '/api/terminal/tunnels': {
        get: {
          operationId: 'listTerminalTunnels',
          summary: 'List SSH tunnels',
          description: 'Returns a paginated list of tunnels, optionally filtered by connection, direction, or status.',
          tags: ['Terminal Tunnels'],
          parameters: [
            namespaceParam(),
            ...paginationParams(),
            {
              name: 'connection_id',
              in: 'query',
              description: 'Filter by connection UUID',
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'direction',
              in: 'query',
              description: 'Filter by tunnel direction',
              schema: { type: 'string', enum: ['local', 'remote', 'dynamic'] },
            },
            {
              name: 'status',
              in: 'query',
              description: 'Filter by tunnel status',
              schema: { type: 'string', enum: ['active', 'failed', 'closed'] },
            },
          ],
          responses: {
            '200': jsonResponse('List of tunnels', {
              type: 'object',
              properties: {
                tunnels: { type: 'array', items: ref('TerminalTunnel') },
                total: { type: 'integer' },
              },
            }),
            ...errorResponses(403, 500),
          },
        },
        post: {
          operationId: 'createTerminalTunnel',
          summary: 'Create an SSH tunnel',
          description: 'Creates a new SSH tunnel (local, remote, or dynamic/SOCKS) via the gRPC worker.',
          tags: ['Terminal Tunnels'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalTunnelCreateInput')),
          responses: {
            '201': jsonResponse('Created tunnel', ref('TerminalTunnel')),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/tunnels/{id}': {
        parameters: [uuidParam('id', 'Tunnel UUID')],
        delete: {
          operationId: 'closeTerminalTunnel',
          summary: 'Close an SSH tunnel',
          description: 'Closes an active tunnel via the gRPC worker.',
          tags: ['Terminal Tunnels'],
          parameters: [namespaceParam()],
          responses: {
            '204': { description: 'Tunnel closed' },
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },
    },
  };
}
