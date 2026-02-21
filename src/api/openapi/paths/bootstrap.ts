/**
 * OpenAPI path definitions for bootstrap, context, and settings endpoints.
 * Routes: GET /api/bootstrap, POST /api/v1/context, POST /api/context/capture,
 *         GET /api/settings, PATCH /api/settings,
 *         GET /api/settings/embeddings, PATCH /api/settings/embeddings,
 *         POST /api/settings/embeddings/test
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, errorResponses, jsonBody, jsonResponse, namespaceParam } from '../helpers.ts';

export function bootstrapPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Bootstrap', description: 'Agent session initialization and context retrieval' },
      { name: 'Settings', description: 'User settings and embedding configuration' },
    ],
    schemas: {
      BootstrapResponse: {
        type: 'object',
        description: 'Complete agent session context including settings, projects, reminders, contacts, and memories',
        required: ['settings', 'projects', 'reminders'],
        properties: {
          settings: {
            type: 'object',
            description: 'User settings for the bootstrapped session',
            properties: {
              email: {
                type: 'string',
                format: 'email',
                description: 'Email of the user whose context is being bootstrapped',
                example: 'alice@example.com',
              },
              theme: {
                type: 'string',
                description: 'UI theme preference',
                example: 'dark',
              },
              timezone: {
                type: 'string',
                description: 'User IANA timezone',
                example: 'Australia/Sydney',
              },
            },
          },
          projects: {
            type: 'array',
            description: 'Active projects in the namespace',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Project unique identifier',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                title: {
                  type: 'string',
                  description: 'Project title',
                  example: 'Home Renovation',
                },
                status: {
                  type: 'string',
                  description: 'Project status',
                  example: 'active',
                },
              },
            },
          },
          reminders: {
            type: 'array',
            description: 'Upcoming reminders and due items',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Reminder work item ID',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                title: {
                  type: 'string',
                  description: 'Reminder title',
                  example: 'Call dentist',
                },
                not_before: {
                  type: 'string',
                  format: 'date-time',
                  description: 'When the reminder should fire',
                  example: '2026-02-22T09:00:00Z',
                },
              },
            },
          },
          contacts: {
            type: 'array',
            description: 'Relevant contacts for agent context',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Contact unique identifier',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                display_name: {
                  type: 'string',
                  description: 'Contact display name',
                  example: 'Bob Smith',
                },
              },
            },
          },
          memories: {
            type: 'array',
            description: 'Recent memories for agent context grounding',
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
                  example: 'User prefers email notifications over SMS',
                },
                memory_type: {
                  type: 'string',
                  description: 'Type of memory',
                  example: 'preference',
                },
              },
            },
          },
        },
      },
      ContextRequest: {
        type: 'object',
        required: ['prompt'],
        properties: {
          user_id: {
            type: 'string',
            description: 'User identifier for context scoping (email or UUID)',
            example: 'alice@example.com',
          },
          prompt: {
            type: 'string',
            description: 'The agent prompt to retrieve relevant context for via semantic search',
            example: 'What are the upcoming tasks for the home renovation project?',
          },
          max_memories: {
            type: 'integer',
            description: 'Maximum number of memories to return from semantic search',
            example: 10,
          },
          max_context_length: {
            type: 'integer',
            description: 'Maximum total context string length in characters',
            example: 4000,
          },
          include_projects: {
            type: 'boolean',
            description: 'Include active projects in context',
            default: true,
            example: true,
          },
          include_todos: {
            type: 'boolean',
            description: 'Include pending todos in context',
            default: true,
            example: true,
          },
          include_contacts: {
            type: 'boolean',
            description: 'Include relevant contacts in context',
            default: true,
            example: true,
          },
          min_similarity: {
            type: 'number',
            description: 'Minimum similarity threshold for semantic memory matching (0-1). Higher values return fewer but more relevant results.',
            minimum: 0,
            maximum: 1,
            example: 0.7,
          },
        },
      },
      ContextResponse: {
        type: 'object',
        description: 'Retrieved context for agent auto-recall',
        properties: {
          memories: {
            type: 'array',
            description: 'Semantically matched memories ordered by relevance',
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
                  example: 'User prefers email notifications over SMS',
                },
                similarity: {
                  type: 'number',
                  description: 'Cosine similarity score to the input prompt',
                  example: 0.89,
                },
              },
            },
          },
          projects: {
            type: 'array',
            description: 'Active projects relevant to the prompt',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Project unique identifier',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                title: {
                  type: 'string',
                  description: 'Project title',
                  example: 'Home Renovation',
                },
              },
            },
          },
          todos: {
            type: 'array',
            description: 'Pending todo items',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Todo work item ID',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                title: {
                  type: 'string',
                  description: 'Todo title',
                  example: 'Buy paint for living room',
                },
              },
            },
          },
          contacts: {
            type: 'array',
            description: 'Relevant contacts',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Contact unique identifier',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                display_name: {
                  type: 'string',
                  description: 'Contact display name',
                  example: 'Bob Smith',
                },
              },
            },
          },
        },
      },
      CaptureRequest: {
        type: 'object',
        required: ['conversation', 'message_count'],
        properties: {
          conversation: {
            type: 'string',
            description: 'Conversation text transcript to extract structured context from',
            example: 'User: I prefer to be reminded about tasks in the morning.\nAgent: Got it, I will set morning reminders.',
          },
          message_count: {
            type: 'integer',
            description: 'Number of messages in the conversation transcript',
            minimum: 1,
            example: 2,
          },
          user_id: {
            type: 'string',
            description: 'User identifier for context scoping',
            example: 'alice@example.com',
          },
        },
      },
      CaptureResponse: {
        type: 'object',
        description: 'Extracted context from conversation analysis',
        properties: {
          preferences: {
            type: 'array',
            description: 'User preferences extracted from the conversation',
            items: {
              type: 'object',
              properties: {
                key: {
                  type: 'string',
                  description: 'Preference key or category',
                  example: 'reminder_time',
                },
                value: {
                  type: 'string',
                  description: 'Extracted preference value',
                  example: 'morning',
                },
              },
            },
          },
          facts: {
            type: 'array',
            description: 'Facts extracted from the conversation',
            items: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'Extracted factual statement',
                  example: 'User lives in Sydney, Australia',
                },
              },
            },
          },
          decisions: {
            type: 'array',
            description: 'Decisions made during the conversation',
            items: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'Decision statement',
                  example: 'Set all reminders for 8:00 AM local time',
                },
                rationale: {
                  type: 'string',
                  description: 'Reasoning behind the decision',
                  example: 'User prefers morning reminders',
                },
              },
            },
          },
        },
      },
      UserSettings: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'Email of the settings owner',
            example: 'alice@example.com',
          },
          theme: {
            type: 'string',
            enum: ['light', 'dark', 'system'],
            nullable: true,
            description: 'UI theme preference',
            example: 'dark',
          },
          default_view: {
            type: 'string',
            enum: ['activity', 'projects', 'timeline', 'contacts'],
            nullable: true,
            description: 'Default landing view when the user opens the app',
            example: 'activity',
          },
          default_project_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'UUID of the default project to show on login',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          sidebar_collapsed: {
            type: 'boolean',
            nullable: true,
            description: 'Whether the sidebar is collapsed in the UI',
            example: false,
          },
          show_completed_items: {
            type: 'boolean',
            nullable: true,
            description: 'Whether completed items are shown in list views',
            example: true,
          },
          items_per_page: {
            type: 'integer',
            nullable: true,
            description: 'Number of items shown per page in list views',
            example: 25,
          },
          email_notifications: {
            type: 'boolean',
            nullable: true,
            description: 'Whether email notifications are enabled',
            example: true,
          },
          email_digest_frequency: {
            type: 'string',
            enum: ['never', 'daily', 'weekly'],
            nullable: true,
            description: 'Frequency of email digest notifications',
            example: 'daily',
          },
          timezone: {
            type: 'string',
            nullable: true,
            description: 'IANA timezone string for date/time display and reminder scheduling',
            example: 'Australia/Sydney',
          },
          geo_auto_inject: {
            type: 'boolean',
            nullable: true,
            description: 'Whether to automatically inject geolocation into agent context',
            example: true,
          },
          geo_high_res_retention_hours: {
            type: 'integer',
            nullable: true,
            description: 'Number of hours to retain high-resolution location data',
            example: 24,
          },
          geo_general_retention_days: {
            type: 'integer',
            nullable: true,
            description: 'Number of days to retain general (downsampled) location data',
            example: 30,
          },
          geo_high_res_threshold_m: {
            type: 'number',
            nullable: true,
            description: 'Minimum distance in meters before a new high-resolution location point is recorded',
            example: 50.0,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the settings were created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the settings were last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      UpdateSettingsRequest: {
        type: 'object',
        properties: {
          theme: {
            type: 'string',
            enum: ['light', 'dark', 'system'],
            description: 'UI theme preference',
            example: 'dark',
          },
          default_view: {
            type: 'string',
            enum: ['activity', 'projects', 'timeline', 'contacts'],
            description: 'Default landing view',
            example: 'projects',
          },
          default_project_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'UUID of the default project (null to clear)',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          sidebar_collapsed: {
            type: 'boolean',
            description: 'Whether the sidebar is collapsed',
            example: false,
          },
          show_completed_items: {
            type: 'boolean',
            description: 'Whether completed items are shown',
            example: true,
          },
          items_per_page: {
            type: 'integer',
            description: 'Number of items per page',
            example: 25,
          },
          email_notifications: {
            type: 'boolean',
            description: 'Whether email notifications are enabled',
            example: true,
          },
          email_digest_frequency: {
            type: 'string',
            enum: ['never', 'daily', 'weekly'],
            description: 'Frequency of email digest notifications',
            example: 'daily',
          },
          timezone: {
            type: 'string',
            description: 'IANA timezone string',
            example: 'Australia/Sydney',
          },
          geo_auto_inject: {
            type: 'boolean',
            description: 'Whether to auto-inject geolocation',
            example: true,
          },
          geo_high_res_retention_hours: {
            type: 'integer',
            description: 'Hours to retain high-res location data',
            example: 24,
          },
          geo_general_retention_days: {
            type: 'integer',
            description: 'Days to retain general location data',
            example: 30,
          },
          geo_high_res_threshold_m: {
            type: 'number',
            description: 'Minimum distance in meters for new high-res location point',
            example: 50.0,
          },
        },
      },
      EmbeddingSettings: {
        type: 'object',
        description: 'Embedding provider settings and budget configuration',
        properties: {
          provider: {
            type: 'string',
            description: 'Name of the embedding provider being used',
            example: 'openai',
          },
          model: {
            type: 'string',
            description: 'Embedding model identifier',
            example: 'text-embedding-3-small',
          },
          dimensions: {
            type: 'integer',
            description: 'Number of dimensions in the embedding vectors',
            example: 1536,
          },
          daily_limit_usd: {
            type: 'number',
            description: 'Daily spending limit in USD for embedding generation',
            example: 5.0,
          },
          monthly_limit_usd: {
            type: 'number',
            description: 'Monthly spending limit in USD for embedding generation',
            example: 100.0,
          },
          daily_usage_usd: {
            type: 'number',
            description: 'Current daily usage in USD',
            example: 1.23,
          },
          monthly_usage_usd: {
            type: 'number',
            description: 'Current monthly usage in USD',
            example: 45.67,
          },
          pause_on_limit: {
            type: 'boolean',
            description: 'Whether embedding generation is paused when budget limits are reached',
            example: true,
          },
          is_paused: {
            type: 'boolean',
            description: 'Whether embedding generation is currently paused',
            example: false,
          },
        },
      },
      UpdateEmbeddingSettingsRequest: {
        type: 'object',
        properties: {
          daily_limit_usd: {
            type: 'number',
            description: 'Daily spending limit in USD for embedding generation',
            minimum: 0,
            maximum: 10000,
            example: 5.0,
          },
          monthly_limit_usd: {
            type: 'number',
            description: 'Monthly spending limit in USD for embedding generation',
            minimum: 0,
            maximum: 100000,
            example: 100.0,
          },
          pause_on_limit: {
            type: 'boolean',
            description: 'Whether to pause embedding generation when budget limits are reached',
            example: true,
          },
        },
      },
      EmbeddingTestResult: {
        type: 'object',
        description: 'Result of testing the embedding provider connection',
        properties: {
          ok: {
            type: 'boolean',
            description: 'Whether the connection test was successful',
            example: true,
          },
          provider: {
            type: 'string',
            description: 'Name of the embedding provider tested',
            example: 'openai',
          },
          model: {
            type: 'string',
            description: 'Embedding model tested',
            example: 'text-embedding-3-small',
          },
          latency_ms: {
            type: 'number',
            description: 'Latency of the test embedding call in milliseconds',
            example: 234.5,
          },
          dimensions: {
            type: 'integer',
            description: 'Number of dimensions returned by the model',
            example: 1536,
          },
          error: {
            type: 'string',
            nullable: true,
            description: 'Error message if the test failed',
            example: null,
          },
        },
        required: ['ok'],
      },
    },
    paths: {
      '/api/bootstrap': {
        get: {
          operationId: 'getBootstrapContext',
          summary: 'Get agent bootstrap context',
          description: 'Returns complete session context in a single call, including user settings, active projects, reminders, contacts, and recent memories. Designed for agent session initialization.',
          tags: ['Bootstrap'],
          parameters: [
            namespaceParam(),
            {
              name: 'user_email',
              in: 'query',
              description: 'Email of the user to bootstrap context for (M2M tokens only)',
              example: 'alice@example.com',
              schema: { type: 'string', format: 'email' },
            },
            {
              name: 'include',
              in: 'query',
              description: 'Comma-separated list of context sections to include (e.g. "settings,projects,reminders")',
              example: 'settings,projects,reminders',
              schema: { type: 'string' },
            },
            {
              name: 'exclude',
              in: 'query',
              description: 'Comma-separated list of context sections to exclude',
              example: 'contacts',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': jsonResponse('Bootstrap context', ref('BootstrapResponse')),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/v1/context': {
        post: {
          operationId: 'retrieveContext',
          summary: 'Retrieve agent context',
          description: 'Auto-recall endpoint that retrieves relevant context for a given prompt using semantic memory search, active projects, todos, and contacts.',
          tags: ['Bootstrap'],
          requestBody: jsonBody(ref('ContextRequest')),
          responses: {
            '200': jsonResponse('Retrieved context', ref('ContextResponse')),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/context/capture': {
        post: {
          operationId: 'captureContext',
          summary: 'Capture context from conversation',
          description: 'Auto-capture endpoint that extracts structured context (preferences, facts, decisions) from a conversation transcript.',
          tags: ['Bootstrap'],
          requestBody: jsonBody(ref('CaptureRequest')),
          responses: {
            '200': jsonResponse('Captured context', ref('CaptureResponse')),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/settings': {
        get: {
          operationId: 'getSettings',
          summary: 'Get user settings',
          description: 'Returns the current user settings. Creates default settings if none exist.',
          tags: ['Settings'],
          responses: {
            '200': jsonResponse('User settings', ref('UserSettings')),
            ...errorResponses(401, 500),
          },
        },
        patch: {
          operationId: 'updateSettings',
          summary: 'Update user settings',
          description: 'Updates one or more user settings fields. Only provided fields are changed.',
          tags: ['Settings'],
          requestBody: jsonBody(ref('UpdateSettingsRequest')),
          responses: {
            '200': jsonResponse('Updated settings', ref('UserSettings')),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/settings/embeddings': {
        get: {
          operationId: 'getEmbeddingSettings',
          summary: 'Get embedding settings',
          description: 'Returns the current embedding provider configuration and budget settings.',
          tags: ['Settings'],
          responses: {
            '200': jsonResponse('Embedding settings', ref('EmbeddingSettings')),
            ...errorResponses(401, 500),
          },
        },
        patch: {
          operationId: 'updateEmbeddingSettings',
          summary: 'Update embedding settings',
          description: 'Updates embedding budget limits and pause behavior.',
          tags: ['Settings'],
          requestBody: jsonBody(ref('UpdateEmbeddingSettingsRequest')),
          responses: {
            '200': jsonResponse('Updated embedding settings', ref('EmbeddingSettings')),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/settings/embeddings/test': {
        post: {
          operationId: 'testEmbeddingProvider',
          summary: 'Test embedding provider connection',
          description: 'Tests the connection to the configured embedding provider and returns diagnostic results.',
          tags: ['Settings'],
          responses: {
            '200': jsonResponse('Test results', ref('EmbeddingTestResult')),
            ...errorResponses(401, 500),
          },
        },
      },
    },
  };
}
