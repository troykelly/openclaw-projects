/**
 * OpenAPI path definitions for voice conversation endpoints.
 * Routes: GET /api/voice/config, PUT /api/voice/config,
 *         GET /api/voice/conversations, GET /api/voice/conversations/:id,
 *         DELETE /api/voice/conversations/:id
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, uuidParam } from '../helpers.ts';

export function voicePaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Voice', description: 'Voice conversation configuration, history, and WebSocket management' },
    ],
    schemas: {
      VoiceConfig: {
        type: 'object',
        required: ['id', 'namespace', 'timeout_ms', 'idle_timeout_s', 'retention_days', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the voice configuration record',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          namespace: {
            type: 'string',
            description: 'Namespace this voice configuration belongs to',
            example: 'default',
          },
          timeout_ms: {
            type: 'integer',
            description: 'WebSocket connection timeout in milliseconds (1-120000)',
            example: 30000,
          },
          idle_timeout_s: {
            type: 'integer',
            description: 'Idle timeout before closing connection in seconds (1-86400)',
            example: 300,
          },
          retention_days: {
            type: 'integer',
            description: 'Number of days to retain conversation history (1-365)',
            example: 30,
          },
          service_allowlist: {
            type: 'array',
            items: { type: 'string' },
            description: 'Allowed service names for voice routing',
            example: ['openai-realtime', 'whisper-streaming'],
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the configuration was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the configuration was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      VoiceConversation: {
        type: 'object',
        required: ['id', 'namespace', 'status', 'message_count', 'last_active_at', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the voice conversation',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          namespace: {
            type: 'string',
            description: 'Namespace this conversation belongs to',
            example: 'default',
          },
          user_email: {
            type: 'string',
            nullable: true,
            description: 'Email of the user who initiated the conversation',
            example: 'alice@example.com',
          },
          status: {
            type: 'string',
            description: 'Current status of the conversation (e.g. active, ended, error)',
            example: 'active',
          },
          message_count: {
            type: 'integer',
            description: 'Total number of messages in the conversation',
            example: 12,
          },
          last_active_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp of the most recent activity in the conversation',
            example: '2026-02-21T14:35:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the conversation was started',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the conversation record was last updated',
            example: '2026-02-21T14:35:00Z',
          },
        },
      },
      VoiceMessage: {
        type: 'object',
        required: ['id', 'conversation_id', 'role', 'content', 'timestamp'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the voice message',
            example: 'b2c3d4e5-6789-01ab-cdef-2345678901bc',
          },
          conversation_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the parent voice conversation',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          role: {
            type: 'string',
            enum: ['user', 'assistant', 'system'],
            description: 'Role of the message sender in the conversation',
            example: 'user',
          },
          content: {
            type: 'string',
            description: 'Transcribed text content of the voice message',
            example: 'What is the status of my project?',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the message was recorded',
            example: '2026-02-21T14:31:00Z',
          },
        },
      },
    },
    paths: {
      '/api/voice/config': {
        get: {
          operationId: 'getVoiceConfig',
          summary: 'Get voice routing configuration',
          description: 'Returns the voice routing configuration for the current namespace.',
          tags: ['Voice'],
          responses: {
            '200': jsonResponse('Voice config', {
              type: 'object',
              properties: {
                data: {
                  $ref: '#/components/schemas/VoiceConfig',
                  nullable: true,
                  description: 'Voice configuration for the current namespace, or null if not configured',
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
        put: {
          operationId: 'updateVoiceConfig',
          summary: 'Update voice routing configuration',
          description: 'Creates or updates the voice routing configuration for the current namespace. Requires admin role.',
          tags: ['Voice'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              timeout_ms: {
                type: 'integer',
                minimum: 1,
                maximum: 120000,
                description: 'WebSocket connection timeout in milliseconds',
                example: 30000,
              },
              idle_timeout_s: {
                type: 'integer',
                minimum: 1,
                maximum: 86400,
                description: 'Idle timeout before closing connection in seconds',
                example: 300,
              },
              retention_days: {
                type: 'integer',
                minimum: 1,
                maximum: 365,
                description: 'Number of days to retain conversation history',
                example: 30,
              },
              service_allowlist: {
                type: 'array',
                items: { type: 'string' },
                description: 'Allowed service names for voice routing',
                example: ['openai-realtime', 'whisper-streaming'],
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated config', {
              type: 'object',
              properties: {
                data: {
                  $ref: '#/components/schemas/VoiceConfig',
                  description: 'The updated voice configuration',
                },
              },
            }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
      '/api/voice/conversations': {
        get: {
          operationId: 'listVoiceConversations',
          summary: 'List voice conversations',
          description: 'Returns recent voice conversations for the current namespace, ordered by last activity.',
          tags: ['Voice'],
          parameters: [
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Voice conversations', {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/VoiceConversation' },
                  description: 'List of voice conversations',
                },
                total: {
                  type: 'integer',
                  description: 'Total number of conversations matching the query',
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
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/voice/conversations/{id}': {
        get: {
          operationId: 'getVoiceConversation',
          summary: 'Get a voice conversation with messages',
          description: 'Returns a voice conversation and all its messages, ordered by timestamp.',
          tags: ['Voice'],
          parameters: [uuidParam('id', 'Conversation ID')],
          responses: {
            '200': jsonResponse('Conversation with messages', {
              type: 'object',
              properties: {
                data: {
                  type: 'object',
                  description: 'Voice conversation with embedded message history',
                  allOf: [
                    { $ref: '#/components/schemas/VoiceConversation' },
                    {
                      type: 'object',
                      properties: {
                        messages: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/VoiceMessage' },
                          description: 'All messages in the conversation ordered by timestamp',
                        },
                      },
                    },
                  ],
                },
              },
            }),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteVoiceConversation',
          summary: 'Delete a voice conversation',
          description: 'Deletes a voice conversation and its messages. Requires member role.',
          tags: ['Voice'],
          parameters: [uuidParam('id', 'Conversation ID')],
          responses: {
            '204': { description: 'Conversation deleted' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
    },
  };
}
