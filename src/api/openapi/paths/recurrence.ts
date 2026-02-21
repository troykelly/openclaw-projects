/**
 * OpenAPI path definitions for recurrence management.
 * Routes: GET/PUT/DELETE /api/work-items/{id}/recurrence,
 *         GET /api/work-items/{id}/instances,
 *         GET /api/recurrence/templates, POST /api/recurrence/generate
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, uuidParam, errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

export function recurrencePaths(): OpenApiDomainModule {
  const workItemIdParam = uuidParam('id', 'Work item UUID');

  return {
    tags: [
      { name: 'Recurrence', description: 'Recurring work item management with RRULE support' },
    ],

    schemas: {
      RecurrenceInfo: {
        type: 'object',
        required: ['is_template'],
        properties: {
          rule: { type: 'string', nullable: true, description: 'RFC 5545 RRULE string defining the recurrence pattern', example: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
          rule_description: { type: 'string', nullable: true, description: 'Human-readable description of the recurrence rule', example: 'Every Monday, Wednesday, and Friday' },
          end: { type: 'string', format: 'date-time', nullable: true, description: 'Date-time when recurrence stops generating new instances', example: '2026-12-31T23:59:59Z' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent template work item (for generated instances)', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          is_template: { type: 'boolean', description: 'Whether this work item is a recurrence template that generates instances', example: true },
          next_occurrence: { type: 'string', format: 'date-time', nullable: true, description: 'Next scheduled date-time for instance generation', example: '2026-02-24T09:00:00Z' },
        },
      },
      RecurrenceUpdate: {
        type: 'object',
        properties: {
          recurrence_rule: { type: 'string', description: 'RFC 5545 RRULE string defining the recurrence pattern', example: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
          recurrence_natural: { type: 'string', description: 'Natural language recurrence description (alternative to RRULE)', example: 'every weekday' },
          recurrence_end: { type: 'string', format: 'date-time', nullable: true, description: 'Date-time when recurrence should stop generating new instances', example: '2026-12-31T23:59:59Z' },
        },
      },
      RecurrenceUpdateResponse: {
        type: 'object',
        required: ['success'],
        properties: {
          success: { type: 'boolean', description: 'Whether the recurrence update succeeded', example: true },
          recurrence: {
            type: 'object',
            nullable: true,
            description: 'Updated recurrence details, or null if recurrence was removed',
            properties: {
              rule: { type: 'string', nullable: true, description: 'RFC 5545 RRULE string', example: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
              rule_description: { type: 'string', nullable: true, description: 'Human-readable description of the rule', example: 'Every Monday, Wednesday, and Friday' },
              end: { type: 'string', format: 'date-time', nullable: true, description: 'When recurrence stops', example: '2026-12-31T23:59:59Z' },
              next_occurrence: { type: 'string', format: 'date-time', nullable: true, description: 'Next scheduled occurrence', example: '2026-02-24T09:00:00Z' },
            },
          },
        },
      },
      RecurrenceInstance: {
        type: 'object',
        description: 'A generated instance of a recurring work item',
        required: ['id', 'title', 'status', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'UUID of the generated instance work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Title of the generated instance (derived from template)', example: 'Weekly standup - 2026-02-24' },
          status: { type: 'string', description: 'Current status of the instance', example: 'open' },
          created_at: { type: 'string', format: 'date-time', description: 'When the instance was generated', example: '2026-02-21T00:00:00Z' },
        },
      },
      RecurrenceTemplate: {
        type: 'object',
        description: 'A work item that serves as a recurrence template for generating instances',
        required: ['id', 'title', 'recurrence_rule', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'UUID of the template work item', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          title: { type: 'string', description: 'Title of the template work item', example: 'Weekly standup' },
          recurrence_rule: { type: 'string', description: 'RFC 5545 RRULE string defining the recurrence pattern', example: 'FREQ=WEEKLY;BYDAY=MO' },
          recurrence_end: { type: 'string', format: 'date-time', nullable: true, description: 'When recurrence stops generating new instances', example: '2026-12-31T23:59:59Z' },
          created_at: { type: 'string', format: 'date-time', description: 'When the template was created', example: '2026-01-15T10:00:00Z' },
        },
      },
      GenerateRequest: {
        type: 'object',
        properties: {
          days_ahead: {
            type: 'integer',
            default: 14,
            description: 'Number of days ahead to generate instances for (default: 14)',
            example: 14,
          },
        },
      },
      GenerateResponse: {
        type: 'object',
        required: ['success', 'generated'],
        properties: {
          success: { type: 'boolean', description: 'Whether generation completed successfully', example: true },
          generated: { type: 'integer', description: 'Total number of instances generated across all templates', example: 7 },
          errors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Any errors encountered during generation (per-template)',
            example: ['Template a1b2c3d4: invalid RRULE'],
          },
        },
      },
    },

    paths: {
      '/api/work-items/{id}/recurrence': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'getWorkItemRecurrence',
          summary: 'Get recurrence info for a work item',
          description: 'Returns the recurrence rule, description, end date, and next occurrence for a work item.',
          tags: ['Recurrence'],
          responses: {
            '200': jsonResponse('Recurrence info', ref('RecurrenceInfo')),
            ...errorResponses(401, 404, 500),
          },
        },
        put: {
          operationId: 'updateWorkItemRecurrence',
          summary: 'Update recurrence rule',
          description: 'Updates the recurrence rule for a work item. Accepts either an RRULE string or natural language description.',
          tags: ['Recurrence'],
          requestBody: jsonBody(ref('RecurrenceUpdate')),
          responses: {
            '200': jsonResponse('Updated recurrence', ref('RecurrenceUpdateResponse')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'stopWorkItemRecurrence',
          summary: 'Stop recurrence',
          description: 'Removes the recurrence rule from a work item, stopping future instance generation.',
          tags: ['Recurrence'],
          responses: {
            '200': jsonResponse('Recurrence stopped', ref('SuccessMessage')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/instances': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listRecurrenceInstances',
          summary: 'List generated recurrence instances',
          description: 'Returns instances generated from a recurring work item template.',
          tags: ['Recurrence'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of instances to return',
              schema: { type: 'integer' },
              example: 20,
            },
            {
              name: 'include_completed',
              in: 'query',
              description: 'Include completed instances in results (default: true)',
              schema: { type: 'string', enum: ['true', 'false'], default: 'true' },
              example: 'true',
            },
          ],
          responses: {
            '200': jsonResponse('Instances', {
              type: 'object',
              required: ['instances', 'count'],
              properties: {
                instances: { type: 'array', description: 'Array of generated recurrence instances', items: ref('RecurrenceInstance') },
                count: { type: 'integer', description: 'Total number of instances returned', example: 5 },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/recurrence/templates': {
        get: {
          operationId: 'listRecurrenceTemplates',
          summary: 'List all recurrence templates',
          description: 'Returns all work items that serve as recurrence templates.',
          tags: ['Recurrence'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of templates to return',
              schema: { type: 'integer' },
              example: 20,
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of templates to skip for pagination',
              schema: { type: 'integer' },
              example: 0,
            },
          ],
          responses: {
            '200': jsonResponse('Templates', {
              type: 'object',
              required: ['templates', 'count'],
              properties: {
                templates: { type: 'array', description: 'Array of recurrence template work items', items: ref('RecurrenceTemplate') },
                count: { type: 'integer', description: 'Total number of templates returned', example: 3 },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },

      '/api/recurrence/generate': {
        post: {
          operationId: 'generateRecurrenceInstances',
          summary: 'Generate upcoming recurrence instances',
          description: 'Triggers generation of upcoming instances for all recurrence templates within the specified look-ahead window.',
          tags: ['Recurrence'],
          requestBody: jsonBody(ref('GenerateRequest'), false),
          responses: {
            '200': jsonResponse('Generation result', ref('GenerateResponse')),
            ...errorResponses(400, 401, 500),
          },
        },
      },
    },
  };
}
