/**
 * OpenAPI path definitions for analytics endpoints.
 * Routes: GET /api/analytics/project-health, GET /api/analytics/velocity,
 *         GET /api/analytics/effort, GET /api/analytics/burndown/:id,
 *         GET /api/analytics/overdue, GET /api/analytics/blocked,
 *         GET /api/analytics/activity-summary
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonResponse, uuidParam } from '../helpers.ts';

export function analyticsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Analytics', description: 'Project health, velocity, effort, and activity analytics' },
    ],
    schemas: {
      ProjectHealthEntry: {
        type: 'object',
        required: ['id', 'title', 'open_count', 'in_progress_count', 'closed_count', 'total_count'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the project',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          title: {
            type: 'string',
            description: 'Human-readable title of the project',
            example: 'Tiny Home Build',
          },
          open_count: {
            type: 'integer',
            description: 'Number of work items in open status',
            example: 15,
          },
          in_progress_count: {
            type: 'integer',
            description: 'Number of work items currently in progress',
            example: 8,
          },
          closed_count: {
            type: 'integer',
            description: 'Number of work items that have been closed or completed',
            example: 42,
          },
          total_count: {
            type: 'integer',
            description: 'Total number of work items across all statuses',
            example: 65,
          },
        },
      },
      VelocityWeek: {
        type: 'object',
        required: ['week_start', 'completed_count', 'estimated_minutes'],
        properties: {
          week_start: {
            type: 'string',
            format: 'date',
            description: 'ISO 8601 date of the first day (Monday) of the week',
            example: '2026-02-16',
          },
          completed_count: {
            type: 'integer',
            description: 'Number of work items completed during this week',
            example: 7,
          },
          estimated_minutes: {
            type: 'integer',
            description: 'Sum of estimated effort in minutes for completed items this week',
            example: 480,
          },
        },
      },
      EffortByStatus: {
        type: 'object',
        required: ['status', 'estimated_minutes', 'actual_minutes', 'item_count'],
        properties: {
          status: {
            type: 'string',
            description: 'Work item status label (e.g. open, in_progress, done)',
            example: 'in_progress',
          },
          estimated_minutes: {
            type: 'integer',
            description: 'Total estimated effort in minutes for items in this status',
            example: 960,
          },
          actual_minutes: {
            type: 'integer',
            description: 'Total actual effort logged in minutes for items in this status',
            example: 840,
          },
          item_count: {
            type: 'integer',
            description: 'Number of work items in this status',
            example: 12,
          },
        },
      },
      BurndownResponse: {
        type: 'object',
        required: ['total_scope', 'completed_scope', 'remaining_scope', 'total_items', 'completed_items'],
        properties: {
          total_scope: {
            type: 'integer',
            description: 'Total estimated effort in minutes across all child items',
            example: 2400,
          },
          completed_scope: {
            type: 'integer',
            description: 'Estimated effort in minutes for completed child items',
            example: 1200,
          },
          remaining_scope: {
            type: 'integer',
            description: 'Estimated effort in minutes for remaining (non-completed) child items',
            example: 1200,
          },
          total_items: {
            type: 'integer',
            description: 'Total number of child work items',
            example: 20,
          },
          completed_items: {
            type: 'integer',
            description: 'Number of completed child work items',
            example: 10,
          },
        },
      },
      OverdueItem: {
        type: 'object',
        required: ['id', 'title', 'status', 'priority', 'work_item_kind', 'due_date', 'overdue_by'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the overdue work item',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          title: {
            type: 'string',
            description: 'Title of the overdue work item',
            example: 'Submit building permit application',
          },
          status: {
            type: 'string',
            description: 'Current status of the work item',
            example: 'in_progress',
          },
          priority: {
            type: 'string',
            description: 'Priority level of the work item',
            example: 'high',
          },
          work_item_kind: {
            type: 'string',
            description: 'Type of the work item (e.g. task, issue, epic)',
            example: 'task',
          },
          due_date: {
            type: 'string',
            format: 'date-time',
            description: 'Original deadline (not_after) for the work item',
            example: '2026-02-18T17:00:00Z',
          },
          overdue_by: {
            type: 'string',
            description: 'PostgreSQL interval string representing how long the item has been overdue',
            example: '3 days 04:30:00',
          },
        },
      },
      BlockedItem: {
        type: 'object',
        required: ['id', 'title', 'status', 'priority', 'work_item_kind', 'blocked_by_id', 'blocked_by_title', 'blocked_by_status'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the blocked work item',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          title: {
            type: 'string',
            description: 'Title of the blocked work item',
            example: 'Install solar panels',
          },
          status: {
            type: 'string',
            description: 'Current status of the blocked work item',
            example: 'open',
          },
          priority: {
            type: 'string',
            description: 'Priority level of the blocked work item',
            example: 'high',
          },
          work_item_kind: {
            type: 'string',
            description: 'Type of the work item (e.g. task, issue, epic)',
            example: 'task',
          },
          blocked_by_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the blocking dependency work item',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          blocked_by_title: {
            type: 'string',
            description: 'Title of the blocking dependency work item',
            example: 'Complete roof framing',
          },
          blocked_by_status: {
            type: 'string',
            description: 'Current status of the blocking dependency work item',
            example: 'in_progress',
          },
        },
      },
    },
    paths: {
      '/api/analytics/project-health': {
        get: {
          operationId: 'getProjectHealth',
          summary: 'Get project health metrics',
          description: 'Returns open, in-progress, and closed work item counts for projects. Optionally filter by a specific project.',
          tags: ['Analytics'],
          parameters: [
            {
              name: 'project_id',
              in: 'query',
              description: 'Filter to a specific project',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          ],
          responses: {
            '200': jsonResponse('Project health metrics', {
              type: 'object',
              properties: {
                projects: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ProjectHealthEntry' },
                  description: 'List of project health entries with work item counts',
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/analytics/velocity': {
        get: {
          operationId: 'getVelocity',
          summary: 'Get velocity data',
          description: 'Returns weekly velocity (completed items and estimated minutes) over a configurable number of weeks.',
          tags: ['Analytics'],
          parameters: [
            {
              name: 'weeks',
              in: 'query',
              description: 'Number of weeks to include (max 52)',
              schema: { type: 'integer', default: 12, maximum: 52 },
              example: 12,
            },
            {
              name: 'project_id',
              in: 'query',
              description: 'Filter to a specific project',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          ],
          responses: {
            '200': jsonResponse('Velocity data', {
              type: 'object',
              properties: {
                weeks: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/VelocityWeek' },
                  description: 'Weekly velocity entries ordered chronologically',
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/analytics/effort': {
        get: {
          operationId: 'getEffort',
          summary: 'Get effort summary',
          description: 'Returns total estimated vs actual effort and a breakdown by status.',
          tags: ['Analytics'],
          parameters: [
            {
              name: 'project_id',
              in: 'query',
              description: 'Filter to a specific project',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          ],
          responses: {
            '200': jsonResponse('Effort summary', {
              type: 'object',
              properties: {
                total_estimated: {
                  type: 'integer',
                  description: 'Total estimated effort in minutes across all work items',
                  example: 4800,
                },
                total_actual: {
                  type: 'integer',
                  description: 'Total actual effort logged in minutes across all work items',
                  example: 4200,
                },
                by_status: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/EffortByStatus' },
                  description: 'Effort breakdown grouped by work item status',
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/analytics/burndown/{id}': {
        get: {
          operationId: 'getBurndown',
          summary: 'Get burndown data for a work item',
          description: 'Returns scope totals (total, completed, remaining) for child items of the given work item.',
          tags: ['Analytics'],
          parameters: [uuidParam('id', 'Parent work item ID')],
          responses: {
            '200': jsonResponse('Burndown data', { $ref: '#/components/schemas/BurndownResponse' }),
            ...errorResponses(401, 403, 404, 500),
          },
        },
      },
      '/api/analytics/overdue': {
        get: {
          operationId: 'getOverdueItems',
          summary: 'Get overdue items',
          description: 'Returns work items past their due date (not_after) that are not closed, done, or cancelled.',
          tags: ['Analytics'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of overdue items to return (max 100)',
              schema: { type: 'integer', default: 50, maximum: 100 },
              example: 50,
            },
          ],
          responses: {
            '200': jsonResponse('Overdue items', {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/OverdueItem' },
                  description: 'List of overdue work items ordered by how long they have been overdue',
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/analytics/blocked': {
        get: {
          operationId: 'getBlockedItems',
          summary: 'Get blocked items',
          description: 'Returns work items blocked by incomplete dependencies.',
          tags: ['Analytics'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of blocked items to return (max 100)',
              schema: { type: 'integer', default: 50, maximum: 100 },
              example: 50,
            },
          ],
          responses: {
            '200': jsonResponse('Blocked items', {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/BlockedItem' },
                  description: 'List of work items currently blocked by dependencies',
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/analytics/activity-summary': {
        get: {
          operationId: 'getActivitySummary',
          summary: 'Get activity summary by day',
          description: 'Returns daily activity counts grouped by activity type over a configurable number of days.',
          tags: ['Analytics'],
          parameters: [
            {
              name: 'days',
              in: 'query',
              description: 'Number of days to include in the summary (max 90)',
              schema: { type: 'integer', default: 30, maximum: 90 },
              example: 30,
            },
          ],
          responses: {
            '200': jsonResponse('Activity summary', {
              type: 'object',
              properties: {
                days: {
                  type: 'array',
                  description: 'Daily activity breakdown ordered chronologically',
                  items: {
                    type: 'object',
                    properties: {
                      day: {
                        type: 'string',
                        format: 'date',
                        description: 'ISO 8601 date for this activity day',
                        example: '2026-02-21',
                      },
                      created: {
                        type: 'integer',
                        description: 'Number of work items created on this day',
                        example: 5,
                      },
                      completed: {
                        type: 'integer',
                        description: 'Number of work items completed on this day',
                        example: 3,
                      },
                      updated: {
                        type: 'integer',
                        description: 'Number of work items updated on this day',
                        example: 10,
                      },
                      commented: {
                        type: 'integer',
                        description: 'Number of comments added on this day',
                        example: 7,
                      },
                    },
                  },
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
    },
  };
}
