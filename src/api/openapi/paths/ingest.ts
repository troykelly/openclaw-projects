/**
 * OpenAPI path definitions for the message ingestion endpoint.
 * Routes: POST /api/ingest/external-message
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

export function ingestPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Ingest', description: 'Message ingestion pipeline for external communications' },
    ],
    schemas: {
      IngestResult: {
        type: 'object',
        required: ['contact_id', 'endpoint_id', 'thread_id', 'message_id'],
        properties: {
          contact_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the contact record that was created or matched',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          endpoint_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the contact endpoint record (phone, email, etc.)',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          thread_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the external message thread that was created or matched',
            example: 'b2c3d4e5-6789-01ab-cdef-2345678901bc',
          },
          message_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the newly created external message record',
            example: 'c3d4e5f6-7890-12ab-cdef-3456789012cd',
          },
        },
      },
    },
    paths: {
      '/api/ingest/external-message': {
        post: {
          operationId: 'ingestExternalMessage',
          summary: 'Ingest an external message',
          description: 'Atomically creates or reuses a contact, endpoint, thread, and message. Uses ON CONFLICT for idempotency on thread key and message key.',
          tags: ['Ingest'],
          requestBody: jsonBody({
            type: 'object',
            required: ['endpoint_type', 'endpoint_value', 'external_thread_key', 'external_message_key', 'direction'],
            properties: {
              contact_display_name: {
                type: 'string',
                description: 'Display name for auto-created contact (default: "Unknown")',
                example: 'Alice Smith',
              },
              endpoint_type: {
                type: 'string',
                description: 'Contact endpoint type (e.g. sms, email, telegram)',
                example: 'sms',
              },
              endpoint_value: {
                type: 'string',
                description: 'Contact endpoint value (e.g. phone number, email address)',
                example: '+14155551234',
              },
              external_thread_key: {
                type: 'string',
                description: 'External thread identifier for grouping messages',
                example: 'twilio-thread-abc123',
              },
              external_message_key: {
                type: 'string',
                description: 'External message identifier for idempotency',
                example: 'SM1234567890abcdef1234567890abcdef',
              },
              direction: {
                type: 'string',
                enum: ['inbound', 'outbound'],
                description: 'Message direction relative to the system',
                example: 'inbound',
              },
              message_body: {
                type: 'string',
                nullable: true,
                description: 'Message body text content',
                example: 'Hi, I need help with my project deadline.',
              },
              raw: {
                type: 'object',
                description: 'Raw message payload from the external provider (stored as JSONB)',
                properties: {
                  provider: {
                    type: 'string',
                    description: 'Name of the external messaging provider',
                    example: 'twilio',
                  },
                  sid: {
                    type: 'string',
                    description: 'Provider-specific message identifier',
                    example: 'SM1234567890abcdef1234567890abcdef',
                  },
                  from: {
                    type: 'string',
                    description: 'Sender address from the provider',
                    example: '+14155551234',
                  },
                  to: {
                    type: 'string',
                    description: 'Recipient address from the provider',
                    example: '+14155559876',
                  },
                  body: {
                    type: 'string',
                    description: 'Raw message body from the provider',
                    example: 'Hi, I need help with my project deadline.',
                  },
                },
                additionalProperties: true,
              },
              received_at: {
                type: 'string',
                format: 'date-time',
                description: 'When the message was received externally (defaults to now)',
                example: '2026-02-21T14:30:00Z',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Ingested message identifiers', { $ref: '#/components/schemas/IngestResult' }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
    },
  };
}
