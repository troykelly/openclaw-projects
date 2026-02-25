/**
 * OpenAPI path definitions for Terminal Session lifecycle.
 *
 * Covers session CRUD, resize, annotate, WebSocket attach,
 * and window/pane management.
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

export function terminalSessionsPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Sessions',
        description: 'TMux session lifecycle, windows, and panes',
      },
    ],

    schemas: {
      TerminalSession: {
        type: 'object',
        required: ['id', 'namespace', 'connection_id', 'tmux_session_name', 'status', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          connection_id: { type: 'string', format: 'uuid' },
          tmux_session_name: { type: 'string', description: 'TMux session name on the host' },
          worker_id: { type: 'string', nullable: true, description: 'Worker instance owning this session' },
          status: {
            type: 'string',
            enum: ['starting', 'active', 'idle', 'disconnected', 'terminated', 'error', 'pending_host_verification'],
          },
          cols: { type: 'integer', default: 120, description: 'Terminal width' },
          rows: { type: 'integer', default: 40, description: 'Terminal height' },
          capture_interval_s: { type: 'integer', default: 30, description: 'Scrollback capture frequency (0 = disabled)' },
          capture_on_command: { type: 'boolean', default: true },
          embed_commands: { type: 'boolean', default: true, description: 'Auto-embed command entries' },
          embed_scrollback: { type: 'boolean', default: false },
          started_at: { type: 'string', format: 'date-time', nullable: true },
          last_activity_at: { type: 'string', format: 'date-time', nullable: true },
          terminated_at: { type: 'string', format: 'date-time', nullable: true },
          exit_code: { type: 'integer', nullable: true },
          error_message: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          windows: {
            type: 'array',
            description: 'Included in GET /sessions/:id responses',
            items: ref('TerminalSessionWindow'),
          },
        },
      },

      TerminalSessionCreateInput: {
        type: 'object',
        required: ['connection_id'],
        properties: {
          connection_id: { type: 'string', format: 'uuid' },
          tmux_session_name: { type: 'string', description: 'Defaults to session-{timestamp} if omitted' },
          cols: { type: 'integer', default: 120 },
          rows: { type: 'integer', default: 40 },
          capture_on_command: { type: 'boolean', default: true },
          embed_commands: { type: 'boolean', default: true },
          embed_scrollback: { type: 'boolean', default: false },
          capture_interval_s: { type: 'integer', default: 30 },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
      },

      TerminalSessionUpdateInput: {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string', nullable: true },
        },
      },

      TerminalSessionWindow: {
        type: 'object',
        required: ['id', 'window_index'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          window_index: { type: 'integer' },
          window_name: { type: 'string', nullable: true },
          is_active: { type: 'boolean', default: false },
          panes: {
            type: 'array',
            items: ref('TerminalSessionPane'),
          },
        },
      },

      TerminalSessionPane: {
        type: 'object',
        required: ['id', 'pane_index'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          pane_index: { type: 'integer' },
          is_active: { type: 'boolean', default: false },
          pid: { type: 'integer', nullable: true, description: 'Process PID' },
          current_command: { type: 'string', nullable: true, description: 'Running command (e.g. vim, htop)' },
        },
      },

      TerminalResizeInput: {
        type: 'object',
        required: ['cols', 'rows'],
        properties: {
          cols: { type: 'integer', description: 'New terminal width', minimum: 1 },
          rows: { type: 'integer', description: 'New terminal height', minimum: 1 },
        },
      },

      TerminalAnnotateInput: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', description: 'Annotation text' },
          metadata: { type: 'object', additionalProperties: true, description: 'Optional metadata' },
        },
      },
    },

    paths: {
      '/api/terminal/sessions': {
        get: {
          operationId: 'listTerminalSessions',
          summary: 'List terminal sessions',
          description: 'Returns a paginated list of sessions, optionally filtered by connection or status.',
          tags: ['Terminal Sessions'],
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
              name: 'status',
              in: 'query',
              description: 'Filter by session status',
              schema: {
                type: 'string',
                enum: ['starting', 'active', 'idle', 'disconnected', 'terminated', 'error', 'pending_host_verification'],
              },
            },
          ],
          responses: {
            '200': jsonResponse('List of sessions', {
              type: 'object',
              properties: {
                sessions: { type: 'array', items: ref('TerminalSession') },
                total: { type: 'integer' },
              },
            }),
            ...errorResponses(403, 500),
          },
        },
        post: {
          operationId: 'createTerminalSession',
          summary: 'Create a terminal session',
          description: 'Creates a new TMux session via the gRPC worker.',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalSessionCreateInput')),
          responses: {
            '201': jsonResponse('Created session', ref('TerminalSession')),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/sessions/{id}': {
        parameters: [uuidParam('id', 'Session UUID')],
        get: {
          operationId: 'getTerminalSession',
          summary: 'Get session details',
          description: 'Returns session details including windows and panes.',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          responses: {
            '200': jsonResponse('Session details with windows and panes', ref('TerminalSession')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        patch: {
          operationId: 'updateTerminalSession',
          summary: 'Update session notes/tags',
          description: 'Updates session metadata (notes and tags).',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalSessionUpdateInput')),
          responses: {
            '200': jsonResponse('Updated session', ref('TerminalSession')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'terminateTerminalSession',
          summary: 'Terminate a session',
          description: 'Terminates a TMux session via the gRPC worker.',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          responses: {
            '204': { description: 'Session terminated' },
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/sessions/{id}/resize': {
        parameters: [uuidParam('id', 'Session UUID')],
        post: {
          operationId: 'resizeTerminalSession',
          summary: 'Resize terminal',
          description: 'Resizes the terminal dimensions via the gRPC worker.',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalResizeInput')),
          responses: {
            '200': jsonResponse('Resize result', {
              type: 'object',
              properties: { success: { type: 'boolean' } },
            }),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/sessions/{id}/annotate': {
        parameters: [uuidParam('id', 'Session UUID')],
        post: {
          operationId: 'annotateTerminalSession',
          summary: 'Add annotation to session',
          description: 'Creates an annotation entry in the session history.',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalAnnotateInput')),
          responses: {
            '201': jsonResponse('Created annotation entry', ref('TerminalSessionEntry')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/terminal/sessions/{id}/attach': {
        parameters: [uuidParam('id', 'Session UUID')],
        get: {
          operationId: 'attachTerminalSession',
          summary: 'WebSocket terminal attach',
          description:
            'Upgrades to a WebSocket connection for interactive terminal I/O. ' +
            'Authentication via JWT query parameter (?token=) or Authorization header. ' +
            'Sends binary terminal output frames; receives binary terminal input.',
          tags: ['Terminal Sessions'],
          parameters: [
            {
              name: 'token',
              in: 'query',
              description: 'JWT access token for WebSocket authentication',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '101': { description: 'WebSocket upgrade successful — interactive terminal stream' },
            ...errorResponses(400, 401, 404),
          },
        },
      },

      '/api/terminal/sessions/{id}/windows': {
        parameters: [uuidParam('id', 'Session UUID')],
        post: {
          operationId: 'createTerminalWindow',
          summary: 'Create a new window',
          description: 'Creates a new TMux window in the session via gRPC.',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Optional window name' },
            },
          }, false),
          responses: {
            '201': jsonResponse('Created window', ref('TerminalSessionWindow')),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/sessions/{sid}/windows/{wid}': {
        parameters: [
          uuidParam('sid', 'Session UUID'),
          {
            name: 'wid',
            in: 'path',
            required: true,
            description: 'Window index',
            schema: { type: 'integer', minimum: 0 },
          },
        ],
        delete: {
          operationId: 'closeTerminalWindow',
          summary: 'Close a window',
          description: 'Closes a TMux window by index via gRPC.',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          responses: {
            '204': { description: 'Window closed' },
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/sessions/{sid}/windows/{wid}/split': {
        parameters: [
          uuidParam('sid', 'Session UUID'),
          {
            name: 'wid',
            in: 'path',
            required: true,
            description: 'Window index',
            schema: { type: 'integer', minimum: 0 },
          },
        ],
        post: {
          operationId: 'splitTerminalPane',
          summary: 'Split a pane',
          description: 'Splits a pane in the specified window via gRPC.',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              direction: {
                type: 'string',
                enum: ['horizontal', 'vertical'],
                default: 'vertical',
                description: 'Split direction',
              },
            },
          }, false),
          responses: {
            '201': jsonResponse('Created pane', ref('TerminalSessionPane')),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/sessions/{sid}/panes/{pid}': {
        parameters: [
          uuidParam('sid', 'Session UUID'),
          {
            name: 'pid',
            in: 'path',
            required: true,
            description: 'Pane index',
            schema: { type: 'integer', minimum: 0 },
          },
        ],
        delete: {
          operationId: 'closeTerminalPane',
          summary: 'Close a pane',
          description: 'Closes a pane by index via gRPC.',
          tags: ['Terminal Sessions'],
          parameters: [namespaceParam()],
          responses: {
            '204': { description: 'Pane closed' },
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },
    },
  };
}
