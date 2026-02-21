/**
 * OpenAPI path definitions for backlog, inbox, and trash endpoints.
 * Routes: GET /api/backlog, GET /api/inbox,
 *         GET /api/trash, POST /api/trash/purge
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, errorResponses, jsonBody, jsonResponse, namespaceParam } from '../helpers.ts';

export function backlogInboxPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Backlog & Inbox', description: 'Filtered views of work items and inbound communications' },
      { name: 'Trash', description: 'Soft-deleted item management and purging' },
    ],

    schemas: {
      BacklogItem: {
        type: 'object',
        required: ['id', 'title', 'status', 'kind', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the backlog work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Title of the work item', example: 'Implement user authentication' },
          description: { type: 'string', nullable: true, description: 'Detailed description in markdown', example: 'Add JWT-based auth flow with refresh tokens' },
          status: { type: 'string', description: 'Current workflow status', example: 'backlog' },
          priority: { type: 'string', description: 'Priority ranking (P0-P4)', example: 'P2' },
          task_type: { type: 'string', description: 'Legacy task type classifier', example: 'feature' },
          kind: { type: 'string', description: 'Hierarchy level (project, initiative, epic, issue, task)', example: 'issue' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent work item, or null if top-level', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          not_before: { type: 'string', format: 'date-time', nullable: true, description: 'Reminder / start date', example: '2026-03-01T09:00:00Z' },
          not_after: { type: 'string', format: 'date-time', nullable: true, description: 'Deadline / end date', example: '2026-03-15T17:00:00Z' },
          estimate_minutes: { type: 'integer', nullable: true, description: 'Estimated effort in minutes', example: 120 },
          actual_minutes: { type: 'integer', nullable: true, description: 'Actual effort spent in minutes', example: 90 },
          created_at: { type: 'string', format: 'date-time', description: 'When the work item was created', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'When the work item was last updated', example: '2026-02-21T15:00:00Z' },
        },
      },
      InboxItem: {
        type: 'object',
        required: ['work_item_id', 'title', 'action', 'channel', 'external_thread_key'],
        properties: {
          work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item linked to this inbox entry', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Title of the linked work item', example: 'Implement user authentication' },
          action: { type: 'string', description: 'Pending action on the communication (e.g. reply_required, follow_up)', example: 'reply_required' },
          channel: { type: 'string', description: 'Communication channel (e.g. email, sms, whatsapp)', example: 'email' },
          external_thread_key: { type: 'string', description: 'External thread identifier for the communication', example: 'thread-abc-123' },
          last_message_body: { type: 'string', nullable: true, description: 'Preview of the most recent message body', example: 'Hey, can you review the auth design?' },
          last_message_received_at: { type: 'string', format: 'date-time', nullable: true, description: 'When the most recent message was received', example: '2026-02-21T14:30:00Z' },
        },
      },
      TrashItem: {
        type: 'object',
        required: ['id', 'entity_type', 'deleted_at', 'days_until_purge'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'UUID of the soft-deleted entity', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          entity_type: { type: 'string', enum: ['work_item', 'contact'], description: 'Type of the soft-deleted entity', example: 'work_item' },
          title: { type: 'string', description: 'Title of the entity (present for work items)', example: 'Implement user authentication' },
          display_name: { type: 'string', description: 'Display name of the entity (present for contacts)', example: 'Alice Johnson' },
          deleted_at: { type: 'string', format: 'date-time', description: 'When the entity was soft-deleted', example: '2026-02-20T10:00:00Z' },
          days_until_purge: { type: 'integer', description: 'Number of days remaining before the entity is automatically purged', example: 29 },
        },
      },
      TrashListResponse: {
        type: 'object',
        required: ['items', 'total', 'limit', 'offset', 'retention_days'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/TrashItem' }, description: 'Array of soft-deleted entities' },
          total: { type: 'integer', description: 'Total number of soft-deleted entities matching the filter', example: 42 },
          limit: { type: 'integer', description: 'Maximum results returned in this response', example: 50 },
          offset: { type: 'integer', description: 'Number of results skipped', example: 0 },
          retention_days: { type: 'integer', description: 'Default retention period in days before automatic purge', example: 30 },
        },
      },
      PurgeRequest: {
        type: 'object',
        properties: {
          retention_days: {
            type: 'integer',
            default: 30,
            minimum: 1,
            maximum: 365,
            description: 'Items deleted more than this many days ago will be permanently removed',
            example: 30,
          },
        },
      },
      PurgeResponse: {
        type: 'object',
        required: ['success', 'retention_days', 'work_items_purged', 'contacts_purged', 'total_purged'],
        properties: {
          success: { type: 'boolean', description: 'Whether the purge operation completed successfully', example: true },
          retention_days: { type: 'integer', description: 'The retention period that was applied', example: 30 },
          work_items_purged: { type: 'integer', description: 'Number of work items permanently removed', example: 5 },
          contacts_purged: { type: 'integer', description: 'Number of contacts permanently removed', example: 2 },
          total_purged: { type: 'integer', description: 'Total number of entities permanently removed', example: 7 },
        },
      },
    },

    paths: {
      '/api/backlog': {
        get: {
          operationId: 'listBacklog',
          summary: 'List backlog items',
          description: 'Returns work items with optional filtering by status, priority, and kind. Results ordered by priority then creation date. Max 100 items.',
          tags: ['Backlog & Inbox'],
          parameters: [
            {
              name: 'status',
              in: 'query',
              description: 'Filter by status (supports multiple comma-separated values)',
              schema: { type: 'string' },
              example: 'backlog',
            },
            {
              name: 'priority',
              in: 'query',
              description: 'Filter by priority (supports multiple comma-separated values)',
              schema: { type: 'string' },
              example: 'P1',
            },
            {
              name: 'kind',
              in: 'query',
              description: 'Filter by work item kind (supports multiple comma-separated values)',
              schema: { type: 'string' },
              example: 'issue',
            },
          ],
          responses: {
            '200': jsonResponse('Backlog items', {
              type: 'object',
              properties: {
                items: { type: 'array', description: 'Array of backlog work items', items: ref('BacklogItem') },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },

      '/api/inbox': {
        get: {
          operationId: 'listInbox',
          summary: 'List inbox items',
          description: 'Returns work items that have linked communications (inbound messages). Shows the most recent message for each item.',
          tags: ['Backlog & Inbox'],
          responses: {
            '200': jsonResponse('Inbox items', {
              type: 'object',
              properties: {
                items: { type: 'array', description: 'Array of inbox entries with linked communication details', items: ref('InboxItem') },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },

      '/api/trash': {
        get: {
          operationId: 'listTrash',
          summary: 'List soft-deleted items',
          description: 'Returns all soft-deleted work items and contacts with their remaining days until automatic purge.',
          tags: ['Trash'],
          parameters: [
            {
              name: 'entity_type',
              in: 'query',
              description: 'Filter by entity type',
              schema: { type: 'string', enum: ['work_item', 'contact'] },
              example: 'work_item',
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum results (default: 50, max: 500)',
              schema: { type: 'integer', default: 50, maximum: 500 },
              example: 50,
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of results to skip',
              schema: { type: 'integer', default: 0 },
              example: 0,
            },
          ],
          responses: {
            '200': jsonResponse('Trash items', ref('TrashListResponse')),
            ...errorResponses(401, 403, 500),
          },
        },
      },

      '/api/trash/purge': {
        post: {
          operationId: 'purgeTrash',
          summary: 'Purge old soft-deleted items',
          description: 'Permanently removes items that have been soft-deleted for longer than the specified retention period. Calls the purge_soft_deleted database function.',
          tags: ['Trash'],
          requestBody: jsonBody(ref('PurgeRequest'), false),
          responses: {
            '200': jsonResponse('Purge result', ref('PurgeResponse')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
    },
  };
}
