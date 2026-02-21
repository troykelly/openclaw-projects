/**
 * OpenAPI path definitions for message threads and message linking.
 * Routes: GET /api/threads, GET /api/threads/{id}/history,
 *         POST /api/messages/{id}/link-contact
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, uuidParam, paginationParams, namespaceParam, errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

export function threadsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Threads', description: 'Conversation thread history and message linking' },
    ],
    schemas: {
      ThreadListResponse: {
        type: 'object',
        description: 'Paginated list of conversation threads',
        required: ['threads', 'total', 'limit', 'offset'],
        properties: {
          threads: {
            type: 'array',
            description: 'List of conversation threads',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Thread unique identifier',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                channel: {
                  type: 'string',
                  description: 'Communication channel for this thread (e.g. phone, email, whatsapp)',
                  example: 'phone',
                },
                contact_id: {
                  type: 'string',
                  format: 'uuid',
                  nullable: true,
                  description: 'ID of the linked contact, if any',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                contact_name: {
                  type: 'string',
                  nullable: true,
                  description: 'Display name of the linked contact',
                  example: 'Bob Smith',
                },
                last_message_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp of the most recent message in this thread',
                  example: '2026-02-21T14:30:00Z',
                },
                message_count: {
                  type: 'integer',
                  description: 'Total number of messages in this thread',
                  example: 15,
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp when the thread was created',
                  example: '2026-02-20T10:00:00Z',
                },
              },
            },
          },
          total: {
            type: 'integer',
            description: 'Total number of threads matching the filter',
            example: 42,
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of threads returned per page',
            example: 50,
          },
          offset: {
            type: 'integer',
            description: 'Number of threads skipped',
            example: 0,
          },
        },
      },
      ThreadHistoryResponse: {
        type: 'object',
        description: 'Thread conversation history with messages, related work items, and contact memories',
        required: ['thread_id', 'messages'],
        properties: {
          thread_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the thread',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          messages: {
            type: 'array',
            description: 'List of messages in chronological order',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Message unique identifier',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                direction: {
                  type: 'string',
                  enum: ['inbound', 'outbound'],
                  description: 'Whether the message was received or sent',
                  example: 'inbound',
                },
                body: {
                  type: 'string',
                  description: 'Message body text',
                  example: 'Hey, can you check on the renovation progress?',
                },
                from_address: {
                  type: 'string',
                  nullable: true,
                  description: 'Sender address (phone number, email, etc.)',
                  example: '+61400000000',
                },
                to_address: {
                  type: 'string',
                  nullable: true,
                  description: 'Recipient address',
                  example: '+61400000001',
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp when the message was sent or received',
                  example: '2026-02-21T14:30:00Z',
                },
              },
            },
          },
          work_items: {
            type: 'array',
            description: 'Work items related to messages in this thread',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Work item ID',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                title: {
                  type: 'string',
                  description: 'Work item title',
                  example: 'Check renovation progress',
                },
              },
            },
          },
          contact_memories: {
            type: 'array',
            description: 'Memories associated with the thread contact',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Memory unique identifier',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                content: {
                  type: 'string',
                  description: 'Memory content text',
                  example: 'Contact prefers to be called in the morning',
                },
              },
            },
          },
          has_more: {
            type: 'boolean',
            description: 'Whether there are more messages beyond the returned set',
            example: true,
          },
        },
      },
      LinkContactRequest: {
        type: 'object',
        required: ['contact_id'],
        properties: {
          contact_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the contact to link to the message sender',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
        },
      },
      LinkContactResponse: {
        type: 'object',
        required: ['message_id', 'contact_id', 'linked'],
        properties: {
          message_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the linked message',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          contact_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the linked contact',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          from_address: {
            type: 'string',
            nullable: true,
            description: 'The sender address that was linked to the contact',
            example: '+61400000000',
          },
          linked: {
            type: 'boolean',
            description: 'Whether the link was successfully created',
            example: true,
          },
        },
      },
    },
    paths: {
      '/api/threads': {
        get: {
          operationId: 'listThreads',
          summary: 'List conversation threads',
          description: 'Returns a paginated list of conversation threads. Can be filtered by channel or contact.',
          tags: ['Threads'],
          parameters: [
            namespaceParam(),
            ...paginationParams(),
            {
              name: 'channel',
              in: 'query',
              description: 'Filter by communication channel (e.g. "phone", "email", "whatsapp")',
              example: 'phone',
              schema: { type: 'string' },
            },
            {
              name: 'contact_id',
              in: 'query',
              description: 'Filter threads by associated contact ID',
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': jsonResponse('List of threads', ref('ThreadListResponse')),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/threads/{id}/history': {
        get: {
          operationId: 'getThreadHistory',
          summary: 'Get thread conversation history',
          description: 'Returns the message history for a specific thread, including related work items and contact memories. Supports cursor-based pagination with before/after timestamps.',
          tags: ['Threads'],
          parameters: [
            uuidParam('id', 'Thread UUID'),
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of messages to return (default 50, max 200)',
              example: 50,
              schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
            },
            {
              name: 'before',
              in: 'query',
              description: 'Get messages before this timestamp (ISO 8601)',
              example: '2026-02-21T14:30:00Z',
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'after',
              in: 'query',
              description: 'Get messages after this timestamp (ISO 8601)',
              example: '2026-02-20T00:00:00Z',
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'include_work_items',
              in: 'query',
              description: 'Include related work items in the response (default true)',
              example: 'true',
              schema: { type: 'string', enum: ['true', 'false'], default: 'true' },
            },
            {
              name: 'include_memories',
              in: 'query',
              description: 'Include contact memories in the response (default true)',
              example: 'true',
              schema: { type: 'string', enum: ['true', 'false'], default: 'true' },
            },
          ],
          responses: {
            '200': jsonResponse('Thread history', ref('ThreadHistoryResponse')),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/api/messages/{id}/link-contact': {
        post: {
          operationId: 'linkMessageToContact',
          summary: 'Link message sender to contact',
          description: 'Links an inbound message sender to an existing contact. Creates a contact endpoint for the sender address if the sender has a known address and channel.',
          tags: ['Threads'],
          parameters: [uuidParam('id', 'Message UUID')],
          requestBody: jsonBody(ref('LinkContactRequest')),
          responses: {
            '200': jsonResponse('Contact linked successfully', ref('LinkContactResponse')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
