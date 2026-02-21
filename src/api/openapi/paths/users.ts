/**
 * OpenAPI path definitions for user provisioning and management.
 * Routes: POST /api/users, GET /api/users, GET /api/users/{email},
 *         PATCH /api/users/{email}, DELETE /api/users/{email},
 *         GET /api/users/search
 */
import type { OpenApiDomainModule, ParameterObject } from '../types.ts';
import { ref, errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

function emailParam(): ParameterObject {
  return {
    name: 'email',
    in: 'path',
    required: true,
    description: 'User email address (URL-encoded)',
    example: 'alice%40example.com',
    schema: { type: 'string', format: 'email' },
  };
}

export function usersPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Users', description: 'User provisioning and profile management' },
    ],
    schemas: {
      CreateUserRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address used as the primary identifier',
            example: 'alice@example.com',
          },
          display_name: {
            type: 'string',
            description: 'Display name shown in the UI (defaults to email local part if not provided)',
            example: 'Alice Johnson',
          },
          namespace: {
            type: 'string',
            description: 'Personal namespace name (defaults to sanitized email local part if not provided)',
            example: 'alice',
          },
        },
      },
      CreateUserResponse: {
        type: 'object',
        required: ['email', 'display_name', 'default_namespace', 'grants'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'Email of the created user',
            example: 'alice@example.com',
          },
          display_name: {
            type: 'string',
            description: 'Display name of the created user',
            example: 'Alice Johnson',
          },
          default_namespace: {
            type: 'string',
            description: 'The user\'s default namespace name',
            example: 'alice',
          },
          grants: {
            type: 'array',
            description: 'Namespace grants automatically created for the user',
            items: { $ref: '#/components/schemas/NamespaceGrant' },
          },
        },
      },
      UserListItem: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address',
            example: 'alice@example.com',
          },
          theme: {
            type: 'string',
            nullable: true,
            description: 'User\'s UI theme preference',
            example: 'dark',
          },
          timezone: {
            type: 'string',
            nullable: true,
            description: 'User\'s IANA timezone string',
            example: 'Australia/Sydney',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the user was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the user was last updated',
            example: '2026-02-21T14:30:00Z',
          },
          grants: {
            type: 'array',
            nullable: true,
            description: 'Namespace grants for this user (may be null for non-M2M queries)',
            items: {
              type: 'object',
              properties: {
                namespace: {
                  type: 'string',
                  description: 'Namespace name',
                  example: 'my-workspace',
                },
                role: {
                  type: 'string',
                  enum: ['owner', 'admin', 'member', 'observer'],
                  description: 'User role in this namespace',
                  example: 'owner',
                },
                is_default: {
                  type: 'boolean',
                  description: 'Whether this is the user\'s default namespace',
                  example: true,
                },
              },
            },
          },
        },
      },
      UserDetail: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address',
            example: 'alice@example.com',
          },
          theme: {
            type: 'string',
            nullable: true,
            description: 'UI theme preference',
            example: 'dark',
          },
          default_view: {
            type: 'string',
            nullable: true,
            description: 'Default landing view when the user opens the app',
            example: 'projects',
          },
          timezone: {
            type: 'string',
            nullable: true,
            description: 'IANA timezone string for date/time display',
            example: 'Australia/Sydney',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the user was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the user was last updated',
            example: '2026-02-21T14:30:00Z',
          },
          grants: {
            type: 'array',
            description: 'All namespace grants for this user with full details',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Grant unique identifier',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                namespace: {
                  type: 'string',
                  description: 'Namespace name',
                  example: 'my-workspace',
                },
                role: {
                  type: 'string',
                  enum: ['owner', 'admin', 'member', 'observer'],
                  description: 'User role in this namespace',
                  example: 'owner',
                },
                is_default: {
                  type: 'boolean',
                  description: 'Whether this is the user\'s default namespace',
                  example: true,
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp when the grant was created',
                  example: '2026-02-21T14:30:00Z',
                },
                updated_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp when the grant was last updated',
                  example: '2026-02-21T14:30:00Z',
                },
              },
            },
          },
        },
      },
      UpdateUserRequest: {
        type: 'object',
        properties: {
          theme: {
            type: 'string',
            description: 'UI theme preference (e.g. "light", "dark", "system")',
            example: 'dark',
          },
          default_view: {
            type: 'string',
            description: 'Default landing view when the user opens the app',
            example: 'projects',
          },
          timezone: {
            type: 'string',
            description: 'IANA timezone string for date/time display',
            example: 'Australia/Sydney',
          },
          sidebar_collapsed: {
            type: 'boolean',
            description: 'Whether the sidebar is collapsed in the UI',
            example: false,
          },
          show_completed_items: {
            type: 'boolean',
            description: 'Whether completed items are shown in list views',
            example: true,
          },
        },
      },
      UpdateUserResponse: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address',
            example: 'alice@example.com',
          },
          theme: {
            type: 'string',
            nullable: true,
            description: 'UI theme preference',
            example: 'dark',
          },
          default_view: {
            type: 'string',
            nullable: true,
            description: 'Default landing view',
            example: 'projects',
          },
          timezone: {
            type: 'string',
            nullable: true,
            description: 'IANA timezone string',
            example: 'Australia/Sydney',
          },
          sidebar_collapsed: {
            type: 'boolean',
            nullable: true,
            description: 'Whether the sidebar is collapsed',
            example: false,
          },
          show_completed_items: {
            type: 'boolean',
            nullable: true,
            description: 'Whether completed items are shown',
            example: true,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the user was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the user settings were last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      DeleteUserResponse: {
        type: 'object',
        required: ['deleted', 'email'],
        properties: {
          deleted: {
            type: 'boolean',
            description: 'Whether the user was successfully deleted',
            example: true,
          },
          email: {
            type: 'string',
            format: 'email',
            description: 'Email of the deleted user',
            example: 'alice@example.com',
          },
        },
      },
      UserSearchResponse: {
        type: 'object',
        required: ['users'],
        properties: {
          users: {
            type: 'array',
            description: 'List of users matching the search query',
            items: {
              type: 'object',
              required: ['email'],
              properties: {
                email: {
                  type: 'string',
                  format: 'email',
                  description: 'Email of the matched user',
                  example: 'alice@example.com',
                },
              },
            },
          },
        },
      },
    },
    paths: {
      '/api/users': {
        post: {
          operationId: 'createUser',
          summary: 'Create a user',
          description: 'Provisions a new user with a personal namespace. Requires M2M token. Creates user_setting, owner grant for personal namespace, and member grant for the default namespace.',
          tags: ['Users'],
          requestBody: jsonBody(ref('CreateUserRequest')),
          responses: {
            '201': jsonResponse('User created', ref('CreateUserResponse')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
        get: {
          operationId: 'listUsers',
          summary: 'List all users',
          description: 'Lists all users with their settings and namespace grants. Requires M2M token.',
          tags: ['Users'],
          responses: {
            '200': jsonResponse('List of users', {
              type: 'array',
              items: ref('UserListItem'),
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/users/search': {
        get: {
          operationId: 'searchUsers',
          summary: 'Search users by email',
          description: 'Searches for users by email pattern matching across comments and notifications.',
          tags: ['Users'],
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Search query to match against email addresses',
              example: 'alice',
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of results to return (default 10, max 50)',
              example: 10,
              schema: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
            },
          ],
          responses: {
            '200': jsonResponse('Search results', ref('UserSearchResponse')),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/users/{email}': {
        get: {
          operationId: 'getUser',
          summary: 'Get user details',
          description: 'Returns user settings and namespace grants. User tokens can only view their own profile; M2M tokens can view any user.',
          tags: ['Users'],
          parameters: [emailParam()],
          responses: {
            '200': jsonResponse('User details', ref('UserDetail')),
            ...errorResponses(401, 403, 404, 500),
          },
        },
        patch: {
          operationId: 'updateUser',
          summary: 'Update user settings',
          description: 'Updates user settings such as theme, timezone, and view preferences. User tokens can only update their own profile; M2M tokens can update any user.',
          tags: ['Users'],
          parameters: [emailParam()],
          requestBody: jsonBody(ref('UpdateUserRequest')),
          responses: {
            '200': jsonResponse('Updated user settings', ref('UpdateUserResponse')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteUser',
          summary: 'Delete a user',
          description: 'Deletes a user and all their namespace grants (via CASCADE). Requires M2M token.',
          tags: ['Users'],
          parameters: [emailParam()],
          responses: {
            '200': jsonResponse('User deleted', ref('DeleteUserResponse')),
            ...errorResponses(401, 403, 404, 500),
          },
        },
      },
    },
  };
}
