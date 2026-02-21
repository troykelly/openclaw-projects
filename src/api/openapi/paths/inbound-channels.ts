/**
 * OpenAPI path definitions for inbound destination and channel default endpoints.
 * Routes: GET /api/inbound-destinations, GET /api/inbound-destinations/:id,
 *         PUT /api/inbound-destinations/:id, DELETE /api/inbound-destinations/:id,
 *         GET /api/channel-defaults, GET /api/channel-defaults/:channelType,
 *         PUT /api/channel-defaults/:channelType
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, searchParam, uuidParam } from '../helpers.ts';

export function inboundChannelsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'InboundDestinations', description: 'Inbound message destination routing with per-destination overrides' },
      { name: 'ChannelDefaults', description: 'Default agent, prompt template, and context for each channel type' },
    ],
    schemas: {
      InboundDestination: {
        type: 'object',
        required: ['id', 'channel_type', 'destination_value', 'is_active', 'namespace', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the inbound destination',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          channel_type: {
            type: 'string',
            description: 'Communication channel type (e.g. sms, email, ha_observation)',
            example: 'sms',
          },
          destination_value: {
            type: 'string',
            description: 'The actual destination identifier (phone number, email address, etc.)',
            example: '+14155551234',
          },
          display_name: {
            type: 'string',
            nullable: true,
            description: 'Human-readable display name for this destination',
            example: 'Main Office SMS Line',
          },
          agent_id: {
            type: 'string',
            nullable: true,
            description: 'Override agent ID for messages to this destination',
            example: 'agent-assistant-v2',
          },
          prompt_template_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Override prompt template UUID for this destination',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          context_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Override context UUID for this destination',
            example: 'b2c3d4e5-6789-01ab-cdef-2345678901bc',
          },
          is_active: {
            type: 'boolean',
            description: 'Whether this destination is currently active and receiving messages',
            example: true,
          },
          namespace: {
            type: 'string',
            description: 'Namespace this destination belongs to',
            example: 'default',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the destination was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the destination was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      ChannelDefault: {
        type: 'object',
        required: ['id', 'namespace', 'channel_type', 'agent_id', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the channel default record',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          namespace: {
            type: 'string',
            description: 'Namespace this channel default belongs to',
            example: 'default',
          },
          channel_type: {
            type: 'string',
            enum: ['sms', 'email', 'ha_observation'],
            description: 'Communication channel type this default applies to',
            example: 'sms',
          },
          agent_id: {
            type: 'string',
            description: 'Default agent ID used for messages on this channel',
            example: 'agent-assistant-v2',
          },
          prompt_template_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Default prompt template UUID for this channel',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          context_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Default context UUID for this channel',
            example: 'b2c3d4e5-6789-01ab-cdef-2345678901bc',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the channel default was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the channel default was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
    },
    paths: {
      '/api/inbound-destinations': {
        get: {
          operationId: 'listInboundDestinations',
          summary: 'List inbound destinations',
          description: 'Returns inbound message destinations with optional filtering by channel type and search.',
          tags: ['InboundDestinations'],
          parameters: [
            {
              name: 'channel_type',
              in: 'query',
              description: 'Filter by communication channel type',
              schema: { type: 'string' },
              example: 'sms',
            },
            searchParam('Search by destination value or display name'),
            {
              name: 'include_inactive',
              in: 'query',
              description: 'Include inactive destinations in the results',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Inbound destinations', {
              type: 'object',
              properties: {
                total: {
                  type: 'integer',
                  description: 'Total number of destinations matching the query',
                  example: 42,
                },
                limit: {
                  type: 'integer',
                  description: 'Maximum number of results returned',
                  example: 50,
                },
                offset: {
                  type: 'integer',
                  description: 'Number of results skipped',
                  example: 0,
                },
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/InboundDestination' },
                  description: 'List of inbound destinations',
                },
              },
            }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
      '/api/inbound-destinations/{id}': {
        get: {
          operationId: 'getInboundDestination',
          summary: 'Get an inbound destination',
          description: 'Returns a single inbound destination by ID.',
          tags: ['InboundDestinations'],
          parameters: [uuidParam('id', 'Inbound destination ID')],
          responses: {
            '200': jsonResponse('Inbound destination', { $ref: '#/components/schemas/InboundDestination' }),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        put: {
          operationId: 'updateInboundDestination',
          summary: 'Update inbound destination routing',
          description: 'Updates display name, agent, prompt template, context, or active status for a destination.',
          tags: ['InboundDestinations'],
          parameters: [uuidParam('id', 'Inbound destination ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              display_name: {
                type: 'string',
                description: 'Human-readable display name for this destination',
                example: 'Main Office SMS Line',
              },
              agent_id: {
                type: 'string',
                nullable: true,
                description: 'Override agent ID for messages to this destination (null to use channel default)',
                example: 'agent-assistant-v2',
              },
              prompt_template_id: {
                type: 'string',
                format: 'uuid',
                nullable: true,
                description: 'Override prompt template UUID (null to use channel default)',
                example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
              },
              context_id: {
                type: 'string',
                format: 'uuid',
                nullable: true,
                description: 'Override context UUID (null to use channel default)',
                example: 'b2c3d4e5-6789-01ab-cdef-2345678901bc',
              },
              is_active: {
                type: 'boolean',
                description: 'Whether this destination should be active and receiving messages',
                example: true,
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated destination', { $ref: '#/components/schemas/InboundDestination' }),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteInboundDestination',
          summary: 'Soft-delete an inbound destination',
          description: 'Soft-deletes an inbound destination by setting is_active to false.',
          tags: ['InboundDestinations'],
          parameters: [uuidParam('id', 'Inbound destination ID')],
          responses: {
            '204': { description: 'Destination deleted' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
      '/api/channel-defaults': {
        get: {
          operationId: 'listChannelDefaults',
          summary: 'List all channel defaults',
          description: 'Returns default routing configuration for all channel types.',
          tags: ['ChannelDefaults'],
          responses: {
            '200': jsonResponse('Channel defaults', {
              type: 'object',
              properties: {
                defaults: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ChannelDefault' },
                  description: 'List of channel default configurations',
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/channel-defaults/{channelType}': {
        get: {
          operationId: 'getChannelDefault',
          summary: 'Get default for a channel type',
          description: 'Returns the default agent, prompt template, and context for a specific channel type.',
          tags: ['ChannelDefaults'],
          parameters: [
            {
              name: 'channelType',
              in: 'path',
              required: true,
              description: 'Communication channel type to retrieve defaults for',
              schema: { type: 'string', enum: ['sms', 'email', 'ha_observation'] },
              example: 'sms',
            },
          ],
          responses: {
            '200': jsonResponse('Channel default', { $ref: '#/components/schemas/ChannelDefault' }),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        put: {
          operationId: 'setChannelDefault',
          summary: 'Set or update a channel default',
          description: 'Creates or updates the default routing configuration for a channel type. Agent ID is required.',
          tags: ['ChannelDefaults'],
          parameters: [
            {
              name: 'channelType',
              in: 'path',
              required: true,
              description: 'Communication channel type to set defaults for',
              schema: { type: 'string', enum: ['sms', 'email', 'ha_observation'] },
              example: 'sms',
            },
          ],
          requestBody: jsonBody({
            type: 'object',
            required: ['agent_id'],
            properties: {
              agent_id: {
                type: 'string',
                description: 'Default agent ID to handle messages for this channel',
                example: 'agent-assistant-v2',
              },
              prompt_template_id: {
                type: 'string',
                format: 'uuid',
                nullable: true,
                description: 'Default prompt template UUID for this channel',
                example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
              },
              context_id: {
                type: 'string',
                format: 'uuid',
                nullable: true,
                description: 'Default context UUID for this channel',
                example: 'b2c3d4e5-6789-01ab-cdef-2345678901bc',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Channel default set', { $ref: '#/components/schemas/ChannelDefault' }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
    },
  };
}
