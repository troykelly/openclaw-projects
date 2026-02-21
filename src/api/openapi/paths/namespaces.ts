/**
 * OpenAPI path definitions for namespace management.
 * Routes: GET /api/namespaces, POST /api/namespaces,
 *         GET /api/namespaces/{ns}, GET /api/namespaces/{ns}/grants,
 *         POST /api/namespaces/{ns}/grants, PATCH /api/namespaces/{ns}/grants/{id},
 *         DELETE /api/namespaces/{ns}/grants/{id}
 */
import type { OpenApiDomainModule, ParameterObject } from '../types.ts';
import { ref, errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

function nsParam(): ParameterObject {
  return {
    name: 'ns',
    in: 'path',
    required: true,
    description: 'Namespace name (lowercase alphanumeric with dots, hyphens, and underscores)',
    example: 'my-workspace',
    schema: {
      type: 'string',
      pattern: '^[a-z0-9][a-z0-9._-]*$',
      maxLength: 63,
    },
  };
}

function grantIdParam(): ParameterObject {
  return {
    name: 'id',
    in: 'path',
    required: true,
    description: 'Unique identifier for the namespace grant',
    example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
    schema: { type: 'string', format: 'uuid' },
  };
}

export function namespacesPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Namespaces', description: 'Namespace management and access grants' },
    ],
    schemas: {
      NamespaceGrant: {
        type: 'object',
        required: ['id', 'email', 'namespace', 'role', 'is_default'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the grant',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          email: {
            type: 'string',
            format: 'email',
            description: 'Email of the grantee',
            example: 'alice@example.com',
          },
          namespace: {
            type: 'string',
            description: 'Namespace name the grant applies to',
            example: 'my-workspace',
          },
          role: {
            type: 'string',
            enum: ['owner', 'admin', 'member', 'observer'],
            description: 'Role within the namespace determining permission level',
            example: 'owner',
          },
          is_default: {
            type: 'boolean',
            description: 'Whether this is the user default namespace used when no X-Namespace header is provided',
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
      CreateNamespaceRequest: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            description: 'Namespace name (lowercase letters, digits, dots, hyphens, underscores; must start with letter or digit)',
            pattern: '^[a-z0-9][a-z0-9._-]*$',
            maxLength: 63,
            example: 'my-workspace',
          },
          description: {
            type: 'string',
            description: 'Optional human-readable description of the namespace purpose',
            example: 'Team workspace for project management',
          },
        },
      },
      CreateNamespaceResponse: {
        type: 'object',
        required: ['namespace', 'created'],
        properties: {
          namespace: {
            type: 'string',
            description: 'The created namespace name',
            example: 'my-workspace',
          },
          created: {
            type: 'boolean',
            description: 'Whether a new namespace was created (false if it already existed)',
            example: true,
          },
        },
      },
      NamespaceDetail: {
        type: 'object',
        required: ['namespace', 'members', 'member_count'],
        properties: {
          namespace: {
            type: 'string',
            description: 'The namespace name',
            example: 'my-workspace',
          },
          members: {
            type: 'array',
            description: 'List of all members with their grants in this namespace',
            items: { $ref: '#/components/schemas/NamespaceGrant' },
          },
          member_count: {
            type: 'integer',
            description: 'Total number of members in the namespace',
            example: 5,
          },
        },
      },
      CreateGrantRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'Email of the user to grant access to',
            example: 'bob@example.com',
          },
          role: {
            type: 'string',
            enum: ['owner', 'admin', 'member', 'observer'],
            default: 'member',
            description: 'Role to assign within the namespace',
            example: 'member',
          },
          is_default: {
            type: 'boolean',
            default: false,
            description: 'Whether to set this as the user default namespace',
            example: false,
          },
        },
      },
      UpdateGrantRequest: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['owner', 'admin', 'member', 'observer'],
            description: 'New role to assign within the namespace',
            example: 'admin',
          },
          is_default: {
            type: 'boolean',
            description: 'Whether to set this as the user default namespace',
            example: true,
          },
        },
      },
      NamespaceListItemUser: {
        type: 'object',
        description: 'Namespace list item for user tokens, showing the user\'s role and default status',
        properties: {
          namespace: {
            type: 'string',
            description: 'The namespace name',
            example: 'my-workspace',
          },
          role: {
            type: 'string',
            enum: ['owner', 'admin', 'member', 'observer'],
            description: 'The authenticated user\'s role in this namespace',
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
        },
      },
      NamespaceListItemM2M: {
        type: 'object',
        description: 'Namespace list item for M2M tokens, showing grant counts',
        properties: {
          namespace: {
            type: 'string',
            description: 'The namespace name',
            example: 'my-workspace',
          },
          grant_count: {
            type: 'integer',
            description: 'Number of access grants in this namespace',
            example: 12,
          },
        },
      },
    },
    paths: {
      '/api/namespaces': {
        get: {
          operationId: 'listNamespaces',
          summary: 'List namespaces',
          description: 'For user tokens: returns namespaces the user has grants for. For M2M tokens: returns only namespaces the token has explicit grants for; returns an empty list if no grants exist.',
          tags: ['Namespaces'],
          responses: {
            '200': jsonResponse('List of namespaces', {
              type: 'array',
              items: {
                oneOf: [
                  ref('NamespaceListItemUser'),
                  ref('NamespaceListItemM2M'),
                ],
              },
            }),
            ...errorResponses(401, 500),
          },
        },
        post: {
          operationId: 'createNamespace',
          summary: 'Create a namespace',
          description: 'Creates a new namespace. For user tokens, the calling user is automatically granted the owner role.',
          tags: ['Namespaces'],
          requestBody: jsonBody(ref('CreateNamespaceRequest')),
          responses: {
            '201': jsonResponse('Namespace created', ref('CreateNamespaceResponse')),
            ...errorResponses(400, 401, 409, 500),
          },
        },
      },
      '/api/namespaces/{ns}': {
        get: {
          operationId: 'getNamespace',
          summary: 'Get namespace details',
          description: 'Returns namespace details including the full member list. User tokens must have a grant for the namespace.',
          tags: ['Namespaces'],
          parameters: [nsParam()],
          responses: {
            '200': jsonResponse('Namespace details with members', ref('NamespaceDetail')),
            ...errorResponses(401, 403, 404, 500),
          },
        },
      },
      '/api/namespaces/{ns}/grants': {
        get: {
          operationId: 'listNamespaceGrants',
          summary: 'List grants for a namespace',
          description: 'Returns all access grants for the specified namespace. User tokens must have a grant for the namespace.',
          tags: ['Namespaces'],
          parameters: [nsParam()],
          responses: {
            '200': jsonResponse('List of grants', {
              type: 'array',
              items: ref('NamespaceGrant'),
            }),
            ...errorResponses(401, 403, 500),
          },
        },
        post: {
          operationId: 'createNamespaceGrant',
          summary: 'Grant namespace access',
          description: 'Grants a user access to a namespace. User tokens require owner or admin role. Upserts if grant already exists.',
          tags: ['Namespaces'],
          parameters: [nsParam()],
          requestBody: jsonBody(ref('CreateGrantRequest')),
          responses: {
            '201': jsonResponse('Grant created or updated', ref('NamespaceGrant')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
      '/api/namespaces/{ns}/grants/{id}': {
        patch: {
          operationId: 'updateNamespaceGrant',
          summary: 'Update a grant',
          description: 'Updates the role or default flag of an existing namespace grant. User tokens require owner or admin role.',
          tags: ['Namespaces'],
          parameters: [nsParam(), grantIdParam()],
          requestBody: jsonBody(ref('UpdateGrantRequest')),
          responses: {
            '200': jsonResponse('Grant updated', ref('NamespaceGrant')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteNamespaceGrant',
          summary: 'Revoke namespace access',
          description: 'Revokes a user grant from a namespace. User tokens require owner or admin role.',
          tags: ['Namespaces'],
          parameters: [nsParam(), grantIdParam()],
          responses: {
            '200': jsonResponse('Grant deleted', {
              type: 'object',
              required: ['deleted'],
              properties: {
                deleted: {
                  type: 'boolean',
                  description: 'Whether the grant was successfully deleted',
                  example: true,
                },
              },
            }),
            ...errorResponses(401, 403, 404, 500),
          },
        },
      },
    },
  };
}
