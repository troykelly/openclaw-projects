/**
 * OpenAPI path definitions for context endpoints.
 * Routes: POST /api/contexts, GET /api/contexts, GET /api/contexts/:id,
 *         PATCH /api/contexts/:id, DELETE /api/contexts/:id,
 *         POST /api/contexts/:id/links, GET /api/contexts/:id/links,
 *         DELETE /api/contexts/:id/links/:link_id,
 *         GET /api/entity-contexts
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, searchParam, uuidParam } from '../helpers.ts';

export function contextsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Contexts', description: 'Contextual data blocks that can be linked to any entity for agent grounding' },
    ],
    schemas: {
      Context: {
        type: 'object',
        required: ['id', 'label', 'content', 'is_active', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the context block',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          label: {
            type: 'string',
            description: 'Short descriptive label for the context',
            example: 'home-renovation',
          },
          content: {
            type: 'string',
            description: 'Full text content of the context block',
            example: 'The home renovation project focuses on the kitchen and bathroom. Budget is $50,000.',
          },
          content_type: {
            type: 'string',
            description: 'MIME-like content type of the context (e.g. text, markdown, json)',
            example: 'text',
          },
          is_active: {
            type: 'boolean',
            description: 'Whether this context is active and should be included in agent grounding',
            example: true,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the context was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the context was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      ContextLink: {
        type: 'object',
        required: ['id', 'context_id', 'target_type', 'target_id', 'priority', 'created_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the context link',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          context_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the context block this link belongs to',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          target_type: {
            type: 'string',
            description: 'Type of the target entity (e.g. work_item, contact, project)',
            example: 'work_item',
          },
          target_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the target entity',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          priority: {
            type: 'integer',
            description: 'Priority of this link (higher values are returned first)',
            example: 10,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the link was created',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      ContextWithLink: {
        type: 'object',
        required: ['id', 'label', 'content', 'is_active', 'created_at', 'updated_at', 'priority', 'link_id'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the context block',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          label: {
            type: 'string',
            description: 'Short descriptive label for the context',
            example: 'home-renovation',
          },
          content: {
            type: 'string',
            description: 'Full text content of the context block',
            example: 'The home renovation project focuses on the kitchen and bathroom. Budget is $50,000.',
          },
          content_type: {
            type: 'string',
            description: 'MIME-like content type of the context',
            example: 'text',
          },
          is_active: {
            type: 'boolean',
            description: 'Whether this context is active',
            example: true,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the context was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the context was last updated',
            example: '2026-02-21T14:30:00Z',
          },
          priority: {
            type: 'integer',
            description: 'Priority of the link to this context (higher values are returned first)',
            example: 10,
          },
          link_id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the link that associates this context to the entity',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
        },
      },
    },
    paths: {
      '/api/contexts': {
        post: {
          operationId: 'createContext',
          summary: 'Create a context',
          description: 'Creates a new context block with a label, content, and optional content type.',
          tags: ['Contexts'],
          requestBody: jsonBody({
            type: 'object',
            required: ['label', 'content'],
            properties: {
              label: {
                type: 'string',
                description: 'Short descriptive label for the context',
                example: 'home-renovation',
              },
              content: {
                type: 'string',
                description: 'Full text content of the context block',
                example: 'The home renovation project focuses on the kitchen and bathroom.',
              },
              content_type: {
                type: 'string',
                default: 'text',
                description: 'Content type (e.g. text, markdown, json)',
                example: 'text',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Context created', { $ref: '#/components/schemas/Context' }),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listContexts',
          summary: 'List contexts',
          description: 'Returns contexts with pagination and optional search. By default only active contexts are returned.',
          tags: ['Contexts'],
          parameters: [
            searchParam('Search by label or content'),
            ...paginationParams(),
            {
              name: 'include_inactive',
              in: 'query',
              description: 'Include inactive contexts in results',
              example: 'false',
              schema: { type: 'string', enum: ['true', 'false'] },
            },
          ],
          responses: {
            '200': jsonResponse('Context list', {
              type: 'object',
              required: ['total', 'limit', 'offset', 'items'],
              properties: {
                total: {
                  type: 'integer',
                  description: 'Total number of contexts matching the filter',
                  example: 42,
                },
                limit: {
                  type: 'integer',
                  description: 'Maximum number of results returned',
                  example: 50,
                },
                offset: {
                  type: 'integer',
                  description: 'Number of results skipped',
                  example: 0,
                },
                items: {
                  type: 'array',
                  description: 'List of context blocks',
                  items: { $ref: '#/components/schemas/Context' },
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/contexts/{id}': {
        get: {
          operationId: 'getContext',
          summary: 'Get a context',
          description: 'Returns a single context by ID.',
          tags: ['Contexts'],
          parameters: [uuidParam('id', 'Context ID')],
          responses: {
            '200': jsonResponse('Context details', { $ref: '#/components/schemas/Context' }),
            ...errorResponses(401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateContext',
          summary: 'Update a context',
          description: 'Updates label, content, content_type, or active status of a context.',
          tags: ['Contexts'],
          parameters: [uuidParam('id', 'Context ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'New label for the context',
                example: 'kitchen-renovation',
              },
              content: {
                type: 'string',
                description: 'New content for the context',
                example: 'Updated budget to $55,000 after scope change.',
              },
              content_type: {
                type: 'string',
                description: 'New content type',
                example: 'markdown',
              },
              is_active: {
                type: 'boolean',
                description: 'Whether the context should be active',
                example: true,
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated context', { $ref: '#/components/schemas/Context' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteContext',
          summary: 'Delete a context',
          description: 'Deletes a context and all its links (cascade).',
          tags: ['Contexts'],
          parameters: [uuidParam('id', 'Context ID')],
          responses: {
            '204': { description: 'Context deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/api/contexts/{id}/links': {
        post: {
          operationId: 'createContextLink',
          summary: 'Link a context to a target entity',
          description: 'Creates a link from a context to a target entity (work item, contact, etc.). Returns 409 if the link already exists.',
          tags: ['Contexts'],
          parameters: [uuidParam('id', 'Context ID')],
          requestBody: jsonBody({
            type: 'object',
            required: ['target_type', 'target_id'],
            properties: {
              target_type: {
                type: 'string',
                description: 'Type of the target entity (e.g. work_item, contact, project)',
                example: 'work_item',
              },
              target_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the target entity to link',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              priority: {
                type: 'integer',
                default: 0,
                description: 'Priority of this link (higher values are returned first)',
                example: 10,
              },
            },
          }),
          responses: {
            '201': jsonResponse('Link created', { $ref: '#/components/schemas/ContextLink' }),
            ...errorResponses(400, 401, 404, 409, 500),
          },
        },
        get: {
          operationId: 'listContextLinks',
          summary: 'List links for a context',
          description: 'Returns all links for a context, ordered by priority descending then creation date.',
          tags: ['Contexts'],
          parameters: [uuidParam('id', 'Context ID')],
          responses: {
            '200': jsonResponse('Context links', {
              type: 'object',
              required: ['links'],
              properties: {
                links: {
                  type: 'array',
                  description: 'List of context links ordered by priority descending',
                  items: { $ref: '#/components/schemas/ContextLink' },
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/contexts/{id}/links/{link_id}': {
        delete: {
          operationId: 'deleteContextLink',
          summary: 'Remove a context link',
          description: 'Deletes a specific link from a context.',
          tags: ['Contexts'],
          parameters: [
            uuidParam('id', 'Context ID'),
            uuidParam('link_id', 'Link ID'),
          ],
          responses: {
            '204': { description: 'Link deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/api/entity-contexts': {
        get: {
          operationId: 'getEntityContexts',
          summary: 'Find contexts linked to an entity',
          description: 'Reverse lookup: returns all active contexts linked to a given target entity, ordered by priority.',
          tags: ['Contexts'],
          parameters: [
            {
              name: 'target_type',
              in: 'query',
              required: true,
              description: 'Entity type to look up (e.g. work_item, contact, project)',
              example: 'work_item',
              schema: { type: 'string' },
            },
            {
              name: 'target_id',
              in: 'query',
              required: true,
              description: 'UUID of the entity to look up',
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': jsonResponse('Linked contexts', {
              type: 'object',
              required: ['contexts'],
              properties: {
                contexts: {
                  type: 'array',
                  description: 'List of active contexts linked to the entity, ordered by priority',
                  items: { $ref: '#/components/schemas/ContextWithLink' },
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
    },
  };
}
