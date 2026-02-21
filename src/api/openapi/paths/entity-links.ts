/**
 * OpenAPI path definitions for entity link endpoints.
 * Routes: POST /api/entity-links, GET /api/entity-links,
 *         GET /api/entity-links/:id, DELETE /api/entity-links/:id
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, uuidParam } from '../helpers.ts';

export function entityLinksPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'EntityLinks', description: 'Cross-entity relationship links between work items, contacts, threads, and other entities' },
    ],
    schemas: {
      EntityLink: {
        type: 'object',
        required: ['id', 'source_type', 'source_id', 'target_type', 'target_id', 'link_type', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the entity link', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          source_type: { type: 'string', description: 'Type of the source entity (e.g. work_item, contact, thread)', example: 'work_item' },
          source_id: { type: 'string', format: 'uuid', description: 'UUID of the source entity', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          target_type: { type: 'string', description: 'Type of the target entity (e.g. work_item, contact, thread)', example: 'contact' },
          target_id: { type: 'string', format: 'uuid', description: 'UUID of the target entity', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
          link_type: { type: 'string', default: 'related', description: 'Type of relationship between the entities', example: 'related' },
          created_by: { type: 'string', nullable: true, description: 'Identifier of the user or agent that created the link', example: 'agent:openclaw-assistant' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the link was created', example: '2026-02-21T14:30:00Z' },
          namespace: { type: 'string', nullable: true, description: 'Namespace scope for multi-tenant isolation', example: 'default' },
        },
      },
    },
    paths: {
      '/api/entity-links': {
        post: {
          operationId: 'createEntityLink',
          summary: 'Create an entity link',
          description: 'Creates a relationship link between two entities. Uses ON CONFLICT to upsert (updates created_by on duplicate). Source and target types must be valid entity types.',
          tags: ['EntityLinks'],
          requestBody: jsonBody({
            type: 'object',
            required: ['source_type', 'source_id', 'target_type', 'target_id'],
            properties: {
              source_type: { type: 'string', description: 'Source entity type (e.g. work_item, contact, thread)', example: 'work_item' },
              source_id: { type: 'string', format: 'uuid', description: 'UUID of the source entity', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
              target_type: { type: 'string', description: 'Target entity type (e.g. work_item, contact, thread)', example: 'contact' },
              target_id: { type: 'string', format: 'uuid', description: 'UUID of the target entity', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
              link_type: { type: 'string', default: 'related', description: 'Type of relationship between entities', example: 'related' },
              created_by: { type: 'string', description: 'Identifier of the user or agent creating the link', example: 'agent:openclaw-assistant' },
            },
          }),
          responses: {
            '201': jsonResponse('Entity link created (or upserted)', { $ref: '#/components/schemas/EntityLink' }),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listEntityLinks',
          summary: 'Query entity links',
          description: 'Returns entity links filtered by source and/or target. At least one of source_type+source_id or target_type+target_id must be provided.',
          tags: ['EntityLinks'],
          parameters: [
            { name: 'source_type', in: 'query', description: 'Filter by source entity type', schema: { type: 'string' }, example: 'work_item' },
            { name: 'source_id', in: 'query', description: 'Filter by source entity UUID', schema: { type: 'string', format: 'uuid' }, example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            { name: 'target_type', in: 'query', description: 'Filter by target entity type', schema: { type: 'string' }, example: 'contact' },
            { name: 'target_id', in: 'query', description: 'Filter by target entity UUID', schema: { type: 'string', format: 'uuid' }, example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
            { name: 'link_type', in: 'query', description: 'Filter by link type', schema: { type: 'string' }, example: 'related' },
          ],
          responses: {
            '200': jsonResponse('Entity links', {
              type: 'object',
              required: ['links'],
              properties: {
                links: { type: 'array', items: { $ref: '#/components/schemas/EntityLink' }, description: 'List of matching entity links' },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/entity-links/{id}': {
        get: {
          operationId: 'getEntityLink',
          summary: 'Get a single entity link',
          description: 'Returns a single entity link by ID.',
          tags: ['EntityLinks'],
          parameters: [uuidParam('id', 'Entity link UUID')],
          responses: {
            '200': jsonResponse('Entity link', { $ref: '#/components/schemas/EntityLink' }),
            ...errorResponses(401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteEntityLink',
          summary: 'Delete an entity link',
          description: 'Removes an entity link.',
          tags: ['EntityLinks'],
          parameters: [uuidParam('id', 'Entity link UUID')],
          responses: {
            '204': { description: 'Entity link deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
