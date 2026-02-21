/**
 * OpenAPI path definitions for dev session endpoints.
 * Routes: POST /api/dev-sessions, GET /api/dev-sessions,
 *         GET /api/dev-sessions/:id, PATCH /api/dev-sessions/:id,
 *         POST /api/dev-sessions/:id/complete, DELETE /api/dev-sessions/:id
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, uuidParam } from '../helpers.ts';

export function devSessionsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'DevSessions', description: 'Developer session tracking for agent coding sessions' },
    ],
    schemas: {
      DevSession: {
        type: 'object',
        required: ['id', 'user_email', 'session_name', 'node', 'status', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the dev session',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          user_email: {
            type: 'string',
            description: 'Email of the user who owns this dev session',
            example: 'alice@example.com',
          },
          session_name: {
            type: 'string',
            description: 'Human-readable name identifying this session',
            example: 'fix-auth-bug-session',
          },
          node: {
            type: 'string',
            description: 'Hostname or identifier of the machine running the session',
            example: 'dev-workstation-01',
          },
          project_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Optional project this session is associated with',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          status: {
            type: 'string',
            enum: ['active', 'completed', 'abandoned'],
            description: 'Current status of the dev session',
            example: 'active',
          },
          task_summary: {
            type: 'string',
            nullable: true,
            description: 'Brief summary of the task being worked on',
            example: 'Fixing authentication token refresh race condition',
          },
          task_prompt: {
            type: 'string',
            nullable: true,
            description: 'The original prompt or issue description that initiated the session',
            example: 'Fix the race condition in token refresh that causes 401 errors under concurrent requests',
          },
          branch: {
            type: 'string',
            nullable: true,
            description: 'Git branch name for the session',
            example: 'issue/1234-fix-token-refresh',
          },
          container: {
            type: 'string',
            nullable: true,
            description: 'Docker container ID or name if running in a container',
            example: 'devcontainer-abc123',
          },
          container_user: {
            type: 'string',
            nullable: true,
            description: 'Username inside the container',
            example: 'vscode',
          },
          repo_org: {
            type: 'string',
            nullable: true,
            description: 'GitHub organization or owner of the repository',
            example: 'troykelly',
          },
          repo_name: {
            type: 'string',
            nullable: true,
            description: 'GitHub repository name',
            example: 'openclaw-projects',
          },
          context_pct: {
            type: 'number',
            nullable: true,
            description: 'Percentage of context window currently used (0-100)',
            example: 65.5,
          },
          last_capture: {
            type: 'string',
            nullable: true,
            description: 'Content of the last context capture or checkpoint',
            example: 'Implemented retry logic for token refresh, now writing tests',
          },
          last_capture_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp of the last context capture',
            example: '2026-02-21T14:30:00Z',
          },
          completion_summary: {
            type: 'string',
            nullable: true,
            description: 'Summary of what was accomplished when the session was completed',
            example: 'Fixed token refresh race condition. Added retry with exponential backoff. All tests passing.',
          },
          linked_issues: {
            type: 'array',
            items: { type: 'string' },
            description: 'GitHub issue references linked to this session',
            example: ['#1234', '#1235'],
          },
          linked_prs: {
            type: 'array',
            items: { type: 'string' },
            description: 'GitHub PR references linked to this session',
            example: ['#1240'],
          },
          webhook_id: {
            type: 'string',
            nullable: true,
            description: 'ID of the webhook used for session notifications',
            example: 'wh_abc123',
          },
          completed_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the session was completed',
            example: '2026-02-21T18:00:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the session was created',
            example: '2026-02-21T14:00:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the session was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
    },
    paths: {
      '/api/dev-sessions': {
        post: {
          operationId: 'createDevSession',
          summary: 'Create a dev session',
          description: 'Creates a new developer session. Requires user_email, session_name, and node.',
          tags: ['DevSessions'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email', 'session_name', 'node'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email of the session owner',
                example: 'alice@example.com',
              },
              session_name: {
                type: 'string',
                description: 'Human-readable session name',
                example: 'fix-auth-bug-session',
              },
              node: {
                type: 'string',
                description: 'Hostname or identifier of the machine',
                example: 'dev-workstation-01',
              },
              project_id: {
                type: 'string',
                format: 'uuid',
                description: 'Optional project to associate with',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              container: {
                type: 'string',
                description: 'Docker container ID or name',
                example: 'devcontainer-abc123',
              },
              container_user: {
                type: 'string',
                description: 'Username inside the container',
                example: 'vscode',
              },
              repo_org: {
                type: 'string',
                description: 'GitHub org or owner',
                example: 'troykelly',
              },
              repo_name: {
                type: 'string',
                description: 'GitHub repository name',
                example: 'openclaw-projects',
              },
              branch: {
                type: 'string',
                description: 'Git branch name',
                example: 'issue/1234-fix-token-refresh',
              },
              task_summary: {
                type: 'string',
                description: 'Brief summary of the task',
                example: 'Fixing authentication token refresh race condition',
              },
              task_prompt: {
                type: 'string',
                description: 'Original prompt or issue description',
                example: 'Fix the race condition in token refresh',
              },
              linked_issues: {
                type: 'array',
                items: { type: 'string' },
                description: 'GitHub issue references',
                example: ['#1234'],
              },
              linked_prs: {
                type: 'array',
                items: { type: 'string' },
                description: 'GitHub PR references',
                example: ['#1240'],
              },
            },
          }),
          responses: {
            '201': jsonResponse('Dev session created', { $ref: '#/components/schemas/DevSession' }),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listDevSessions',
          summary: 'List dev sessions',
          description: 'Returns dev sessions for the authenticated user, filterable by status, node, and project.',
          tags: ['DevSessions'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              description: 'User email (also accepted via X-User-Email header)',
              example: 'alice@example.com',
              schema: { type: 'string' },
            },
            {
              name: 'status',
              in: 'query',
              description: 'Filter by session status',
              example: 'active',
              schema: { type: 'string', enum: ['active', 'completed', 'abandoned'] },
            },
            {
              name: 'node',
              in: 'query',
              description: 'Filter by machine hostname',
              example: 'dev-workstation-01',
              schema: { type: 'string' },
            },
            {
              name: 'project_id',
              in: 'query',
              description: 'Filter by associated project',
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              schema: { type: 'string', format: 'uuid' },
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Dev sessions', {
              type: 'object',
              required: ['sessions'],
              properties: {
                sessions: {
                  type: 'array',
                  description: 'List of dev sessions matching the filter criteria',
                  items: { $ref: '#/components/schemas/DevSession' },
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/dev-sessions/{id}': {
        get: {
          operationId: 'getDevSession',
          summary: 'Get a dev session',
          description: 'Returns a single dev session by ID. Requires user_email for ownership verification.',
          tags: ['DevSessions'],
          parameters: [
            uuidParam('id', 'Dev session ID'),
            {
              name: 'user_email',
              in: 'query',
              description: 'User email for ownership verification',
              example: 'alice@example.com',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': jsonResponse('Dev session', { $ref: '#/components/schemas/DevSession' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateDevSession',
          summary: 'Update a dev session',
          description: 'Updates session fields such as status, task summary, branch, context percentage, etc.',
          tags: ['DevSessions'],
          parameters: [uuidParam('id', 'Dev session ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              user_email: {
                type: 'string',
                description: 'User email for ownership verification',
                example: 'alice@example.com',
              },
              status: {
                type: 'string',
                description: 'New session status',
                example: 'active',
              },
              task_summary: {
                type: 'string',
                description: 'Updated task summary',
                example: 'Added retry logic, writing integration tests',
              },
              task_prompt: {
                type: 'string',
                description: 'Updated task prompt',
                example: 'Fix the race condition and add tests',
              },
              branch: {
                type: 'string',
                description: 'Updated git branch name',
                example: 'issue/1234-fix-token-refresh',
              },
              container: {
                type: 'string',
                description: 'Updated container ID',
                example: 'devcontainer-xyz789',
              },
              container_user: {
                type: 'string',
                description: 'Updated container username',
                example: 'vscode',
              },
              repo_org: {
                type: 'string',
                description: 'Updated GitHub org',
                example: 'troykelly',
              },
              repo_name: {
                type: 'string',
                description: 'Updated GitHub repo name',
                example: 'openclaw-projects',
              },
              context_pct: {
                type: 'number',
                description: 'Updated context window usage percentage',
                example: 72.3,
              },
              last_capture: {
                type: 'string',
                description: 'Content of the latest context capture',
                example: 'All tests passing, preparing PR',
              },
              last_capture_at: {
                type: 'string',
                format: 'date-time',
                description: 'Timestamp of the latest capture',
                example: '2026-02-21T16:30:00Z',
              },
              completion_summary: {
                type: 'string',
                description: 'Summary of accomplishments',
                example: 'Fixed race condition, added retry with backoff',
              },
              linked_issues: {
                type: 'array',
                items: { type: 'string' },
                description: 'Updated linked issues',
                example: ['#1234', '#1236'],
              },
              linked_prs: {
                type: 'array',
                items: { type: 'string' },
                description: 'Updated linked PRs',
                example: ['#1240'],
              },
              webhook_id: {
                type: 'string',
                description: 'Webhook ID for session notifications',
                example: 'wh_xyz789',
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated dev session', { $ref: '#/components/schemas/DevSession' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteDevSession',
          summary: 'Delete a dev session',
          description: 'Deletes a dev session owned by the authenticated user.',
          tags: ['DevSessions'],
          parameters: [
            uuidParam('id', 'Dev session ID'),
            {
              name: 'user_email',
              in: 'query',
              description: 'User email for ownership verification',
              example: 'alice@example.com',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '204': { description: 'Dev session deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/dev-sessions/{id}/complete': {
        post: {
          operationId: 'completeDevSession',
          summary: 'Mark a dev session as completed',
          description: 'Sets the session status to "completed" with a timestamp and optional completion summary.',
          tags: ['DevSessions'],
          parameters: [uuidParam('id', 'Dev session ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              user_email: {
                type: 'string',
                description: 'User email for ownership verification',
                example: 'alice@example.com',
              },
              completion_summary: {
                type: 'string',
                description: 'Summary of what was accomplished during the session',
                example: 'Fixed token refresh race condition. All tests passing. PR #1240 created.',
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Completed dev session', { $ref: '#/components/schemas/DevSession' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
