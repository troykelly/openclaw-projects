/**
 * OpenAPI path definitions for bulk work item operations.
 * Routes: POST /api/work-items/bulk, DELETE /api/work-items/bulk,
 *         PATCH /api/work-items/bulk
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, errorResponses, jsonBody, jsonResponse, namespaceParam } from '../helpers.ts';

export function bulkOperationsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Bulk Operations', description: 'Batch create, update, and delete work items' },
    ],

    schemas: {
      BulkCreateItem: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Title of the work item to create (required)', example: 'Implement user authentication' },
          work_item_kind: { type: 'string', description: 'Kind of work item (default: issue)', example: 'issue' },
          parent_work_item_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent work item', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          status: { type: 'string', description: 'Initial status (default: backlog)', example: 'backlog' },
          priority: { type: 'string', description: 'Priority level (default: P2)', example: 'P2' },
          description: { type: 'string', nullable: true, description: 'Detailed description in markdown', example: 'Add JWT-based auth flow with refresh tokens' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Labels to attach to the work item', example: ['backend', 'security'] },
          not_before: { type: 'string', format: 'date-time', nullable: true, description: 'Reminder / start date for the work item', example: '2026-03-01T09:00:00Z' },
          not_after: { type: 'string', format: 'date-time', nullable: true, description: 'Deadline / end date for the work item', example: '2026-03-15T17:00:00Z' },
        },
      },
      BulkCreateRequest: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/BulkCreateItem' },
            description: 'Array of work items to create (max 100)',
            maxItems: 100,
          },
        },
      },
      BulkCreateResult: {
        type: 'object',
        required: ['index', 'status'],
        properties: {
          index: { type: 'integer', description: 'Zero-based index of the item in the request array', example: 0 },
          id: { type: 'string', format: 'uuid', description: 'UUID of the created item (present only when status is created)', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          status: { type: 'string', enum: ['created', 'failed'], description: 'Result status for this individual item', example: 'created' },
          error: { type: 'string', description: 'Error message explaining why the item failed (present only when status is failed)', example: 'Title is required' },
        },
      },
      BulkCreateResponse: {
        type: 'object',
        required: ['success', 'created', 'failed', 'results'],
        properties: {
          success: { type: 'boolean', description: 'True if all items were created successfully, false if any failed', example: true },
          created: { type: 'integer', description: 'Number of items successfully created', example: 3 },
          failed: { type: 'integer', description: 'Number of items that failed validation or creation', example: 0 },
          results: {
            type: 'array',
            items: { $ref: '#/components/schemas/BulkCreateResult' },
            description: 'Per-item results in the same order as the request',
          },
        },
      },
      BulkDeleteRequest: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Array of work item UUIDs to delete (max 100)',
            maxItems: 100,
            example: ['d290f1ee-6c54-4b01-90e6-d701748f0851', 'a1b2c3d4-5678-90ab-cdef-1234567890ab'],
          },
        },
      },
      BulkDeleteResponse: {
        type: 'object',
        required: ['success', 'deleted', 'ids'],
        properties: {
          success: { type: 'boolean', description: 'True if all specified items were deleted', example: true },
          deleted: { type: 'integer', description: 'Number of items permanently deleted', example: 2 },
          ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'UUIDs of the deleted work items',
            example: ['d290f1ee-6c54-4b01-90e6-d701748f0851', 'a1b2c3d4-5678-90ab-cdef-1234567890ab'],
          },
        },
      },
      BulkUpdateRequest: {
        type: 'object',
        required: ['ids', 'action'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            description: 'Array of work item UUIDs to update (max 100)',
            maxItems: 100,
            example: ['d290f1ee-6c54-4b01-90e6-d701748f0851', 'a1b2c3d4-5678-90ab-cdef-1234567890ab'],
          },
          action: {
            type: 'string',
            enum: ['status', 'priority', 'parent', 'delete'],
            description: 'The bulk action to perform on all specified items',
            example: 'status',
          },
          value: {
            type: 'string',
            nullable: true,
            description: 'New value for the action (e.g. status string, priority, parent UUID, or null to unparent)',
            example: 'in_progress',
          },
        },
      },
      BulkUpdateResponse: {
        type: 'object',
        required: ['success', 'action', 'affected'],
        properties: {
          success: { type: 'boolean', description: 'True if the bulk operation completed successfully', example: true },
          action: { type: 'string', description: 'The bulk action that was performed', example: 'status' },
          affected: { type: 'integer', description: 'Number of work items affected by the operation', example: 2 },
          items: {
            type: 'array',
            description: 'The affected work items with their updated fields',
            items: {
              type: 'object',
              required: ['id', 'title', 'status', 'updated_at'],
              properties: {
                id: { type: 'string', format: 'uuid', description: 'UUID of the updated work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                title: { type: 'string', description: 'Title of the work item', example: 'Implement user authentication' },
                status: { type: 'string', description: 'Current status after the update', example: 'in_progress' },
                priority: { type: 'string', description: 'Current priority after the update', example: 'P1' },
                updated_at: { type: 'string', format: 'date-time', description: 'Timestamp of the update', example: '2026-02-21T15:00:00Z' },
              },
            },
          },
        },
      },
    },

    paths: {
      '/api/work-items/bulk': {
        post: {
          operationId: 'bulkCreateWorkItems',
          summary: 'Bulk create work items',
          description: 'Creates multiple work items in a single transaction. Maximum 100 items per request. Individual items that fail validation are reported but do not block others.',
          tags: ['Bulk Operations'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('BulkCreateRequest')),
          responses: {
            '200': jsonResponse('Bulk creation result (partial or full success)', ref('BulkCreateResponse')),
            '400': jsonResponse('All items failed or invalid request', ref('BulkCreateResponse')),
            '413': jsonResponse('Too many items', {
              type: 'object',
              required: ['error', 'limit', 'requested'],
              properties: {
                error: { type: 'string', description: 'Error message explaining the limit', example: 'Too many items in bulk request' },
                limit: { type: 'integer', description: 'Maximum allowed items per request', example: 100 },
                requested: { type: 'integer', description: 'Number of items that were submitted', example: 150 },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
        delete: {
          operationId: 'bulkDeleteWorkItems',
          summary: 'Bulk delete work items',
          description: 'Permanently deletes multiple work items. Maximum 100 items per request. Only items within the caller namespace are deleted.',
          tags: ['Bulk Operations'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('BulkDeleteRequest')),
          responses: {
            '200': jsonResponse('Bulk deletion result', ref('BulkDeleteResponse')),
            ...errorResponses(400, 401, 403, 413, 500),
          },
        },
        patch: {
          operationId: 'bulkUpdateWorkItems',
          summary: 'Bulk update work items',
          description: 'Applies a batch action (status, priority, parent, or delete) to multiple work items. Maximum 100 items per request.',
          tags: ['Bulk Operations'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('BulkUpdateRequest')),
          responses: {
            '200': jsonResponse('Bulk update result', ref('BulkUpdateResponse')),
            ...errorResponses(400, 401, 403, 413, 500),
          },
        },
      },
    },
  };
}
