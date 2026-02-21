/**
 * OpenAPI path definitions for the Memories domain.
 *
 * Covers legacy /api/memory endpoints, unified /api/memories endpoints,
 * bulk operations, memory-contact links, memory-memory relationships,
 * similarity search, attachments, project-scoped memories,
 * and admin embedding management.
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

export function memoriesPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Memories', description: 'Memory storage, search, and relationship management' },
      { name: 'Memories (Legacy)', description: 'Legacy /api/memory endpoints — prefer unified /api/memories' },
      { name: 'Admin - Embeddings', description: 'Embedding backfill and status endpoints' },
    ],

    schemas: {
      Memory: {
        type: 'object',
        required: ['id', 'content', 'memory_type', 'is_active', 'embedding_status', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the memory', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Short title summarizing the memory content', example: 'User prefers dark mode' },
          content: { type: 'string', description: 'Full text content of the memory', example: 'User prefers dark mode and metric units' },
          type: { type: 'string', description: 'Alias for memory_type, provided for backwards compatibility', example: 'preference' },
          memory_type: {
            type: 'string',
            enum: ['preference', 'fact', 'note', 'decision', 'context', 'reference'],
            description: 'Semantic type of the memory indicating its purpose',
            example: 'preference',
          },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorizing and filtering memories', example: ['ui', 'settings'] },
          work_item_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the associated work item, if scoped to one', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          contact_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the associated contact, if scoped to one', example: null },
          relationship_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the associated relationship, if scoped to one', example: null },
          project_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the associated project, if scoped to one', example: null },
          created_by_agent: { type: 'string', nullable: true, description: 'Identifier of the agent that created this memory', example: 'agent:openclaw-assistant' },
          created_by_human: { type: 'boolean', nullable: true, description: 'Whether this memory was created by a human (vs an agent)', example: false },
          source_url: { type: 'string', nullable: true, description: 'URL of the source material this memory was derived from', example: 'https://docs.example.com/preferences' },
          importance: { type: 'number', nullable: true, description: 'Importance score from 0 (trivial) to 1 (critical)', example: 0.8 },
          confidence: { type: 'number', nullable: true, description: 'Confidence score from 0 (uncertain) to 1 (certain)', example: 0.95 },
          expires_at: { type: 'string', format: 'date-time', nullable: true, description: 'Timestamp when this memory expires and should be cleaned up', example: '2026-12-31T23:59:59Z' },
          is_active: { type: 'boolean', description: 'Whether the memory is active (not superseded or deactivated)', example: true },
          superseded_by: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the memory that supersedes this one', example: null },
          embedding_status: { type: 'string', description: 'Status of the vector embedding (pending, complete, failed, skipped)', example: 'complete' },
          lat: { type: 'number', nullable: true, description: 'Latitude coordinate for location-tagged memories', example: -33.8688 },
          lng: { type: 'number', nullable: true, description: 'Longitude coordinate for location-tagged memories', example: 151.2093 },
          address: { type: 'string', nullable: true, description: 'Street address for location-tagged memories', example: '123 George St, Sydney NSW 2000' },
          place_label: { type: 'string', nullable: true, description: 'Human-readable place label for location-tagged memories', example: 'Sydney CBD Office' },
          namespace: { type: 'string', nullable: true, description: 'Namespace scope for multi-tenant isolation', example: 'default' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the memory was created', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'Timestamp when the memory was last updated', example: '2026-02-21T14:30:00Z' },
        },
      },

      LegacyMemory: {
        type: 'object',
        required: ['id', 'title', 'content', 'type', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the memory', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Short title summarizing the memory', example: 'Sprint planning decisions' },
          content: { type: 'string', description: 'Full text content of the memory', example: 'Team decided to focus on authentication module first' },
          type: { type: 'string', enum: ['note', 'decision', 'context', 'reference'], description: 'Semantic type of the memory', example: 'decision' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorizing the memory', example: ['sprint', 'planning'] },
          linked_item_id: { type: 'string', format: 'uuid', description: 'UUID of the linked work item', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          linked_item_title: { type: 'string', description: 'Title of the linked work item', example: 'Q1 Sprint Planning' },
          linked_item_kind: { type: 'string', description: 'Kind of the linked work item (e.g. task, epic, issue)', example: 'task' },
          embedding_status: { type: 'string', description: 'Status of the vector embedding', example: 'complete' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the memory was created', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'Timestamp when the memory was last updated', example: '2026-02-21T14:30:00Z' },
        },
      },

      UnifiedMemoryCreateInput: {
        type: 'object',
        required: ['content'],
        properties: {
          title: { type: 'string', description: 'Short title for the memory; auto-generated from content if omitted', example: 'User notification preferences' },
          content: { type: 'string', description: 'Full text content of the memory', example: 'User prefers dark mode and metric units' },
          memory_type: {
            type: 'string',
            enum: ['preference', 'fact', 'note', 'decision', 'context', 'reference'],
            default: 'note',
            description: 'Semantic type of the memory indicating its purpose',
            example: 'preference',
          },
          work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item to scope this memory to', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          contact_id: { type: 'string', format: 'uuid', description: 'UUID of the contact to scope this memory to', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
          relationship_id: { type: 'string', format: 'uuid', description: 'UUID of the relationship to scope this memory to', example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' },
          project_id: { type: 'string', format: 'uuid', description: 'UUID of the project to scope this memory to', example: 'e5f6a7b8-9012-3456-cdef-789012345678' },
          created_by_agent: { type: 'string', description: 'Identifier of the agent creating this memory', example: 'agent:openclaw-assistant' },
          created_by_human: { type: 'boolean', description: 'Whether this memory is being created by a human', example: false },
          source_url: { type: 'string', description: 'URL of the source material', example: 'https://docs.example.com/preferences' },
          importance: { type: 'number', description: 'Importance score from 0 (trivial) to 1 (critical)', example: 0.8 },
          confidence: { type: 'number', description: 'Confidence score from 0 (uncertain) to 1 (certain)', example: 0.95 },
          expires_at: { type: 'string', format: 'date-time', description: 'Expiration timestamp after which the memory can be cleaned up', example: '2026-12-31T23:59:59Z' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorizing the memory', example: ['ui', 'settings'] },
          lat: { type: 'number', minimum: -90, maximum: 90, description: 'Latitude coordinate for location tagging', example: -33.8688 },
          lng: { type: 'number', minimum: -180, maximum: 180, description: 'Longitude coordinate for location tagging', example: 151.2093 },
          address: { type: 'string', description: 'Street address for location tagging', example: '123 George St, Sydney NSW 2000' },
          place_label: { type: 'string', description: 'Human-readable place label for location tagging', example: 'Sydney CBD Office' },
        },
      },

      BulkMemoryCreateInput: {
        type: 'object',
        required: ['memories'],
        properties: {
          memories: {
            type: 'array',
            items: ref('UnifiedMemoryCreateInput'),
            description: 'Array of memories to create in bulk',
          },
        },
      },

      BulkMemoryUpdateInput: {
        type: 'object',
        required: ['updates'],
        properties: {
          updates: {
            type: 'array',
            description: 'Array of memory updates to apply in bulk',
            items: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string', format: 'uuid', description: 'UUID of the memory to update', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                title: { type: 'string', description: 'Updated title', example: 'Updated preference title' },
                content: { type: 'string', description: 'Updated content', example: 'User now prefers light mode' },
                importance: { type: 'number', description: 'Updated importance score (0-1)', example: 0.6 },
                confidence: { type: 'number', description: 'Updated confidence score (0-1)', example: 0.9 },
                is_active: { type: 'boolean', description: 'Whether the memory should remain active', example: true },
              },
            },
          },
        },
      },

      BulkOperationResult: {
        type: 'object',
        required: ['success', 'results'],
        properties: {
          success: { type: 'boolean', description: 'Whether the entire bulk operation completed without errors', example: true },
          created: { type: 'integer', description: 'Number of items successfully created', example: 5 },
          updated: { type: 'integer', description: 'Number of items successfully updated', example: 3 },
          failed: { type: 'integer', description: 'Number of items that failed', example: 0 },
          results: {
            type: 'array',
            description: 'Per-item results for each entry in the bulk operation',
            items: {
              type: 'object',
              required: ['index', 'status'],
              properties: {
                index: { type: 'integer', description: 'Zero-based index of the item in the input array', example: 0 },
                id: { type: 'string', format: 'uuid', description: 'UUID of the created or updated memory', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                status: { type: 'string', enum: ['created', 'updated', 'failed'], description: 'Result status for this item', example: 'created' },
                error: { type: 'string', description: 'Error message if the item failed', example: 'Content field is required' },
              },
            },
          },
        },
      },

      MemoryContactLink: {
        type: 'object',
        required: ['id', 'memory_id', 'contact_id', 'relationship_type', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the memory-contact link', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          memory_id: { type: 'string', format: 'uuid', description: 'UUID of the linked memory', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          contact_id: { type: 'string', format: 'uuid', description: 'UUID of the linked contact', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
          relationship_type: { type: 'string', enum: ['about', 'from', 'shared_with', 'mentioned'], description: 'How the contact relates to the memory', example: 'about' },
          notes: { type: 'string', nullable: true, description: 'Optional notes about the memory-contact relationship', example: 'Primary stakeholder for this decision' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the link was created', example: '2026-02-21T14:30:00Z' },
        },
      },

      MemoryRelationshipLink: {
        type: 'object',
        required: ['id', 'memory_id', 'related_memory_id', 'relationship_type', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the memory-memory relationship', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          memory_id: { type: 'string', format: 'uuid', description: 'UUID of the source memory', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          related_memory_id: { type: 'string', format: 'uuid', description: 'UUID of the related memory', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
          relationship_type: { type: 'string', enum: ['related', 'supersedes', 'contradicts', 'supports'], description: 'How the two memories relate to each other', example: 'related' },
          notes: { type: 'string', nullable: true, description: 'Optional notes about the memory-memory relationship', example: 'These preferences are complementary' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the link was created', example: '2026-02-21T14:30:00Z' },
        },
      },

      MemoryAttachment: {
        type: 'object',
        required: ['id', 'original_filename', 'content_type', 'size_bytes', 'created_at', 'attached_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the file attachment', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          original_filename: { type: 'string', description: 'Original filename when the file was uploaded', example: 'meeting-notes.pdf' },
          content_type: { type: 'string', description: 'MIME type of the file', example: 'application/pdf' },
          size_bytes: { type: 'integer', description: 'File size in bytes', example: 245760 },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the file was uploaded', example: '2026-02-21T14:30:00Z' },
          attached_at: { type: 'string', format: 'date-time', description: 'Timestamp when the file was attached to the memory', example: '2026-02-21T14:35:00Z' },
          attached_by: { type: 'string', nullable: true, description: 'Identifier of the user or agent who attached the file', example: 'alice@example.com' },
        },
      },

      EmbeddingStatus: {
        type: 'object',
        required: ['configured', 'stats'],
        properties: {
          configured: { type: 'boolean', description: 'Whether embedding generation is configured and enabled', example: true },
          provider: { type: 'string', nullable: true, description: 'Embedding provider name (e.g. openai, cohere)', example: 'openai' },
          model: { type: 'string', nullable: true, description: 'Model name used for embedding generation', example: 'text-embedding-3-small' },
          dimensions: { type: 'integer', nullable: true, description: 'Dimensionality of the embedding vectors', example: 1536 },
          configured_providers: { type: 'array', items: { type: 'string' }, description: 'List of all configured embedding providers', example: ['openai'] },
          stats: {
            type: 'object',
            description: 'Embedding statistics for memories',
            required: ['total_memories', 'with_embedding', 'pending', 'failed'],
            properties: {
              total_memories: { type: 'integer', description: 'Total number of memories in the system', example: 500 },
              with_embedding: { type: 'integer', description: 'Number of memories with completed embeddings', example: 480 },
              pending: { type: 'integer', description: 'Number of memories waiting for embedding generation', example: 15 },
              failed: { type: 'integer', description: 'Number of memories where embedding generation failed', example: 5 },
            },
          },
          work_item_stats: {
            type: 'object',
            description: 'Embedding statistics for work items',
            properties: {
              total: { type: 'integer', description: 'Total number of work items', example: 200 },
              with_embedding: { type: 'integer', description: 'Number of work items with completed embeddings', example: 190 },
              pending: { type: 'integer', description: 'Number of work items waiting for embedding generation', example: 5 },
              failed: { type: 'integer', description: 'Number of work items where embedding generation failed', example: 2 },
              skipped: { type: 'integer', description: 'Number of work items skipped (too short or excluded)', example: 3 },
            },
          },
        },
      },

      BackfillResult: {
        type: 'object',
        required: ['status', 'processed', 'succeeded', 'failed'],
        properties: {
          status: { type: 'string', description: 'Overall status of the backfill operation', example: 'completed' },
          processed: { type: 'integer', description: 'Total number of items processed', example: 100 },
          succeeded: { type: 'integer', description: 'Number of items successfully embedded', example: 98 },
          failed: { type: 'integer', description: 'Number of items that failed to embed', example: 2 },
        },
      },
    },

    paths: {
      // -- Legacy Memory API (/api/memory) --------------------------------------
      '/api/memory': {
        get: {
          operationId: 'listMemoriesLegacy',
          summary: 'List memory items with pagination and search (legacy)',
          tags: ['Memories (Legacy)'],
          parameters: [
            namespaceParam(),
            {
              name: 'search',
              in: 'query',
              description: 'Search in title and content fields',
              schema: { type: 'string' },
              example: 'dark mode',
            },
            {
              name: 'type',
              in: 'query',
              description: 'Filter by memory type',
              schema: { type: 'string', enum: ['note', 'decision', 'context', 'reference'] },
              example: 'note',
            },
            {
              name: 'linked_item_kind',
              in: 'query',
              description: 'Filter by linked work item kind (e.g. task, epic, issue)',
              schema: { type: 'string' },
              example: 'task',
            },
            {
              name: 'tags',
              in: 'query',
              description: 'Comma-separated tags to filter by (array containment)',
              schema: { type: 'string' },
              example: 'sprint,planning',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Paginated memory list', {
              type: 'object',
              required: ['items', 'total', 'has_more'],
              properties: {
                items: { type: 'array', items: ref('LegacyMemory'), description: 'List of memories matching the filters' },
                total: { type: 'integer', description: 'Total number of memories matching the filters', example: 42 },
                has_more: { type: 'boolean', description: 'Whether there are more results beyond the current page', example: true },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
        post: {
          operationId: 'createMemoryLegacy',
          summary: 'Create a memory linked to a work item (legacy)',
          tags: ['Memories (Legacy)'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['title', 'content', 'linked_item_id'],
            properties: {
              title: { type: 'string', description: 'Short title for the memory', example: 'Sprint planning decisions' },
              content: { type: 'string', description: 'Full text content of the memory', example: 'Team decided to focus on authentication module first' },
              linked_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item to link this memory to', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
              type: { type: 'string', enum: ['note', 'decision', 'context', 'reference'], default: 'note', description: 'Semantic type of the memory', example: 'decision' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorizing the memory', example: ['sprint', 'planning'] },
            },
          }),
          responses: {
            '201': jsonResponse('Memory created', ref('LegacyMemory')),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/memory/{id}': {
        parameters: [uuidParam('id', 'Memory UUID')],
        put: {
          operationId: 'updateMemoryLegacy',
          summary: 'Update a memory (legacy, full replace)',
          tags: ['Memories (Legacy)'],
          requestBody: jsonBody({
            type: 'object',
            required: ['title', 'content'],
            properties: {
              title: { type: 'string', description: 'Updated title for the memory', example: 'Updated sprint decisions' },
              content: { type: 'string', description: 'Updated content for the memory', example: 'Revised: focus on API module instead of auth' },
              type: { type: 'string', enum: ['note', 'decision', 'context', 'reference'], default: 'note', description: 'Updated semantic type', example: 'decision' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Updated tags', example: ['sprint', 'revised'] },
            },
          }),
          responses: {
            '200': jsonResponse('Updated memory', ref('LegacyMemory')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteMemoryLegacy',
          summary: 'Delete a memory (legacy)',
          tags: ['Memories (Legacy)'],
          responses: {
            '204': { description: 'Memory deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // -- Unified Memory API (/api/memories) -----------------------------------
      '/api/memories/global': {
        get: {
          operationId: 'listGlobalMemories',
          summary: 'List global memories (no work item or contact scope)',
          tags: ['Memories'],
          parameters: [
            namespaceParam(),
            {
              name: 'memory_type',
              in: 'query',
              description: 'Filter by memory type',
              schema: { type: 'string' },
              example: 'preference',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Global memories', {
              type: 'object',
              required: ['memories', 'total'],
              properties: {
                memories: { type: 'array', items: ref('Memory'), description: 'List of global (unscoped) memories' },
                total: { type: 'integer', description: 'Total number of global memories', example: 25 },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },

      '/api/memories/unified': {
        post: {
          operationId: 'createMemoryUnified',
          summary: 'Create a memory with flexible scoping',
          description: 'Supports scoping to work items, contacts, relationships, projects, or no scope (global).',
          tags: ['Memories'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('UnifiedMemoryCreateInput')),
          responses: {
            '201': jsonResponse('Memory created', ref('Memory')),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listMemoriesUnified',
          summary: 'List memories with flexible filtering',
          tags: ['Memories'],
          parameters: [
            namespaceParam(),
            {
              name: 'work_item_id',
              in: 'query',
              description: 'Filter by work item UUID',
              schema: { type: 'string', format: 'uuid' },
              example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            },
            {
              name: 'contact_id',
              in: 'query',
              description: 'Filter by contact UUID',
              schema: { type: 'string', format: 'uuid' },
              example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
            },
            {
              name: 'relationship_id',
              in: 'query',
              description: 'Filter by relationship UUID',
              schema: { type: 'string', format: 'uuid' },
              example: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
            },
            {
              name: 'project_id',
              in: 'query',
              description: 'Filter by project UUID',
              schema: { type: 'string', format: 'uuid' },
              example: 'e5f6a7b8-9012-3456-cdef-789012345678',
            },
            {
              name: 'memory_type',
              in: 'query',
              description: 'Filter by memory type',
              schema: { type: 'string' },
              example: 'preference',
            },
            {
              name: 'include_expired',
              in: 'query',
              description: 'Include memories past their expires_at timestamp',
              schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
              example: 'false',
            },
            {
              name: 'include_superseded',
              in: 'query',
              description: 'Include memories that have been superseded by newer versions',
              schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
              example: 'false',
            },
            {
              name: 'since',
              in: 'query',
              description: 'Filter memories created after this date/duration (e.g. "7d", "2w", ISO date)',
              schema: { type: 'string' },
              example: '7d',
            },
            {
              name: 'before',
              in: 'query',
              description: 'Filter memories created before this date/duration',
              schema: { type: 'string' },
              example: '2026-02-21T00:00:00Z',
            },
            {
              name: 'period',
              in: 'query',
              description: 'Named time period filter (e.g. today, this_week, this_month)',
              schema: { type: 'string' },
              example: 'this_week',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Filtered memory list', {
              type: 'object',
              required: ['memories', 'total'],
              properties: {
                memories: { type: 'array', items: ref('Memory'), description: 'List of memories matching the filters' },
                total: { type: 'integer', description: 'Total number of memories matching the filters', example: 42 },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/memories/bulk': {
        post: {
          operationId: 'bulkCreateMemories',
          summary: 'Bulk create memories',
          tags: ['Memories'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('BulkMemoryCreateInput')),
          responses: {
            '200': jsonResponse('Bulk creation result', ref('BulkOperationResult')),
            ...errorResponses(400, 401, 413, 500),
          },
        },
        patch: {
          operationId: 'bulkUpdateMemories',
          summary: 'Bulk update memories',
          tags: ['Memories'],
          requestBody: jsonBody(ref('BulkMemoryUpdateInput')),
          responses: {
            '200': jsonResponse('Bulk update result', ref('BulkOperationResult')),
            ...errorResponses(400, 401, 413, 500),
          },
        },
      },

      '/api/memories/{id}/supersede': {
        parameters: [uuidParam('id', 'Memory UUID to supersede')],
        post: {
          operationId: 'supersedeMemory',
          summary: 'Supersede a memory with a new one',
          description: 'Creates a new memory that inherits the scope of the old one and marks the old one as superseded.',
          tags: ['Memories'],
          requestBody: jsonBody({
            type: 'object',
            required: ['title', 'content'],
            properties: {
              title: { type: 'string', description: 'Title for the new superseding memory', example: 'Updated: User prefers light mode now' },
              content: { type: 'string', description: 'Content for the new superseding memory', example: 'User changed preference from dark mode to light mode' },
              memory_type: { type: 'string', description: 'Type for the new memory (defaults to same as superseded memory)', example: 'preference' },
              importance: { type: 'number', description: 'Importance score for the new memory (0-1)', example: 0.8 },
              confidence: { type: 'number', description: 'Confidence score for the new memory (0-1)', example: 1.0 },
            },
          }),
          responses: {
            '201': jsonResponse('New memory created', {
              type: 'object',
              required: ['new_memory', 'superseded_id'],
              properties: {
                new_memory: { ...ref('Memory'), description: 'The newly created superseding memory' },
                superseded_id: { type: 'string', format: 'uuid', description: 'UUID of the memory that was superseded', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/memories/{id}': {
        parameters: [uuidParam('id', 'Memory UUID')],
        patch: {
          operationId: 'updateMemory',
          summary: 'Partially update a memory',
          tags: ['Memories'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Updated title', example: 'Updated preference title' },
              content: { type: 'string', description: 'Updated content', example: 'User now prefers system theme' },
              type: { type: 'string', enum: ['note', 'decision', 'context', 'reference'], description: 'Updated memory type', example: 'note' },
            },
          }),
          responses: {
            '200': jsonResponse('Updated memory', ref('Memory')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteMemory',
          summary: 'Delete a memory',
          tags: ['Memories'],
          responses: {
            '204': { description: 'Memory deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // -- Memory-Contact links -------------------------------------------------
      '/api/memories/{id}/contacts': {
        parameters: [uuidParam('id', 'Memory UUID')],
        post: {
          operationId: 'linkMemoryToContact',
          summary: 'Link a memory to a contact',
          tags: ['Memories'],
          requestBody: jsonBody({
            type: 'object',
            required: ['contact_id'],
            properties: {
              contact_id: { type: 'string', format: 'uuid', description: 'UUID of the contact to link', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
              relationship_type: {
                type: 'string',
                enum: ['about', 'from', 'shared_with', 'mentioned'],
                default: 'about',
                description: 'How the contact relates to the memory',
                example: 'about',
              },
              notes: { type: 'string', description: 'Optional notes about the link', example: 'Primary stakeholder for this decision' },
            },
          }),
          responses: {
            '201': jsonResponse('Memory-contact link created', ref('MemoryContactLink')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        get: {
          operationId: 'listMemoryContacts',
          summary: 'Get contacts linked to a memory',
          tags: ['Memories'],
          parameters: [
            {
              name: 'relationship_type',
              in: 'query',
              description: 'Filter by relationship type',
              schema: { type: 'string', enum: ['about', 'from', 'shared_with', 'mentioned'] },
              example: 'about',
            },
          ],
          responses: {
            '200': jsonResponse('Linked contacts', {
              type: 'object',
              required: ['contacts'],
              properties: {
                contacts: {
                  type: 'array',
                  description: 'Contacts linked to this memory with relationship details',
                  items: {
                    allOf: [
                      ref('MemoryContactLink'),
                      {
                        type: 'object',
                        properties: {
                          contact_name: { type: 'string', description: 'Display name of the linked contact', example: 'Alice Johnson' },
                        },
                      },
                    ],
                  },
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/memories/{memory_id}/contacts/{contact_id}': {
        parameters: [
          uuidParam('memory_id', 'Memory UUID'),
          uuidParam('contact_id', 'Contact UUID'),
        ],
        delete: {
          operationId: 'unlinkMemoryFromContact',
          summary: 'Remove a memory-contact link',
          tags: ['Memories'],
          parameters: [
            {
              name: 'relationship_type',
              in: 'query',
              description: 'Optionally narrow deletion to a specific relationship type',
              schema: { type: 'string', enum: ['about', 'from', 'shared_with', 'mentioned'] },
              example: 'about',
            },
          ],
          responses: {
            '204': { description: 'Link removed' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // -- Memory-Memory relationships ------------------------------------------
      '/api/memories/{id}/related': {
        parameters: [uuidParam('id', 'Memory UUID')],
        post: {
          operationId: 'linkRelatedMemories',
          summary: 'Link two memories together',
          tags: ['Memories'],
          requestBody: jsonBody({
            type: 'object',
            required: ['related_memory_id'],
            properties: {
              related_memory_id: { type: 'string', format: 'uuid', description: 'UUID of the memory to link to', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
              relationship_type: {
                type: 'string',
                enum: ['related', 'supersedes', 'contradicts', 'supports'],
                default: 'related',
                description: 'How the two memories relate to each other',
                example: 'supports',
              },
              notes: { type: 'string', description: 'Optional notes about the relationship', example: 'This memory provides additional context' },
            },
          }),
          responses: {
            '201': jsonResponse('Memory relationship created', ref('MemoryRelationshipLink')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        get: {
          operationId: 'listRelatedMemories',
          summary: 'Get memories related to this one',
          tags: ['Memories'],
          parameters: [
            {
              name: 'relationship_type',
              in: 'query',
              description: 'Filter by relationship type',
              schema: { type: 'string', enum: ['related', 'supersedes', 'contradicts', 'supports'] },
              example: 'related',
            },
            {
              name: 'direction',
              in: 'query',
              description: 'Filter by direction of relationship',
              schema: { type: 'string', enum: ['outgoing', 'incoming'] },
              example: 'outgoing',
            },
          ],
          responses: {
            '200': jsonResponse('Related memories', {
              type: 'object',
              required: ['related'],
              properties: {
                related: {
                  type: 'array',
                  description: 'Memories related to the specified memory',
                  items: {
                    type: 'object',
                    required: ['relationship_id', 'relationship_type', 'linked_at', 'direction', 'id', 'title', 'content', 'type'],
                    properties: {
                      relationship_id: { type: 'string', format: 'uuid', description: 'UUID of the memory-memory relationship', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                      relationship_type: { type: 'string', description: 'Type of relationship between the memories', example: 'supports' },
                      relationship_notes: { type: 'string', nullable: true, description: 'Notes about the relationship', example: 'Provides additional context' },
                      linked_at: { type: 'string', format: 'date-time', description: 'When the relationship was created', example: '2026-02-21T14:30:00Z' },
                      direction: { type: 'string', enum: ['outgoing', 'incoming'], description: 'Whether this is an outgoing or incoming relationship', example: 'outgoing' },
                      id: { type: 'string', format: 'uuid', description: 'UUID of the related memory', example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' },
                      title: { type: 'string', description: 'Title of the related memory', example: 'Notification frequency preference' },
                      content: { type: 'string', description: 'Content of the related memory', example: 'User prefers weekly digest emails' },
                      type: { type: 'string', description: 'Type of the related memory', example: 'preference' },
                      linked_item_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the linked work item, if any', example: null },
                      created_at: { type: 'string', format: 'date-time', description: 'When the related memory was created', example: '2026-02-21T14:30:00Z' },
                      updated_at: { type: 'string', format: 'date-time', description: 'When the related memory was last updated', example: '2026-02-21T14:30:00Z' },
                    },
                  },
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/memories/{memory_id}/related/{related_memory_id}': {
        parameters: [
          uuidParam('memory_id', 'Memory UUID'),
          uuidParam('related_memory_id', 'Related memory UUID'),
        ],
        delete: {
          operationId: 'unlinkRelatedMemories',
          summary: 'Remove a memory-memory relationship',
          tags: ['Memories'],
          responses: {
            '204': { description: 'Relationship removed' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // -- Similar memories -----------------------------------------------------
      '/api/memories/{id}/similar': {
        parameters: [uuidParam('id', 'Memory UUID')],
        get: {
          operationId: 'findSimilarMemories',
          summary: 'Find semantically similar memories using embeddings',
          tags: ['Memories'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of results (max 50)',
              schema: { type: 'integer', default: 10, maximum: 50 },
              example: 10,
            },
            {
              name: 'threshold',
              in: 'query',
              description: 'Minimum similarity threshold (0 = any match, 1 = exact match)',
              schema: { type: 'number', default: 0.7, minimum: 0, maximum: 1 },
              example: 0.7,
            },
          ],
          responses: {
            '200': jsonResponse('Similar memories', {
              type: 'object',
              required: ['source_memory_id', 'threshold', 'similar'],
              properties: {
                source_memory_id: { type: 'string', format: 'uuid', description: 'UUID of the source memory used for similarity search', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                threshold: { type: 'number', description: 'Similarity threshold that was applied', example: 0.7 },
                similar: {
                  type: 'array',
                  description: 'Memories semantically similar to the source memory',
                  items: {
                    type: 'object',
                    required: ['id', 'title', 'content', 'type', 'similarity'],
                    properties: {
                      id: { type: 'string', format: 'uuid', description: 'UUID of the similar memory', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                      title: { type: 'string', description: 'Title of the similar memory', example: 'Theme preferences' },
                      content: { type: 'string', description: 'Content of the similar memory', example: 'User mentioned preferring dark themes in apps' },
                      type: { type: 'string', description: 'Type of the similar memory', example: 'preference' },
                      linked_item_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the linked work item, if any', example: null },
                      created_at: { type: 'string', format: 'date-time', description: 'When the similar memory was created', example: '2026-02-20T10:00:00Z' },
                      updated_at: { type: 'string', format: 'date-time', description: 'When the similar memory was last updated', example: '2026-02-20T10:00:00Z' },
                      similarity: { type: 'number', description: 'Cosine similarity score (0-1)', example: 0.89 },
                    },
                  },
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // -- Attachments ----------------------------------------------------------
      '/api/memories/{id}/attachments': {
        parameters: [uuidParam('id', 'Memory UUID')],
        post: {
          operationId: 'attachFileToMemory',
          summary: 'Attach a file to a memory',
          tags: ['Memories'],
          requestBody: jsonBody({
            type: 'object',
            required: ['file_id'],
            properties: {
              file_id: { type: 'string', format: 'uuid', description: 'UUID of an existing file_attachment to link to this memory', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            },
          }),
          responses: {
            '201': jsonResponse('Attachment created', {
              type: 'object',
              required: ['memory_id', 'file_id', 'attached'],
              properties: {
                memory_id: { type: 'string', format: 'uuid', description: 'UUID of the memory', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                file_id: { type: 'string', format: 'uuid', description: 'UUID of the attached file', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
                attached: { type: 'boolean', description: 'Whether the attachment was successfully created', example: true },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        get: {
          operationId: 'listMemoryAttachments',
          summary: 'List files attached to a memory',
          tags: ['Memories'],
          responses: {
            '200': jsonResponse('Memory attachments', {
              type: 'object',
              required: ['attachments'],
              properties: {
                attachments: { type: 'array', items: ref('MemoryAttachment'), description: 'Files attached to this memory' },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/memories/{memory_id}/attachments/{file_id}': {
        parameters: [
          uuidParam('memory_id', 'Memory UUID'),
          uuidParam('file_id', 'File attachment UUID'),
        ],
        delete: {
          operationId: 'removeMemoryAttachment',
          summary: 'Remove an attachment from a memory',
          tags: ['Memories'],
          responses: {
            '204': { description: 'Attachment removed' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // -- Cleanup --------------------------------------------------------------
      '/api/memories/cleanup-expired': {
        delete: {
          operationId: 'cleanupExpiredMemories',
          summary: 'Delete all expired memories',
          tags: ['Memories'],
          responses: {
            '200': jsonResponse('Cleanup result', {
              type: 'object',
              required: ['deleted'],
              properties: {
                deleted: { type: 'integer', description: 'Number of expired memories that were deleted', example: 7 },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },

      // -- Project-scoped memories ----------------------------------------------
      '/api/projects/{id}/memories': {
        parameters: [uuidParam('id', 'Project (work item) UUID')],
        get: {
          operationId: 'listProjectMemories',
          summary: 'List memories scoped to a project',
          tags: ['Memories'],
          parameters: [
            {
              name: 'memory_type',
              in: 'query',
              description: 'Filter by memory type',
              schema: { type: 'string' },
              example: 'decision',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Project memories', {
              type: 'object',
              required: ['memories', 'total'],
              properties: {
                memories: { type: 'array', items: ref('Memory'), description: 'Memories scoped to this project' },
                total: { type: 'integer', description: 'Total number of memories for this project', example: 15 },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // -- Admin: Embeddings ----------------------------------------------------
      '/api/admin/embeddings/backfill': {
        post: {
          operationId: 'backfillMemoryEmbeddings',
          summary: 'Backfill embeddings for memories',
          tags: ['Admin - Embeddings'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              batch_size: { type: 'integer', default: 100, minimum: 1, maximum: 1000, description: 'Number of memories to process per batch', example: 100 },
              force: { type: 'boolean', default: false, description: 'Re-generate embeddings even for memories that already have them', example: false },
            },
          }, false),
          responses: {
            '202': jsonResponse('Backfill completed', ref('BackfillResult')),
            ...errorResponses(401, 500),
          },
        },
      },

      '/api/admin/embeddings/backfill-work-items': {
        post: {
          operationId: 'backfillWorkItemEmbeddings',
          summary: 'Backfill embeddings for work items',
          tags: ['Admin - Embeddings'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              batch_size: { type: 'integer', default: 100, minimum: 1, maximum: 1000, description: 'Number of work items to process per batch', example: 100 },
              force: { type: 'boolean', default: false, description: 'Re-generate embeddings even for work items that already have them', example: false },
            },
          }, false),
          responses: {
            '202': jsonResponse('Backfill completed', ref('BackfillResult')),
            ...errorResponses(401, 500),
          },
        },
      },

      '/api/admin/embeddings/status': {
        get: {
          operationId: 'getEmbeddingStatus',
          summary: 'Get embedding configuration and statistics',
          tags: ['Admin - Embeddings'],
          responses: {
            '200': jsonResponse('Embedding status', ref('EmbeddingStatus')),
            ...errorResponses(401, 500),
          },
        },
      },
    },
  };
}
