/**
 * OpenAPI path definitions for the Relationships domain.
 *
 * Covers relationship type management (reference table) and
 * contact-to-contact relationship CRUD with smart creation.
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

export function relationshipsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Relationship Types', description: 'Reference table for relationship types between contacts' },
      { name: 'Relationships', description: 'Contact-to-contact relationships (graph edges)' },
    ],

    schemas: {
      RelationshipType: {
        type: 'object',
        required: ['id', 'name', 'label', 'is_directional', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the relationship type', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          name: { type: 'string', description: 'Machine-readable name used for programmatic reference (e.g. "parent_of")', example: 'parent_of' },
          label: { type: 'string', description: 'Human-readable label for display (e.g. "Parent of")', example: 'Parent of' },
          description: { type: 'string', nullable: true, description: 'Optional description explaining the relationship type', example: 'Indicates a parent-child relationship between contacts' },
          is_directional: { type: 'boolean', description: 'Whether the relationship has direction (A->B differs from B->A)', example: true },
          inverse_type_name: { type: 'string', nullable: true, description: 'Name of the inverse relationship type (e.g. "child_of" is inverse of "parent_of")', example: 'child_of' },
          created_by_agent: { type: 'string', nullable: true, description: 'Identifier of the agent that created this relationship type', example: 'agent:openclaw-assistant' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the relationship type was created', example: '2026-02-21T14:30:00Z' },
        },
      },

      RelationshipTypeCreateInput: {
        type: 'object',
        required: ['name', 'label'],
        properties: {
          name: { type: 'string', description: 'Unique machine-readable name for the relationship type', example: 'manager_of' },
          label: { type: 'string', description: 'Human-readable label for display', example: 'Manager of' },
          description: { type: 'string', description: 'Optional description explaining the relationship type', example: 'Indicates a management relationship in an organization' },
          is_directional: { type: 'boolean', default: false, description: 'Whether the relationship has direction (A->B differs from B->A)', example: true },
          inverse_type_name: { type: 'string', description: 'Name of the inverse relationship type to auto-link', example: 'reports_to' },
          created_by_agent: { type: 'string', description: 'Identifier of the agent creating this type', example: 'agent:openclaw-assistant' },
        },
      },

      Relationship: {
        type: 'object',
        required: ['id', 'contact_a_id', 'contact_b_id', 'relationship_type_id', 'relationship_type_name', 'relationship_type_label', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the relationship', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          contact_a_id: { type: 'string', format: 'uuid', description: 'UUID of the first contact in the relationship', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          contact_b_id: { type: 'string', format: 'uuid', description: 'UUID of the second contact in the relationship', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
          relationship_type_id: { type: 'string', format: 'uuid', description: 'UUID of the relationship type', example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' },
          notes: { type: 'string', nullable: true, description: 'Optional notes about this specific relationship', example: 'Met at the conference in March' },
          created_by_agent: { type: 'string', nullable: true, description: 'Identifier of the agent that created this relationship', example: 'agent:openclaw-assistant' },
          namespace: { type: 'string', nullable: true, description: 'Namespace scope for multi-tenant isolation', example: 'default' },
          contact_a_name: { type: 'string', description: 'Display name of the first contact', example: 'Alice Johnson' },
          contact_b_name: { type: 'string', description: 'Display name of the second contact', example: 'Bob Smith' },
          relationship_type_name: { type: 'string', description: 'Machine-readable name of the relationship type', example: 'parent_of' },
          relationship_type_label: { type: 'string', description: 'Human-readable label of the relationship type', example: 'Parent of' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the relationship was created', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'Timestamp when the relationship was last updated', example: '2026-02-21T14:30:00Z' },
        },
      },

      RelationshipCreateInput: {
        type: 'object',
        required: ['contact_a_id', 'contact_b_id', 'relationship_type_id'],
        properties: {
          contact_a_id: { type: 'string', format: 'uuid', description: 'UUID of the first contact', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          contact_b_id: { type: 'string', format: 'uuid', description: 'UUID of the second contact', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
          relationship_type_id: { type: 'string', format: 'uuid', description: 'UUID of the relationship type to assign', example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' },
          notes: { type: 'string', description: 'Optional notes about this relationship', example: 'Colleagues at Acme Corp' },
          created_by_agent: { type: 'string', description: 'Identifier of the agent creating the relationship', example: 'agent:openclaw-assistant' },
        },
      },

      RelationshipSetInput: {
        type: 'object',
        required: ['contact_a', 'contact_b', 'relationship_type'],
        properties: {
          contact_a: { type: 'string', description: 'Contact UUID or display name for the first contact', example: 'Alice Johnson' },
          contact_b: { type: 'string', description: 'Contact UUID or display name for the second contact', example: 'Bob Smith' },
          relationship_type: { type: 'string', description: 'Relationship type UUID or machine-readable name', example: 'parent_of' },
          notes: { type: 'string', description: 'Optional notes about this relationship', example: 'Family relationship confirmed by user' },
          created_by_agent: { type: 'string', description: 'Identifier of the agent creating the relationship', example: 'agent:openclaw-assistant' },
          queryNamespaces: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional namespace filter for contact resolution. Name-based and UUID lookups are scoped to these namespaces when provided.',
            example: ['default'],
          },
        },
      },

      RelationshipUpdateInput: {
        type: 'object',
        properties: {
          notes: { type: 'string', nullable: true, description: 'Updated notes about this relationship', example: 'Updated: now working at different companies' },
          relationship_type_id: { type: 'string', format: 'uuid', description: 'New relationship type UUID to reassign', example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' },
        },
      },
    },

    paths: {
      // -- Relationship Types ---------------------------------------------------
      '/api/relationship-types': {
        get: {
          operationId: 'listRelationshipTypes',
          summary: 'List all relationship types with optional filters',
          tags: ['Relationship Types'],
          parameters: [
            {
              name: 'is_directional',
              in: 'query',
              description: 'Filter by directionality (true = directional only, false = bidirectional only)',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'true',
            },
            {
              name: 'created_by_agent',
              in: 'query',
              description: 'Filter by the agent that created the type',
              schema: { type: 'string' },
              example: 'agent:openclaw-assistant',
            },
            {
              name: 'pre_seeded_only',
              in: 'query',
              description: 'Only return pre-seeded system relationship types',
              schema: { type: 'string', enum: ['true'] },
              example: 'true',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Relationship types', {
              type: 'object',
              required: ['types', 'total'],
              properties: {
                types: { type: 'array', items: ref('RelationshipType'), description: 'List of relationship types' },
                total: { type: 'integer', description: 'Total number of relationship types matching filters', example: 15 },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
        post: {
          operationId: 'createRelationshipType',
          summary: 'Create a new relationship type',
          tags: ['Relationship Types'],
          requestBody: jsonBody(ref('RelationshipTypeCreateInput')),
          responses: {
            '201': jsonResponse('Relationship type created', ref('RelationshipType')),
            ...errorResponses(400, 401, 409, 500),
          },
        },
      },

      '/api/relationship-types/match': {
        get: {
          operationId: 'matchRelationshipTypes',
          summary: 'Find relationship types matching a query string',
          tags: ['Relationship Types'],
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Query string to match against relationship type names and labels',
              schema: { type: 'string' },
              example: 'parent',
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of results to return',
              schema: { type: 'integer' },
              example: 10,
            },
          ],
          responses: {
            '200': jsonResponse('Matching types', {
              type: 'object',
              required: ['results'],
              properties: {
                results: { type: 'array', items: ref('RelationshipType'), description: 'Relationship types matching the query' },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/relationship-types/{id}': {
        parameters: [uuidParam('id', 'Relationship type UUID')],
        get: {
          operationId: 'getRelationshipType',
          summary: 'Get a single relationship type',
          tags: ['Relationship Types'],
          responses: {
            '200': jsonResponse('Relationship type details', ref('RelationshipType')),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // -- Relationships --------------------------------------------------------
      '/api/relationships': {
        get: {
          operationId: 'listRelationships',
          summary: 'List relationships with optional filters',
          tags: ['Relationships'],
          parameters: [
            namespaceParam(),
            {
              name: 'contact_id',
              in: 'query',
              description: 'Filter by contact UUID (matches either side of the relationship)',
              schema: { type: 'string', format: 'uuid' },
              example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            },
            {
              name: 'relationship_type_id',
              in: 'query',
              description: 'Filter by relationship type UUID',
              schema: { type: 'string', format: 'uuid' },
              example: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
            },
            {
              name: 'created_by_agent',
              in: 'query',
              description: 'Filter by the agent that created the relationship',
              schema: { type: 'string' },
              example: 'agent:openclaw-assistant',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Relationship list', {
              type: 'object',
              required: ['relationships', 'total'],
              properties: {
                relationships: { type: 'array', items: ref('Relationship'), description: 'List of relationships' },
                total: { type: 'integer', description: 'Total number of relationships matching filters', example: 42 },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
        post: {
          operationId: 'createRelationship',
          summary: 'Create a new relationship between two contacts',
          tags: ['Relationships'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('RelationshipCreateInput')),
          responses: {
            '201': jsonResponse('Relationship created', ref('Relationship')),
            ...errorResponses(400, 401, 409, 500),
          },
        },
      },

      '/api/relationships/set': {
        post: {
          operationId: 'setRelationship',
          summary: 'Smart relationship creation -- resolves contacts and types by name or UUID',
          description: 'Accepts display names or UUIDs for contacts and relationship type. Auto-resolves names to IDs.',
          tags: ['Relationships'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('RelationshipSetInput')),
          responses: {
            '200': jsonResponse('Relationship result', {
              type: 'object',
              required: ['id', 'contact_a_id', 'contact_b_id', 'relationship_type_id'],
              properties: {
                id: { type: 'string', format: 'uuid', description: 'UUID of the created or existing relationship', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                contact_a_id: { type: 'string', format: 'uuid', description: 'Resolved UUID of the first contact', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                contact_b_id: { type: 'string', format: 'uuid', description: 'Resolved UUID of the second contact', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
                relationship_type_id: { type: 'string', format: 'uuid', description: 'Resolved UUID of the relationship type', example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' },
                created: { type: 'boolean', description: 'Whether a new relationship was created (false if already existed)', example: true },
                contact_a_name: { type: 'string', description: 'Display name of the first contact', example: 'Alice Johnson' },
                contact_b_name: { type: 'string', description: 'Display name of the second contact', example: 'Bob Smith' },
                relationship_type_label: { type: 'string', description: 'Human-readable label of the relationship type', example: 'Parent of' },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/relationships/{id}': {
        parameters: [uuidParam('id', 'Relationship UUID')],
        get: {
          operationId: 'getRelationship',
          summary: 'Get a single relationship with details',
          tags: ['Relationships'],
          responses: {
            '200': jsonResponse('Relationship details', ref('Relationship')),
            ...errorResponses(401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateRelationship',
          summary: 'Update a relationship',
          tags: ['Relationships'],
          requestBody: jsonBody(ref('RelationshipUpdateInput')),
          responses: {
            '200': jsonResponse('Updated relationship', ref('Relationship')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteRelationship',
          summary: 'Delete a relationship',
          tags: ['Relationships'],
          responses: {
            '204': { description: 'Relationship deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
