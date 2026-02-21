/**
 * OpenAPI path definitions for agent identity endpoints.
 * Routes: GET /api/identity, PUT /api/identity, PATCH /api/identity,
 *         POST /api/identity/proposals, POST /api/identity/proposals/:id/approve,
 *         POST /api/identity/proposals/:id/reject,
 *         GET /api/identity/history, POST /api/identity/rollback
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, uuidParam } from '../helpers.ts';

export function identityPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Identity', description: 'Agent identity management with versioned history, proposals, and rollback' },
    ],
    schemas: {
      AgentIdentity: {
        type: 'object',
        required: ['id', 'name', 'display_name', 'persona', 'is_active', 'version', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the agent identity',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          name: {
            type: 'string',
            description: 'Machine-readable name used to identify the agent (unique per namespace)',
            example: 'assistant',
          },
          display_name: {
            type: 'string',
            description: 'Human-readable display name shown in the UI and communications',
            example: 'Atlas',
          },
          emoji: {
            type: 'string',
            nullable: true,
            description: 'Emoji avatar for the agent identity',
            example: '🤖',
          },
          avatar_s3_key: {
            type: 'string',
            nullable: true,
            description: 'S3 object key for the agent avatar image',
            example: 'avatars/assistant-v3.png',
          },
          persona: {
            type: 'string',
            description: 'System prompt persona description that defines the agent personality and behavior',
            example: 'You are Atlas, a friendly and knowledgeable assistant who helps with project management and daily tasks.',
          },
          principles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Core principles the agent should follow in all interactions',
            example: ['Be honest and transparent', 'Prioritize user privacy', 'Ask for clarification when uncertain'],
          },
          quirks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Personality quirks that make the agent distinctive',
            example: ['Uses Australian slang occasionally', 'Enjoys puns about technology'],
          },
          voice_config: {
            type: 'object',
            nullable: true,
            description: 'Voice synthesis configuration for the agent',
            properties: {
              provider: {
                type: 'string',
                description: 'Voice provider name',
                example: 'elevenlabs',
              },
              voice_id: {
                type: 'string',
                description: 'Voice identifier in the provider system',
                example: 'pNInz6obpgDQGcFmaJgB',
              },
              speed: {
                type: 'number',
                description: 'Speech speed multiplier (1.0 = normal)',
                example: 1.0,
              },
              pitch: {
                type: 'number',
                description: 'Voice pitch adjustment',
                example: 0.0,
              },
            },
          },
          is_active: {
            type: 'boolean',
            description: 'Whether this identity is currently active and being used',
            example: true,
          },
          version: {
            type: 'integer',
            description: 'Version number, incremented on each update',
            example: 3,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the identity was first created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the identity was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      IdentityHistoryEntry: {
        type: 'object',
        required: ['id', 'identity_id', 'version', 'changed_by', 'change_type', 'created_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for this history entry',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          identity_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the identity this history entry belongs to',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          version: {
            type: 'integer',
            description: 'Version number at the time of this change',
            example: 3,
          },
          changed_by: {
            type: 'string',
            description: 'Identifier of who made the change (email or agent:name)',
            example: 'alice@example.com',
          },
          change_type: {
            type: 'string',
            enum: ['create', 'update', 'propose', 'approve', 'reject', 'rollback'],
            description: 'Type of change that was made',
            example: 'update',
          },
          change_reason: {
            type: 'string',
            nullable: true,
            description: 'Optional reason explaining why the change was made',
            example: 'Updated persona to be more helpful with cooking questions',
          },
          field_changed: {
            type: 'string',
            nullable: true,
            description: 'Name of the field that was changed (for single-field updates)',
            example: 'persona',
          },
          previous_value: {
            type: 'string',
            nullable: true,
            description: 'Previous value of the changed field (JSON-encoded for complex types)',
            example: 'You are a helpful assistant.',
          },
          new_value: {
            type: 'string',
            nullable: true,
            description: 'New value of the changed field (JSON-encoded for complex types)',
            example: 'You are Atlas, a friendly and knowledgeable assistant.',
          },
          full_snapshot: {
            type: 'object',
            description: 'Complete snapshot of the identity at this version for rollback support',
            properties: {
              name: {
                type: 'string',
                description: 'Identity name at this version',
                example: 'assistant',
              },
              display_name: {
                type: 'string',
                description: 'Display name at this version',
                example: 'Atlas',
              },
              persona: {
                type: 'string',
                description: 'Persona text at this version',
                example: 'You are Atlas, a friendly and knowledgeable assistant.',
              },
              principles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Principles at this version',
                example: ['Be honest'],
              },
              quirks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Quirks at this version',
                example: ['Enjoys puns'],
              },
            },
          },
          approved_by: {
            type: 'string',
            nullable: true,
            description: 'Email of the user who approved this proposal (for approve change_type)',
            example: 'alice@example.com',
          },
          approved_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the proposal was approved',
            example: '2026-02-21T15:00:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the history entry was created',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
    },
    paths: {
      '/api/identity': {
        get: {
          operationId: 'getIdentity',
          summary: 'Get the active agent identity',
          description: 'Returns the active agent identity. Optionally filter by name query parameter.',
          tags: ['Identity'],
          parameters: [
            {
              name: 'name',
              in: 'query',
              description: 'Identity name to look up',
              example: 'assistant',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': jsonResponse('Agent identity', { $ref: '#/components/schemas/AgentIdentity' }),
            ...errorResponses(401, 404, 500),
          },
        },
        put: {
          operationId: 'upsertIdentity',
          summary: 'Create or replace an identity',
          description: 'Creates a new identity or fully replaces an existing one (upsert by name). Increments version and records history.',
          tags: ['Identity'],
          requestBody: jsonBody({
            type: 'object',
            required: ['name'],
            properties: {
              name: {
                type: 'string',
                description: 'Machine-readable identity name (unique per namespace)',
                example: 'assistant',
              },
              display_name: {
                type: 'string',
                description: 'Human-readable display name',
                example: 'Atlas',
              },
              emoji: {
                type: 'string',
                nullable: true,
                description: 'Emoji avatar',
                example: '🤖',
              },
              avatar_s3_key: {
                type: 'string',
                nullable: true,
                description: 'S3 object key for avatar image',
                example: 'avatars/assistant-v3.png',
              },
              persona: {
                type: 'string',
                description: 'System prompt persona description',
                example: 'You are Atlas, a friendly and knowledgeable assistant.',
              },
              principles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Core principles for the agent',
                example: ['Be honest and transparent'],
              },
              quirks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Personality quirks',
                example: ['Uses Australian slang occasionally'],
              },
              voice_config: {
                type: 'object',
                nullable: true,
                description: 'Voice synthesis configuration',
                properties: {
                  provider: {
                    type: 'string',
                    description: 'Voice provider name',
                    example: 'elevenlabs',
                  },
                  voice_id: {
                    type: 'string',
                    description: 'Voice identifier',
                    example: 'pNInz6obpgDQGcFmaJgB',
                  },
                  speed: {
                    type: 'number',
                    description: 'Speech speed multiplier',
                    example: 1.0,
                  },
                  pitch: {
                    type: 'number',
                    description: 'Voice pitch adjustment',
                    example: 0.0,
                  },
                },
              },
            },
          }),
          responses: {
            '200': jsonResponse('Upserted identity', { $ref: '#/components/schemas/AgentIdentity' }),
            ...errorResponses(400, 401, 500),
          },
        },
        patch: {
          operationId: 'patchIdentity',
          summary: 'Partially update an identity',
          description: 'Updates specific fields of an identity identified by name. Increments version and records history with changed fields.',
          tags: ['Identity'],
          requestBody: jsonBody({
            type: 'object',
            required: ['name'],
            properties: {
              name: {
                type: 'string',
                description: 'Identity name (used to identify which identity to update)',
                example: 'assistant',
              },
              display_name: {
                type: 'string',
                description: 'New display name',
                example: 'Atlas v2',
              },
              emoji: {
                type: 'string',
                nullable: true,
                description: 'New emoji avatar',
                example: '🧠',
              },
              avatar_s3_key: {
                type: 'string',
                nullable: true,
                description: 'New S3 object key for avatar image',
                example: 'avatars/assistant-v4.png',
              },
              persona: {
                type: 'string',
                description: 'Updated persona description',
                example: 'You are Atlas, an expert project manager and daily assistant.',
              },
              principles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Updated principles',
                example: ['Be concise and action-oriented'],
              },
              quirks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Updated quirks',
                example: ['Occasionally quotes famous engineers'],
              },
              voice_config: {
                type: 'object',
                nullable: true,
                description: 'Updated voice configuration',
                properties: {
                  provider: {
                    type: 'string',
                    description: 'Voice provider name',
                    example: 'elevenlabs',
                  },
                  voice_id: {
                    type: 'string',
                    description: 'Voice identifier',
                    example: 'pNInz6obpgDQGcFmaJgB',
                  },
                  speed: {
                    type: 'number',
                    description: 'Speech speed multiplier',
                    example: 1.1,
                  },
                  pitch: {
                    type: 'number',
                    description: 'Voice pitch adjustment',
                    example: 0.0,
                  },
                },
              },
              is_active: {
                type: 'boolean',
                description: 'Whether to activate or deactivate the identity',
                example: true,
              },
            },
          }),
          responses: {
            '200': jsonResponse('Updated identity', { $ref: '#/components/schemas/AgentIdentity' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/identity/proposals': {
        post: {
          operationId: 'proposeIdentityChange',
          summary: 'Propose an identity change',
          description: 'Agent proposes a change to an identity field. Creates a history entry with change_type "propose" that can be approved or rejected.',
          tags: ['Identity'],
          requestBody: jsonBody({
            type: 'object',
            required: ['name', 'field'],
            properties: {
              name: {
                type: 'string',
                description: 'Identity name to propose changes for',
                example: 'assistant',
              },
              field: {
                type: 'string',
                description: 'Field name to change',
                example: 'persona',
              },
              new_value: {
                type: 'string',
                description: 'Proposed new value for the field',
                example: 'You are Atlas, an expert in cooking and project management.',
              },
              proposed_by: {
                type: 'string',
                description: 'Who proposed the change (typically agent:name)',
                default: 'agent:unknown',
                example: 'agent:assistant',
              },
              reason: {
                type: 'string',
                nullable: true,
                description: 'Reason for the proposed change',
                example: 'User frequently asks about cooking recipes',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Proposal created', { $ref: '#/components/schemas/IdentityHistoryEntry' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/identity/proposals/{id}/approve': {
        post: {
          operationId: 'approveIdentityProposal',
          summary: 'Approve a proposed identity change',
          description: 'Approves a pending identity change proposal. Applies the change to the identity, increments version, and marks the proposal as approved.',
          tags: ['Identity'],
          parameters: [uuidParam('id', 'Proposal history entry ID')],
          responses: {
            '200': jsonResponse('Approved proposal', { $ref: '#/components/schemas/IdentityHistoryEntry' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/identity/proposals/{id}/reject': {
        post: {
          operationId: 'rejectIdentityProposal',
          summary: 'Reject a proposed identity change',
          description: 'Rejects a pending identity change proposal with an optional reason.',
          tags: ['Identity'],
          parameters: [uuidParam('id', 'Proposal history entry ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                nullable: true,
                description: 'Reason for rejection',
                example: 'Persona should remain focused on project management',
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Rejected proposal', { $ref: '#/components/schemas/IdentityHistoryEntry' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/identity/history': {
        get: {
          operationId: 'getIdentityHistory',
          summary: 'Get identity version history',
          description: 'Returns the version history for an identity, ordered by creation date descending.',
          tags: ['Identity'],
          parameters: [
            {
              name: 'name',
              in: 'query',
              required: true,
              description: 'Identity name to retrieve history for',
              example: 'assistant',
              schema: { type: 'string' },
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum results (max 200)',
              example: 50,
              schema: { type: 'integer', default: 50, maximum: 200 },
            },
          ],
          responses: {
            '200': jsonResponse('Identity history', {
              type: 'object',
              required: ['history'],
              properties: {
                history: {
                  type: 'array',
                  description: 'List of identity history entries ordered by creation date descending',
                  items: { $ref: '#/components/schemas/IdentityHistoryEntry' },
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/identity/rollback': {
        post: {
          operationId: 'rollbackIdentity',
          summary: 'Rollback identity to a previous version',
          description: 'Restores an identity to the state captured in a previous version snapshot. Creates a new version with change_type "rollback".',
          tags: ['Identity'],
          requestBody: jsonBody({
            type: 'object',
            required: ['name', 'version'],
            properties: {
              name: {
                type: 'string',
                description: 'Identity name to rollback',
                example: 'assistant',
              },
              version: {
                type: 'integer',
                description: 'Target version number to rollback to',
                example: 2,
              },
            },
          }),
          responses: {
            '200': jsonResponse('Rolled-back identity', { $ref: '#/components/schemas/AgentIdentity' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
