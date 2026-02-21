/**
 * OpenAPI path definitions for audit log and timeline endpoints.
 * Routes: GET /api/audit-log, GET /api/audit-log/entity/{type}/{id},
 *         POST /api/audit-log/purge,
 *         GET /api/timeline, GET /api/work-items/{id}/timeline
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, uuidParam, errorResponses, jsonBody, jsonResponse, namespaceParam } from '../helpers.ts';

export function auditTimelinePaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Audit Log', description: 'System-wide audit trail for all entity changes' },
      { name: 'Timeline', description: 'Gantt-style timeline views with dates and dependencies' },
    ],

    schemas: {
      AuditLogEntry: {
        type: 'object',
        required: ['id', 'entity_type', 'entity_id', 'action', 'actor_type', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the audit log entry', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          entity_type: { type: 'string', description: 'Type of entity that was modified (e.g. work_item, contact, memory)', example: 'work_item' },
          entity_id: { type: 'string', format: 'uuid', description: 'UUID of the entity that was modified', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          action: { type: 'string', enum: ['create', 'update', 'delete', 'auth', 'webhook'], description: 'Type of action that was performed', example: 'create' },
          actor_type: { type: 'string', enum: ['agent', 'human', 'system'], description: 'Type of actor who performed the action', example: 'agent' },
          actor_id: { type: 'string', nullable: true, description: 'Identifier of the actor (email, agent ID, or null for system)', example: 'alice@example.com' },
          details: {
            type: 'object',
            nullable: true,
            description: 'Additional context about the change, such as changed fields and their old/new values',
            properties: {
              changed_fields: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of field names that were modified',
                example: ['status', 'priority'],
              },
              old_values: {
                type: 'object',
                description: 'Previous values of the changed fields',
                additionalProperties: true,
                example: { status: 'open', priority: 'P2' },
              },
              new_values: {
                type: 'object',
                description: 'New values of the changed fields',
                additionalProperties: true,
                example: { status: 'in_progress', priority: 'P1' },
              },
            },
          },
          created_at: { type: 'string', format: 'date-time', description: 'When the audit entry was recorded', example: '2026-02-21T14:30:00Z' },
        },
      },
      AuditLogListResponse: {
        type: 'object',
        required: ['entries', 'total', 'limit', 'offset'],
        properties: {
          entries: { type: 'array', items: { $ref: '#/components/schemas/AuditLogEntry' }, description: 'Array of audit log entries' },
          total: { type: 'integer', description: 'Total number of entries matching the filter criteria', example: 150 },
          limit: { type: 'integer', description: 'Maximum results returned in this response', example: 50 },
          offset: { type: 'integer', description: 'Number of results skipped', example: 0 },
        },
      },
      AuditLogEntityResponse: {
        type: 'object',
        required: ['entity_type', 'entity_id', 'entries', 'count'],
        properties: {
          entity_type: { type: 'string', description: 'Type of the queried entity', example: 'work_item' },
          entity_id: { type: 'string', description: 'UUID of the queried entity', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          entries: { type: 'array', items: { $ref: '#/components/schemas/AuditLogEntry' }, description: 'Array of audit log entries for this entity' },
          count: { type: 'integer', description: 'Total number of entries for this entity', example: 12 },
        },
      },
      AuditPurgeRequest: {
        type: 'object',
        properties: {
          retention_days: {
            type: 'integer',
            default: 90,
            minimum: 1,
            maximum: 3650,
            description: 'Entries older than this many days will be permanently purged',
            example: 90,
          },
        },
      },
      AuditPurgeResponse: {
        type: 'object',
        required: ['success', 'purged', 'retention_days'],
        properties: {
          success: { type: 'boolean', description: 'Whether the purge operation completed successfully', example: true },
          purged: { type: 'integer', description: 'Number of audit log entries permanently removed', example: 250 },
          retention_days: { type: 'integer', description: 'The retention period that was applied', example: 90 },
        },
      },
      TimelineItem: {
        type: 'object',
        required: ['id', 'title', 'kind', 'status', 'level', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'UUID of the work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Title of the work item', example: 'Implement user authentication' },
          kind: { type: 'string', description: 'Hierarchy level (project, initiative, epic, issue, task)', example: 'task' },
          status: { type: 'string', description: 'Current workflow status', example: 'in_progress' },
          priority: { type: 'string', description: 'Priority ranking (P0-P4)', example: 'P1' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent work item', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          level: { type: 'integer', description: 'Depth level in the hierarchy (0 = root)', example: 2 },
          not_before: { type: 'string', format: 'date-time', nullable: true, description: 'Start date for timeline bar rendering', example: '2026-03-01T09:00:00Z' },
          not_after: { type: 'string', format: 'date-time', nullable: true, description: 'End date for timeline bar rendering', example: '2026-03-15T17:00:00Z' },
          estimate_minutes: { type: 'integer', nullable: true, description: 'Estimated effort in minutes', example: 120 },
          actual_minutes: { type: 'integer', nullable: true, description: 'Actual effort spent in minutes', example: 90 },
          created_at: { type: 'string', format: 'date-time', description: 'When the work item was created', example: '2026-02-21T14:30:00Z' },
        },
      },
      TimelineDependency: {
        type: 'object',
        required: ['id', 'from_id', 'to_id', 'kind'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'UUID of the dependency relationship', example: 'e4f5a6b7-8901-23cd-ef45-678901234567' },
          from_id: { type: 'string', format: 'uuid', description: 'UUID of the source (blocking) work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          to_id: { type: 'string', format: 'uuid', description: 'UUID of the target (blocked) work item', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          kind: { type: 'string', description: 'Type of dependency relationship', example: 'depends_on' },
        },
      },
      TimelineResponse: {
        type: 'object',
        required: ['items', 'dependencies'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/TimelineItem' }, description: 'Work items with date ranges for Gantt-style rendering' },
          dependencies: { type: 'array', items: { $ref: '#/components/schemas/TimelineDependency' }, description: 'Dependency edges between timeline items for drawing connector lines' },
        },
      },
    },

    paths: {
      '/api/audit-log': {
        get: {
          operationId: 'listAuditLog',
          summary: 'List audit log entries',
          description: 'Returns audit log entries with filtering by entity type, actor, action, and date range.',
          tags: ['Audit Log'],
          parameters: [
            {
              name: 'entity_type',
              in: 'query',
              description: 'Filter by entity type (e.g. work_item, contact)',
              schema: { type: 'string' },
              example: 'work_item',
            },
            {
              name: 'entity_id',
              in: 'query',
              description: 'Filter by entity UUID',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
            {
              name: 'actor_type',
              in: 'query',
              description: 'Filter by actor type',
              schema: { type: 'string', enum: ['agent', 'human', 'system'] },
              example: 'agent',
            },
            {
              name: 'actor_id',
              in: 'query',
              description: 'Filter by actor identifier (e.g. email address)',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
            {
              name: 'action',
              in: 'query',
              description: 'Filter by action type',
              schema: { type: 'string', enum: ['create', 'update', 'delete', 'auth', 'webhook'] },
              example: 'create',
            },
            {
              name: 'start_date',
              in: 'query',
              description: 'Filter entries created on or after this date-time',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-01T00:00:00Z',
            },
            {
              name: 'end_date',
              in: 'query',
              description: 'Filter entries created on or before this date-time',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-28T23:59:59Z',
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum results (default: 50)',
              schema: { type: 'integer', default: 50 },
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
            '200': jsonResponse('Audit log entries', ref('AuditLogListResponse')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/audit-log/entity/{type}/{id}': {
        parameters: [
          {
            name: 'type',
            in: 'path',
            required: true,
            description: 'Entity type (e.g. work_item, contact, memory)',
            schema: { type: 'string' },
            example: 'work_item',
          },
          uuidParam('id', 'Entity UUID'),
        ],
        get: {
          operationId: 'getEntityAuditLog',
          summary: 'Get audit log for a specific entity',
          description: 'Returns all audit log entries for a specific entity identified by type and ID.',
          tags: ['Audit Log'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum results',
              schema: { type: 'integer' },
              example: 50,
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of results to skip',
              schema: { type: 'integer' },
              example: 0,
            },
          ],
          responses: {
            '200': jsonResponse('Entity audit log', ref('AuditLogEntityResponse')),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/audit-log/purge': {
        post: {
          operationId: 'purgeAuditLog',
          summary: 'Purge old audit log entries',
          description: 'Permanently removes audit log entries older than the specified retention period.',
          tags: ['Audit Log'],
          requestBody: jsonBody(ref('AuditPurgeRequest'), false),
          responses: {
            '200': jsonResponse('Purge result', ref('AuditPurgeResponse')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/timeline': {
        get: {
          operationId: 'getGlobalTimeline',
          summary: 'Get global timeline',
          description: 'Returns work items that have dates (not_before or not_after) along with their dependencies. Supports filtering by date range, kind, and parent hierarchy.',
          tags: ['Timeline'],
          parameters: [
            namespaceParam(),
            {
              name: 'from',
              in: 'query',
              description: 'Filter items with dates on or after this timestamp',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-01T00:00:00Z',
            },
            {
              name: 'to',
              in: 'query',
              description: 'Filter items with dates on or before this timestamp',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-03-31T23:59:59Z',
            },
            {
              name: 'kind',
              in: 'query',
              description: 'Filter by kind (comma-separated, e.g. "epic,issue")',
              schema: { type: 'string' },
              example: 'epic,issue',
            },
            {
              name: 'parent_id',
              in: 'query',
              description: 'Show timeline for all descendants of this parent work item',
              schema: { type: 'string', format: 'uuid' },
              example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
            },
          ],
          responses: {
            '200': jsonResponse('Timeline data', ref('TimelineResponse')),
            ...errorResponses(401, 403, 500),
          },
        },
      },

      '/api/work-items/{id}/timeline': {
        parameters: [uuidParam('id', 'Root work item UUID')],
        get: {
          operationId: 'getWorkItemTimeline',
          summary: 'Get timeline for a work item subtree',
          description: 'Returns all descendants of a work item with their hierarchy levels and inter-item dependencies. Useful for Gantt chart rendering.',
          tags: ['Timeline'],
          responses: {
            '200': jsonResponse('Subtree timeline data', ref('TimelineResponse')),
            ...errorResponses(401, 404, 500),
          },
        },
      },
    },
  };
}
