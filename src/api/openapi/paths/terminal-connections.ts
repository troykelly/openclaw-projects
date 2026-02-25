/**
 * OpenAPI path definitions for Terminal Connection management.
 *
 * Covers connection CRUD, connectivity testing, and SSH config import.
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
  searchParam,
} from '../helpers.ts';

export function terminalConnectionsPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Connections',
        description: 'SSH connection definitions for terminal sessions',
      },
    ],

    schemas: {
      TerminalConnection: {
        type: 'object',
        required: ['id', 'namespace', 'name', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          name: { type: 'string', description: 'Human label for the connection', example: 'prod-web-1' },
          host: { type: 'string', nullable: true, description: 'Hostname or IP (null for local)', example: '10.0.1.5' },
          port: { type: 'integer', default: 22, description: 'SSH port' },
          username: { type: 'string', nullable: true, description: 'SSH user' },
          auth_method: {
            type: 'string',
            nullable: true,
            enum: ['key', 'password', 'agent', 'command'],
            description: 'Authentication method',
          },
          credential_id: { type: 'string', format: 'uuid', nullable: true, description: 'FK to terminal_credential' },
          proxy_jump_id: { type: 'string', format: 'uuid', nullable: true, description: 'FK to another connection for jump host chaining' },
          is_local: { type: 'boolean', default: false, description: 'True for local tmux (no SSH)' },
          env: { type: 'object', nullable: true, additionalProperties: { type: 'string' }, description: 'Environment variables' },
          connect_timeout_s: { type: 'integer', default: 30 },
          keepalive_interval: { type: 'integer', default: 60, description: 'SSH keepalive in seconds' },
          idle_timeout_s: { type: 'integer', nullable: true, description: 'Auto-disconnect after idle (null = no limit)' },
          max_sessions: { type: 'integer', nullable: true, description: 'Max concurrent sessions (null = no limit)' },
          host_key_policy: {
            type: 'string',
            default: 'strict',
            enum: ['strict', 'tofu', 'skip'],
            description: 'Host key verification policy',
          },
          tags: { type: 'array', items: { type: 'string' }, description: 'Filterable labels' },
          notes: { type: 'string', nullable: true },
          last_connected_at: { type: 'string', format: 'date-time', nullable: true },
          last_error: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },

      TerminalConnectionCreateInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Human label for the connection' },
          host: { type: 'string', nullable: true },
          port: { type: 'integer', default: 22 },
          username: { type: 'string', nullable: true },
          auth_method: { type: 'string', enum: ['key', 'password', 'agent', 'command'] },
          credential_id: { type: 'string', format: 'uuid', nullable: true },
          proxy_jump_id: { type: 'string', format: 'uuid', nullable: true },
          is_local: { type: 'boolean', default: false },
          env: { type: 'object', nullable: true, additionalProperties: { type: 'string' } },
          connect_timeout_s: { type: 'integer', default: 30 },
          keepalive_interval: { type: 'integer', default: 60 },
          idle_timeout_s: { type: 'integer', nullable: true },
          max_sessions: { type: 'integer', nullable: true },
          host_key_policy: { type: 'string', enum: ['strict', 'tofu', 'skip'], default: 'strict' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', nullable: true },
        },
      },

      TerminalConnectionUpdateInput: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          host: { type: 'string', nullable: true },
          port: { type: 'integer' },
          username: { type: 'string', nullable: true },
          auth_method: { type: 'string', enum: ['key', 'password', 'agent', 'command'] },
          credential_id: { type: 'string', format: 'uuid', nullable: true },
          proxy_jump_id: { type: 'string', format: 'uuid', nullable: true },
          is_local: { type: 'boolean' },
          env: { type: 'object', nullable: true, additionalProperties: { type: 'string' } },
          connect_timeout_s: { type: 'integer' },
          keepalive_interval: { type: 'integer' },
          idle_timeout_s: { type: 'integer', nullable: true },
          max_sessions: { type: 'integer', nullable: true },
          host_key_policy: { type: 'string', enum: ['strict', 'tofu', 'skip'] },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', nullable: true },
        },
      },

      TerminalConnectionTestResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: 'Whether the connection test succeeded' },
          latency_ms: { type: 'number', description: 'Connection latency in milliseconds' },
          error: { type: 'string', nullable: true, description: 'Error message if test failed' },
        },
      },

      TerminalSSHImportResult: {
        type: 'object',
        properties: {
          imported: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
              },
            },
          },
          count: { type: 'integer', description: 'Number of imported connections' },
        },
      },
    },

    paths: {
      '/api/terminal/connections': {
        get: {
          operationId: 'listTerminalConnections',
          summary: 'List terminal connections',
          description: 'Returns a paginated list of SSH connections, filtered by search term, tags, or local flag.',
          tags: ['Terminal Connections'],
          parameters: [
            namespaceParam(),
            ...paginationParams(),
            searchParam('Search by connection name or host'),
            {
              name: 'tags',
              in: 'query',
              description: 'Comma-separated tags to filter by (overlap match)',
              schema: { type: 'string' },
              example: 'production,web',
            },
            {
              name: 'is_local',
              in: 'query',
              description: 'Filter by local connections only',
              schema: { type: 'string', enum: ['true', 'false'] },
            },
          ],
          responses: {
            '200': jsonResponse('List of connections', {
              type: 'object',
              properties: {
                connections: { type: 'array', items: ref('TerminalConnection') },
                total: { type: 'integer' },
              },
            }),
            ...errorResponses(403, 500),
          },
        },
        post: {
          operationId: 'createTerminalConnection',
          summary: 'Create a terminal connection',
          description: 'Creates a new SSH connection definition.',
          tags: ['Terminal Connections'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalConnectionCreateInput')),
          responses: {
            '201': jsonResponse('Created connection', ref('TerminalConnection')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/terminal/connections/{id}': {
        parameters: [uuidParam('id', 'Connection UUID')],
        get: {
          operationId: 'getTerminalConnection',
          summary: 'Get connection details',
          description: 'Returns a single connection by ID.',
          tags: ['Terminal Connections'],
          parameters: [namespaceParam()],
          responses: {
            '200': jsonResponse('Connection details', ref('TerminalConnection')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        patch: {
          operationId: 'updateTerminalConnection',
          summary: 'Update a connection',
          description: 'Partially updates an existing connection.',
          tags: ['Terminal Connections'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalConnectionUpdateInput')),
          responses: {
            '200': jsonResponse('Updated connection', ref('TerminalConnection')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteTerminalConnection',
          summary: 'Soft-delete a connection',
          description: 'Marks a connection as deleted (soft delete).',
          tags: ['Terminal Connections'],
          parameters: [namespaceParam()],
          responses: {
            '204': { description: 'Connection deleted' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/terminal/connections/{id}/test': {
        parameters: [uuidParam('id', 'Connection UUID')],
        post: {
          operationId: 'testTerminalConnection',
          summary: 'Test connection connectivity',
          description: 'Tests SSH connectivity to the host via the gRPC worker.',
          tags: ['Terminal Connections'],
          parameters: [namespaceParam()],
          responses: {
            '200': jsonResponse('Test result', ref('TerminalConnectionTestResult')),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/connections/import-ssh-config': {
        post: {
          operationId: 'importSSHConfig',
          summary: 'Import connections from SSH config',
          description: 'Parses an SSH config file and creates connections for each host entry.',
          tags: ['Terminal Connections'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['config_text'],
            properties: {
              config_text: { type: 'string', description: 'Raw SSH config file content' },
            },
          }),
          responses: {
            '201': jsonResponse('Import result', ref('TerminalSSHImportResult')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
    },
  };
}
