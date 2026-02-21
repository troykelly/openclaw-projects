/**
 * OpenAPI path definitions for calendar endpoints.
 * Routes: POST /api/sync/calendar,
 *         GET /api/calendar/events/live, GET /api/calendar/events,
 *         POST /api/calendar/events, POST /api/calendar/events/from-work-item,
 *         DELETE /api/calendar/events/:id
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, uuidParam } from '../helpers.ts';

export function calendarPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Calendar', description: 'Calendar event management and provider sync' },
    ],
    schemas: {
      CalendarEvent: {
        type: 'object',
        required: ['id', 'user_email', 'provider', 'external_event_id', 'title', 'start_time', 'end_time', 'synced', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the calendar event',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          user_email: {
            type: 'string',
            description: 'Email address of the user who owns this calendar event',
            example: 'alice@example.com',
          },
          provider: {
            type: 'string',
            description: 'OAuth provider the event was synced from (e.g. google, microsoft)',
            example: 'google',
          },
          external_event_id: {
            type: 'string',
            description: 'Provider-specific event identifier used for sync reconciliation',
            example: 'google-event-abc123xyz',
          },
          title: {
            type: 'string',
            description: 'Title or summary of the calendar event',
            example: 'Sprint Planning Meeting',
          },
          description: {
            type: 'string',
            nullable: true,
            description: 'Detailed description or notes for the event',
            example: 'Discuss sprint goals and assign work items for the upcoming sprint.',
          },
          start_time: {
            type: 'string',
            format: 'date-time',
            description: 'Start date and time of the event in ISO 8601 format',
            example: '2026-02-21T10:00:00Z',
          },
          end_time: {
            type: 'string',
            format: 'date-time',
            description: 'End date and time of the event in ISO 8601 format',
            example: '2026-02-21T11:00:00Z',
          },
          location: {
            type: 'string',
            nullable: true,
            description: 'Physical or virtual location for the event',
            example: 'Conference Room B / https://meet.google.com/abc-defg-hij',
          },
          attendees: {
            type: 'array',
            description: 'List of event attendees',
            items: {
              type: 'object',
              properties: {
                email: {
                  type: 'string',
                  description: 'Email address of the attendee',
                  example: 'bob@example.com',
                },
                name: {
                  type: 'string',
                  description: 'Display name of the attendee',
                  example: 'Bob Johnson',
                },
              },
            },
          },
          work_item_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'UUID of a linked work item, if the event was created from a work item deadline',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          html_link: {
            type: 'string',
            nullable: true,
            description: 'URL to view the event in the provider calendar UI',
            example: 'https://calendar.google.com/calendar/event?eid=abc123',
          },
          synced: {
            type: 'boolean',
            description: 'Whether this event has been synced to or from the provider',
            example: true,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the event was created in the local database',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the event was last updated in the local database',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      CalendarSyncResult: {
        type: 'object',
        required: ['status', 'connection_id', 'provider', 'synced', 'created', 'updated'],
        properties: {
          status: {
            type: 'string',
            description: 'Overall status of the sync operation',
            example: 'completed',
          },
          connection_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the OAuth connection used for the sync',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          provider: {
            type: 'string',
            description: 'OAuth provider that was synced (google or microsoft)',
            example: 'google',
          },
          synced: {
            type: 'integer',
            description: 'Total number of events processed during sync',
            example: 25,
          },
          created: {
            type: 'integer',
            description: 'Number of new events created locally during sync',
            example: 10,
          },
          updated: {
            type: 'integer',
            description: 'Number of existing events updated locally during sync',
            example: 15,
          },
        },
      },
    },
    paths: {
      '/api/sync/calendar': {
        post: {
          operationId: 'syncCalendar',
          summary: 'Sync calendar events from provider',
          description: 'Pulls calendar events from the connected OAuth provider and stores them locally.',
          tags: ['Calendar'],
          requestBody: jsonBody({
            type: 'object',
            required: ['connection_id'],
            properties: {
              connection_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the OAuth connection to sync calendar events from',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              time_min: {
                type: 'string',
                format: 'date-time',
                description: 'Start of the time range to sync events from (ISO 8601)',
                example: '2026-02-01T00:00:00Z',
              },
              time_max: {
                type: 'string',
                format: 'date-time',
                description: 'End of the time range to sync events to (ISO 8601)',
                example: '2026-03-01T00:00:00Z',
              },
              max_results: {
                type: 'integer',
                description: 'Maximum number of events to sync from the provider',
                example: 100,
              },
            },
          }),
          responses: {
            '200': jsonResponse('Sync result', { $ref: '#/components/schemas/CalendarSyncResult' }),
            ...errorResponses(400, 401, 500, 502),
          },
        },
      },
      '/api/calendar/events/live': {
        get: {
          operationId: 'listLiveCalendarEvents',
          summary: 'List events directly from provider',
          description: 'Fetches calendar events live from the connected OAuth provider without local storage.',
          tags: ['Calendar'],
          parameters: [
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection to fetch live events from',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
            {
              name: 'time_min',
              in: 'query',
              description: 'Start of time range in ISO 8601 format',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-21T00:00:00Z',
            },
            {
              name: 'time_max',
              in: 'query',
              description: 'End of time range in ISO 8601 format',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-28T23:59:59Z',
            },
            {
              name: 'max_results',
              in: 'query',
              description: 'Maximum number of events to return from the provider',
              schema: { type: 'integer' },
              example: 50,
            },
            {
              name: 'page_token',
              in: 'query',
              description: 'Pagination token from a previous response to fetch the next page',
              schema: { type: 'string' },
              example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
            },
          ],
          responses: {
            '200': jsonResponse('Live calendar events', {
              type: 'object',
              properties: {
                events: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/CalendarEvent' },
                  description: 'List of calendar events fetched live from the provider',
                },
                provider: {
                  type: 'string',
                  description: 'OAuth provider the events were fetched from',
                  example: 'google',
                },
                next_page_token: {
                  type: 'string',
                  nullable: true,
                  description: 'Token to fetch the next page of results, or null if no more pages',
                  example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
                },
              },
            }),
            ...errorResponses(400, 401, 500, 502),
          },
        },
      },
      '/api/calendar/events': {
        get: {
          operationId: 'listCalendarEvents',
          summary: 'List locally stored calendar events',
          description: 'Returns calendar events stored in the local database, optionally filtered by user and time range.',
          tags: ['Calendar'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              description: 'Filter events by the owning user email address',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
            {
              name: 'start_after',
              in: 'query',
              description: 'Only return events starting after this ISO 8601 timestamp',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-21T00:00:00Z',
            },
            {
              name: 'end_before',
              in: 'query',
              description: 'Only return events ending before this ISO 8601 timestamp',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-28T23:59:59Z',
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of events to return',
              schema: { type: 'integer', default: 100, maximum: 500 },
              example: 100,
            },
          ],
          responses: {
            '200': jsonResponse('Calendar events', {
              type: 'object',
              properties: {
                events: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/CalendarEvent' },
                  description: 'List of locally stored calendar events',
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
        post: {
          operationId: 'createCalendarEvent',
          summary: 'Create a calendar event',
          description: 'Creates a calendar event. When connection_id is provided, also pushes the event to the provider.',
          tags: ['Calendar'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email', 'provider', 'title', 'start_time', 'end_time'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email address of the user creating the event',
                example: 'alice@example.com',
              },
              provider: {
                type: 'string',
                description: 'Calendar provider to associate this event with',
                example: 'google',
              },
              title: {
                type: 'string',
                description: 'Title or summary of the calendar event',
                example: 'Sprint Planning Meeting',
              },
              description: {
                type: 'string',
                description: 'Detailed description or notes for the event',
                example: 'Discuss sprint goals and assign work items for the upcoming sprint.',
              },
              start_time: {
                type: 'string',
                format: 'date-time',
                description: 'Start date and time in ISO 8601 format',
                example: '2026-02-21T10:00:00Z',
              },
              end_time: {
                type: 'string',
                format: 'date-time',
                description: 'End date and time in ISO 8601 format',
                example: '2026-02-21T11:00:00Z',
              },
              location: {
                type: 'string',
                description: 'Physical or virtual location for the event',
                example: 'Conference Room B',
              },
              attendees: {
                type: 'array',
                description: 'List of attendees to invite to the event',
                items: {
                  type: 'object',
                  properties: {
                    email: {
                      type: 'string',
                      description: 'Email address of the attendee',
                      example: 'bob@example.com',
                    },
                    name: {
                      type: 'string',
                      description: 'Display name of the attendee',
                      example: 'Bob Johnson',
                    },
                  },
                },
              },
              connection_id: {
                type: 'string',
                format: 'uuid',
                description: 'If provided, the event is also created on the provider via the OAuth connection',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              all_day: {
                type: 'boolean',
                description: 'Whether the event spans the entire day',
                example: false,
              },
            },
          }),
          responses: {
            '201': jsonResponse('Event created', {
              type: 'object',
              properties: {
                event: {
                  $ref: '#/components/schemas/CalendarEvent',
                  description: 'The newly created calendar event',
                },
              },
            }),
            ...errorResponses(400, 401, 500, 502),
          },
        },
      },
      '/api/calendar/events/from-work-item': {
        post: {
          operationId: 'createCalendarEventFromWorkItem',
          summary: 'Create calendar event from work item deadline',
          description: 'Creates a calendar event using the deadline (not_after) of a work item.',
          tags: ['Calendar'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email', 'provider', 'work_item_id'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email address of the user to create the event for',
                example: 'alice@example.com',
              },
              provider: {
                type: 'string',
                description: 'Calendar provider to create the event on',
                example: 'google',
              },
              work_item_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the work item whose deadline will be used for the event',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              reminder_minutes: {
                type: 'integer',
                description: 'Number of minutes before the deadline to set a reminder notification',
                example: 30,
              },
            },
          }),
          responses: {
            '201': jsonResponse('Event created from work item', {
              type: 'object',
              properties: {
                event: {
                  $ref: '#/components/schemas/CalendarEvent',
                  description: 'The newly created calendar event linked to the work item',
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/calendar/events/{id}': {
        delete: {
          operationId: 'deleteCalendarEvent',
          summary: 'Delete a calendar event',
          description: 'Deletes a calendar event locally. If connection_id is provided, also deletes from the provider.',
          tags: ['Calendar'],
          parameters: [
            uuidParam('id', 'Calendar event ID'),
            {
              name: 'connection_id',
              in: 'query',
              description: 'OAuth connection ID; if provided, the event is also deleted from the provider',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          ],
          responses: {
            '204': { description: 'Event deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
