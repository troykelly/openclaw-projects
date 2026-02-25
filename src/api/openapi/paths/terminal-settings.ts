/**
 * OpenAPI path definitions for Terminal retention settings and worker status.
 *
 * Epic #1667 — TMux Session Management.
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  errorResponses,
  jsonBody,
  jsonResponse,
  namespaceParam,
} from '../helpers.ts';

export function terminalSettingsPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Settings',
        description: 'Terminal retention settings and worker health',
      },
    ],

    schemas: {
      TerminalSettings: {
        type: 'object',
        properties: {
          entry_retention_days: {
            type: 'integer',
            default: 90,
            minimum: 1,
            maximum: 3650,
            description: 'Number of days to retain session entries before cleanup',
          },
        },
      },

      TerminalSettingsUpdateInput: {
        type: 'object',
        required: ['entry_retention_days'],
        properties: {
          entry_retention_days: {
            type: 'integer',
            minimum: 1,
            maximum: 3650,
            description: 'Number of days to retain session entries',
          },
        },
      },

      TerminalWorkerStatus: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Worker health status' },
          active_sessions: { type: 'integer', description: 'Number of active sessions' },
          uptime_s: { type: 'number', description: 'Worker uptime in seconds' },
        },
      },
    },

    paths: {
      '/api/terminal/settings': {
        get: {
          operationId: 'getTerminalSettings',
          summary: 'Get terminal settings',
          description: 'Returns the current terminal settings for the namespace, including entry retention policy.',
          tags: ['Terminal Settings'],
          parameters: [namespaceParam()],
          responses: {
            '200': jsonResponse('Current settings', {
              type: 'object',
              properties: {
                entry_retention_days: { type: 'integer', description: 'Retention period in days', default: 90 },
              },
            }),
            ...errorResponses(403, 500),
          },
        },
        patch: {
          operationId: 'updateTerminalSettings',
          summary: 'Update terminal settings',
          description: 'Updates terminal settings for the namespace. Currently supports entry retention policy.',
          tags: ['Terminal Settings'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['entry_retention_days'],
            properties: {
              entry_retention_days: {
                type: 'integer',
                minimum: 1,
                maximum: 3650,
                description: 'Number of days to retain session entries',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Updated settings', {
              type: 'object',
              properties: {
                entry_retention_days: { type: 'integer' },
              },
            }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/terminal/worker/status': {
        get: {
          operationId: 'getTerminalWorkerStatus',
          summary: 'Get worker health status',
          description: 'Returns the gRPC worker health and status information.',
          tags: ['Terminal Settings'],
          responses: {
            '200': jsonResponse('Worker status', {
              type: 'object',
              properties: {
                status: { type: 'string' },
                active_sessions: { type: 'integer' },
                uptime_s: { type: 'number' },
              },
            }),
            ...errorResponses(502),
          },
        },
      },
    },
  };
}
