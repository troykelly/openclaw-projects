/**
 * OpenAPI path definitions for terminal management endpoints.
 * Epic #1667 — TMux Session Management.
 *
 * Routes: connections, credentials, sessions, streaming, commands.
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, uuidParam } from '../helpers.ts';

export function terminalPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Terminal', description: 'TMux session management — connections, credentials, sessions, I/O streaming, commands' },
    ],
    schemas: {
      TerminalConnection: {
        type: 'object',
        required: ['id', 'namespace', 'name', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          name: { type: 'string' },
          host: { type: 'string', nullable: true },
          port: { type: 'integer', default: 22 },
          username: { type: 'string', nullable: true },
          auth_method: { type: 'string', enum: ['key', 'password', 'agent', 'command'], nullable: true },
          credential_id: { type: 'string', format: 'uuid', nullable: true },
          proxy_jump_id: { type: 'string', format: 'uuid', nullable: true },
          is_local: { type: 'boolean', default: false },
          env: { type: 'object', nullable: true },
          connect_timeout_s: { type: 'integer', default: 30 },
          keepalive_interval: { type: 'integer', default: 60 },
          idle_timeout_s: { type: 'integer', nullable: true },
          max_sessions: { type: 'integer', nullable: true },
          host_key_policy: { type: 'string', enum: ['strict', 'tofu', 'skip'], default: 'strict' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', nullable: true },
          last_connected_at: { type: 'string', format: 'date-time', nullable: true },
          last_error: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      TerminalCredential: {
        type: 'object',
        description: 'Credential metadata. encrypted_value is NEVER returned.',
        required: ['id', 'namespace', 'name', 'kind', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['ssh_key', 'password', 'command'] },
          command: { type: 'string', nullable: true },
          command_timeout_s: { type: 'integer', default: 10 },
          cache_ttl_s: { type: 'integer', default: 0 },
          fingerprint: { type: 'string', nullable: true },
          public_key: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      TerminalSession: {
        type: 'object',
        required: ['id', 'namespace', 'connection_id', 'tmux_session_name', 'status', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          connection_id: { type: 'string', format: 'uuid' },
          tmux_session_name: { type: 'string' },
          worker_id: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['starting', 'active', 'idle', 'disconnected', 'terminated', 'error', 'pending_host_verification'] },
          cols: { type: 'integer', default: 120 },
          rows: { type: 'integer', default: 40 },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', nullable: true },
          started_at: { type: 'string', format: 'date-time', nullable: true },
          last_activity_at: { type: 'string', format: 'date-time', nullable: true },
          terminated_at: { type: 'string', format: 'date-time', nullable: true },
          exit_code: { type: 'integer', nullable: true },
          error_message: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      TerminalSessionEntry: {
        type: 'object',
        required: ['id', 'session_id', 'namespace', 'kind', 'content'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          session_id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          kind: { type: 'string', enum: ['command', 'output', 'scrollback', 'annotation', 'error'] },
          content: { type: 'string' },
          metadata: { type: 'object', nullable: true },
          sequence: { type: 'integer' },
          captured_at: { type: 'string', format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      SendCommandResponse: {
        type: 'object',
        properties: {
          output: { type: 'string' },
          timed_out: { type: 'boolean' },
          exit_code: { type: 'integer' },
        },
      },
      CapturePaneResponse: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          lines_captured: { type: 'integer' },
        },
      },
      TestConnectionResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          latency_ms: { type: 'number' },
          host_key_fingerprint: { type: 'string' },
        },
      },
      SSHConfigImportResponse: {
        type: 'object',
        properties: {
          imported: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } },
          count: { type: 'integer' },
        },
      },
    },
    paths: {
      // ── Connections ────────────────────────────────
      '/api/terminal/connections': {
        get: {
          tags: ['Terminal'],
          summary: 'List connections',
          operationId: 'listTerminalConnections',
          parameters: [
            ...paginationParams(),
            { name: 'search', in: 'query', description: 'Search by name or host', schema: { type: 'string' } },
            { name: 'tags', in: 'query', description: 'Filter by tags (comma-separated)', schema: { type: 'string' } },
            { name: 'is_local', in: 'query', description: 'Filter local connections', schema: { type: 'string', enum: ['true', 'false'] } },
          ],
          responses: {
            200: jsonResponse('Connection list', {
              type: 'object',
              properties: {
                connections: { type: 'array', items: { $ref: '#/components/schemas/TerminalConnection' } },
                total: { type: 'integer' },
              },
            }),
            ...errorResponses(403),
          },
        },
        post: {
          tags: ['Terminal'],
          summary: 'Create connection',
          operationId: 'createTerminalConnection',
          requestBody: jsonBody({
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              host: { type: 'string' },
              port: { type: 'integer' },
              username: { type: 'string' },
              auth_method: { type: 'string' },
              credential_id: { type: 'string', format: 'uuid' },
              is_local: { type: 'boolean' },
              tags: { type: 'array', items: { type: 'string' } },
              notes: { type: 'string' },
            },
          }),
          responses: {
            201: jsonResponse('Created connection', { $ref: '#/components/schemas/TerminalConnection' }),
            ...errorResponses(400),
          },
        },
      },
      '/api/terminal/connections/{id}': {
        get: {
          tags: ['Terminal'],
          summary: 'Get connection details',
          operationId: 'getTerminalConnection',
          parameters: [uuidParam()],
          responses: {
            200: jsonResponse('Connection details', { $ref: '#/components/schemas/TerminalConnection' }),
            ...errorResponses(404),
          },
        },
        patch: {
          tags: ['Terminal'],
          summary: 'Update connection',
          operationId: 'updateTerminalConnection',
          parameters: [uuidParam()],
          requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, host: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } }),
          responses: {
            200: jsonResponse('Updated connection', { $ref: '#/components/schemas/TerminalConnection' }),
            ...errorResponses(400, 404),
          },
        },
        delete: {
          tags: ['Terminal'],
          summary: 'Soft delete connection',
          operationId: 'deleteTerminalConnection',
          parameters: [uuidParam()],
          responses: { 204: { description: 'Connection deleted' }, ...errorResponses(404) },
        },
      },
      '/api/terminal/connections/{id}/test': {
        post: {
          tags: ['Terminal'],
          summary: 'Test connection',
          operationId: 'testTerminalConnection',
          parameters: [uuidParam()],
          responses: {
            200: jsonResponse('Test result', { $ref: '#/components/schemas/TestConnectionResponse' }),
            ...errorResponses(404, 502),
          },
        },
      },
      '/api/terminal/connections/import-ssh-config': {
        post: {
          tags: ['Terminal'],
          summary: 'Import connections from SSH config',
          operationId: 'importSSHConfig',
          requestBody: jsonBody({ type: 'object', required: ['config_text'], properties: { config_text: { type: 'string' } } }),
          responses: {
            201: jsonResponse('Import result', { $ref: '#/components/schemas/SSHConfigImportResponse' }),
            ...errorResponses(400),
          },
        },
      },

      // ── Credentials ────────────────────────────────
      '/api/terminal/credentials': {
        get: {
          tags: ['Terminal'],
          summary: 'List credentials (metadata only, never returns secrets)',
          operationId: 'listTerminalCredentials',
          parameters: paginationParams(),
          responses: {
            200: jsonResponse('Credential list', {
              type: 'object',
              properties: {
                credentials: { type: 'array', items: { $ref: '#/components/schemas/TerminalCredential' } },
                total: { type: 'integer' },
              },
            }),
            ...errorResponses(403),
          },
        },
        post: {
          tags: ['Terminal'],
          summary: 'Create credential',
          operationId: 'createTerminalCredential',
          requestBody: jsonBody({
            type: 'object',
            required: ['name', 'kind'],
            properties: {
              name: { type: 'string' },
              kind: { type: 'string', enum: ['ssh_key', 'password', 'command'] },
              value: { type: 'string', description: 'Private key or password (encrypted before storage)' },
              command: { type: 'string' },
            },
          }),
          responses: {
            201: jsonResponse('Created credential', { $ref: '#/components/schemas/TerminalCredential' }),
            ...errorResponses(400),
          },
        },
      },
      '/api/terminal/credentials/{id}': {
        get: {
          tags: ['Terminal'],
          summary: 'Get credential metadata',
          operationId: 'getTerminalCredential',
          parameters: [uuidParam()],
          responses: {
            200: jsonResponse('Credential metadata', { $ref: '#/components/schemas/TerminalCredential' }),
            ...errorResponses(404),
          },
        },
        patch: {
          tags: ['Terminal'],
          summary: 'Update credential metadata',
          operationId: 'updateTerminalCredential',
          parameters: [uuidParam()],
          requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, command: { type: 'string' } } }),
          responses: {
            200: jsonResponse('Updated credential', { $ref: '#/components/schemas/TerminalCredential' }),
            ...errorResponses(400, 404),
          },
        },
        delete: {
          tags: ['Terminal'],
          summary: 'Soft delete credential',
          operationId: 'deleteTerminalCredential',
          parameters: [uuidParam()],
          responses: { 204: { description: 'Credential deleted' }, ...errorResponses(404) },
        },
      },
      '/api/terminal/credentials/generate': {
        post: {
          tags: ['Terminal'],
          summary: 'Generate SSH key pair',
          operationId: 'generateTerminalKeyPair',
          requestBody: jsonBody({
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['ed25519', 'rsa'], default: 'ed25519' },
            },
          }),
          responses: {
            201: jsonResponse('Generated key (public key returned, private key encrypted)', { $ref: '#/components/schemas/TerminalCredential' }),
            ...errorResponses(400),
          },
        },
      },

      // ── Sessions ────────────────────────────────
      '/api/terminal/sessions': {
        get: {
          tags: ['Terminal'],
          summary: 'List sessions',
          operationId: 'listTerminalSessions',
          parameters: [
            ...paginationParams(),
            { name: 'connection_id', in: 'query', description: 'Filter by connection', schema: { type: 'string', format: 'uuid' } },
            { name: 'status', in: 'query', description: 'Filter by status', schema: { type: 'string' } },
          ],
          responses: {
            200: jsonResponse('Session list', {
              type: 'object',
              properties: {
                sessions: { type: 'array', items: { $ref: '#/components/schemas/TerminalSession' } },
                total: { type: 'integer' },
              },
            }),
            ...errorResponses(403),
          },
        },
        post: {
          tags: ['Terminal'],
          summary: 'Create session (via gRPC to tmux worker)',
          operationId: 'createTerminalSession',
          requestBody: jsonBody({
            type: 'object',
            required: ['connection_id'],
            properties: {
              connection_id: { type: 'string', format: 'uuid' },
              tmux_session_name: { type: 'string' },
              cols: { type: 'integer' },
              rows: { type: 'integer' },
              tags: { type: 'array', items: { type: 'string' } },
              notes: { type: 'string' },
            },
          }),
          responses: {
            201: jsonResponse('Created session', { $ref: '#/components/schemas/TerminalSession' }),
            ...errorResponses(400, 404, 502),
          },
        },
      },
      '/api/terminal/sessions/{id}': {
        get: {
          tags: ['Terminal'],
          summary: 'Get session details with windows/panes',
          operationId: 'getTerminalSession',
          parameters: [uuidParam()],
          responses: {
            200: jsonResponse('Session details', { $ref: '#/components/schemas/TerminalSession' }),
            ...errorResponses(404),
          },
        },
        patch: {
          tags: ['Terminal'],
          summary: 'Update session notes/tags',
          operationId: 'updateTerminalSession',
          parameters: [uuidParam()],
          requestBody: jsonBody({ type: 'object', properties: { notes: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } }),
          responses: {
            200: jsonResponse('Updated session', { $ref: '#/components/schemas/TerminalSession' }),
            ...errorResponses(400, 404),
          },
        },
        delete: {
          tags: ['Terminal'],
          summary: 'Terminate session (via gRPC)',
          operationId: 'terminateTerminalSession',
          parameters: [uuidParam()],
          responses: { 204: { description: 'Session terminated' }, ...errorResponses(404, 502) },
        },
      },
      '/api/terminal/sessions/{id}/resize': {
        post: {
          tags: ['Terminal'],
          summary: 'Resize terminal',
          operationId: 'resizeTerminalSession',
          parameters: [uuidParam()],
          requestBody: jsonBody({ type: 'object', required: ['cols', 'rows'], properties: { cols: { type: 'integer' }, rows: { type: 'integer' } } }),
          responses: {
            200: jsonResponse('Resize success', { type: 'object', properties: { success: { type: 'boolean' } } }),
            ...errorResponses(400, 404, 502),
          },
        },
      },
      '/api/terminal/sessions/{id}/annotate': {
        post: {
          tags: ['Terminal'],
          summary: 'Add annotation to session',
          operationId: 'annotateTerminalSession',
          parameters: [uuidParam()],
          requestBody: jsonBody({ type: 'object', required: ['content'], properties: { content: { type: 'string' }, metadata: { type: 'object' } } }),
          responses: {
            201: jsonResponse('Created annotation', { $ref: '#/components/schemas/TerminalSessionEntry' }),
            ...errorResponses(400, 404),
          },
        },
      },
      '/api/terminal/sessions/{id}/attach': {
        get: {
          tags: ['Terminal'],
          summary: 'WebSocket terminal attach (bidirectional I/O)',
          operationId: 'attachTerminalSession',
          description: 'Upgrades to WebSocket for interactive terminal I/O. Auth via JWT query param (?token=) or Authorization header.',
          parameters: [
            uuidParam(),
            { name: 'token', in: 'query', description: 'JWT access token', schema: { type: 'string' } },
          ],
          responses: {
            101: { description: 'WebSocket upgrade successful' },
            ...errorResponses(401, 404),
          },
        },
      },

      // ── Command Execution ────────────────────────────────
      '/api/terminal/sessions/{id}/send-command': {
        post: {
          tags: ['Terminal'],
          summary: 'Send command and wait for output',
          operationId: 'sendTerminalCommand',
          parameters: [uuidParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['command'],
            properties: {
              command: { type: 'string' },
              timeout_s: { type: 'integer', default: 30 },
              pane_id: { type: 'string', format: 'uuid' },
            },
          }),
          responses: {
            200: jsonResponse('Command output', { $ref: '#/components/schemas/SendCommandResponse' }),
            ...errorResponses(400, 404, 502),
          },
        },
      },
      '/api/terminal/sessions/{id}/send-keys': {
        post: {
          tags: ['Terminal'],
          summary: 'Send raw keystrokes',
          operationId: 'sendTerminalKeys',
          parameters: [uuidParam()],
          requestBody: jsonBody({ type: 'object', required: ['keys'], properties: { keys: { type: 'string' }, pane_id: { type: 'string' } } }),
          responses: {
            200: jsonResponse('Keys sent', { type: 'object', properties: { success: { type: 'boolean' } } }),
            ...errorResponses(400, 404, 502),
          },
        },
      },
      '/api/terminal/sessions/{id}/capture': {
        get: {
          tags: ['Terminal'],
          summary: 'Capture pane content',
          operationId: 'captureTerminalPane',
          parameters: [
            uuidParam(),
            { name: 'pane_id', in: 'query', description: 'Target pane ID', schema: { type: 'string' } },
            { name: 'lines', in: 'query', description: 'Number of lines to capture', schema: { type: 'integer', default: 100 } },
          ],
          responses: {
            200: jsonResponse('Captured content', { $ref: '#/components/schemas/CapturePaneResponse' }),
            ...errorResponses(404, 502),
          },
        },
      },
    },
  };
}
