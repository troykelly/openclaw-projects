/**
 * OpenAPI path definitions for Terminal command execution.
 *
 * Covers send-command, send-keys, and pane capture.
 * Epic #1667 — TMux Session Management.
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  ref,
  uuidParam,
  errorResponses,
  jsonBody,
  jsonResponse,
  namespaceParam,
} from '../helpers.ts';

export function terminalCommandsPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Commands',
        description: 'Send commands and keystrokes, capture pane content',
      },
    ],

    schemas: {
      TerminalSendCommandInput: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string', description: 'Command to execute' },
          timeout_s: { type: 'integer', default: 30, minimum: 1, maximum: 300, description: 'Max wait in seconds' },
          pane_id: { type: 'string', description: 'Target pane ID (defaults to active pane)' },
        },
      },

      TerminalSendCommandResult: {
        type: 'object',
        properties: {
          output: { type: 'string', description: 'Command output text' },
          exit_code: { type: 'integer', nullable: true, description: 'Exit code if available' },
          timed_out: { type: 'boolean', description: 'Whether the command timed out' },
        },
      },

      TerminalSendKeysInput: {
        type: 'object',
        required: ['keys'],
        properties: {
          keys: { type: 'string', description: 'Raw keystrokes to send' },
          pane_id: { type: 'string', description: 'Target pane ID (defaults to active pane)' },
        },
      },

      TerminalCaptureResult: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Current pane content' },
          lines: { type: 'integer', description: 'Number of lines captured' },
        },
      },
    },

    paths: {
      '/api/terminal/sessions/{id}/send-command': {
        parameters: [uuidParam('id', 'Session UUID')],
        post: {
          operationId: 'sendTerminalCommand',
          summary: 'Send command and wait for output',
          description:
            'Sends a command to the session and waits for output using the marker technique. ' +
            'Timeout defaults to 30s (max 300s).',
          tags: ['Terminal Commands'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalSendCommandInput')),
          responses: {
            '200': jsonResponse('Command result', ref('TerminalSendCommandResult')),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/sessions/{id}/send-keys': {
        parameters: [uuidParam('id', 'Session UUID')],
        post: {
          operationId: 'sendTerminalKeys',
          summary: 'Send raw keystrokes',
          description: 'Sends raw keystrokes to the session for interactive programs.',
          tags: ['Terminal Commands'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalSendKeysInput')),
          responses: {
            '200': jsonResponse('Keys sent', {
              type: 'object',
              properties: { success: { type: 'boolean' } },
            }),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/sessions/{id}/capture': {
        parameters: [uuidParam('id', 'Session UUID')],
        get: {
          operationId: 'captureTerminalPane',
          summary: 'Capture current pane content',
          description: 'Captures the current visible content of the terminal pane.',
          tags: ['Terminal Commands'],
          parameters: [
            namespaceParam(),
            {
              name: 'pane_id',
              in: 'query',
              description: 'Target pane ID (defaults to active pane)',
              schema: { type: 'string' },
            },
            {
              name: 'lines',
              in: 'query',
              description: 'Number of lines to capture (1-10000, default 100)',
              schema: { type: 'integer', default: 100, minimum: 1, maximum: 10000 },
            },
          ],
          responses: {
            '200': jsonResponse('Captured pane content', ref('TerminalCaptureResult')),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },
    },
  };
}
