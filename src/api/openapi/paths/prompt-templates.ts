/**
 * OpenAPI path definitions for prompt template endpoints.
 * Routes: POST /api/prompt-templates, GET /api/prompt-templates,
 *         GET /api/prompt-templates/:id, PUT /api/prompt-templates/:id,
 *         DELETE /api/prompt-templates/:id
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, searchParam, uuidParam } from '../helpers.ts';

export function promptTemplatesPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'PromptTemplates', description: 'Reusable prompt templates for agent interactions, scoped by channel type' },
    ],
    schemas: {
      PromptTemplate: {
        type: 'object',
        required: ['id', 'label', 'content', 'channel_type', 'is_default', 'is_active', 'namespace', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the prompt template',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          label: {
            type: 'string',
            description: 'Human-readable label for the prompt template',
            example: 'SMS Greeting',
          },
          content: {
            type: 'string',
            description: 'The template content with optional placeholder variables',
            example: 'Hello {{name}}, this is a reminder about your upcoming appointment on {{date}}.',
          },
          channel_type: {
            type: 'string',
            enum: ['sms', 'email', 'ha_observation', 'general'],
            description: 'Channel type this template is designed for',
            example: 'sms',
          },
          is_default: {
            type: 'boolean',
            description: 'Whether this is the default template for the channel type',
            example: false,
          },
          is_active: {
            type: 'boolean',
            description: 'Whether this template is active and available for use',
            example: true,
          },
          namespace: {
            type: 'string',
            description: 'Namespace scope for multi-tenant isolation',
            example: 'home',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the template was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the template was last updated',
            example: '2026-02-21T15:00:00Z',
          },
        },
      },
    },
    paths: {
      '/api/prompt-templates': {
        post: {
          operationId: 'createPromptTemplate',
          summary: 'Create a prompt template',
          description: 'Creates a new prompt template. Channel type must be one of: sms, email, ha_observation, general.',
          tags: ['PromptTemplates'],
          requestBody: jsonBody({
            type: 'object',
            required: ['label', 'content', 'channel_type'],
            properties: {
              label: {
                type: 'string',
                description: 'Human-readable label for the template',
                example: 'Email Follow-Up',
              },
              content: {
                type: 'string',
                description: 'Template content with optional placeholders',
                example: 'Hi {{name}}, just following up on our conversation about {{topic}}.',
              },
              channel_type: {
                type: 'string',
                enum: ['sms', 'email', 'ha_observation', 'general'],
                description: 'Channel type this template is designed for',
                example: 'email',
              },
              is_default: {
                type: 'boolean',
                description: 'Whether to set this as the default template for the channel type',
                example: false,
              },
            },
          }),
          responses: {
            '201': jsonResponse('Prompt template created', { $ref: '#/components/schemas/PromptTemplate' }),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listPromptTemplates',
          summary: 'List prompt templates',
          description: 'Returns prompt templates with optional filtering by channel type, search, and pagination.',
          tags: ['PromptTemplates'],
          parameters: [
            {
              name: 'channel_type',
              in: 'query',
              description: 'Filter by channel type',
              schema: { type: 'string', enum: ['sms', 'email', 'ha_observation', 'general'] },
              example: 'sms',
            },
            searchParam('Search by label or content'),
            {
              name: 'include_inactive',
              in: 'query',
              description: 'Include inactive (soft-deleted) templates in results',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Prompt templates', {
              type: 'object',
              required: ['total', 'limit', 'offset', 'items'],
              properties: {
                total: {
                  type: 'integer',
                  description: 'Total number of matching templates',
                  example: 12,
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
                  items: { $ref: '#/components/schemas/PromptTemplate' },
                  description: 'Array of prompt templates matching the query',
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/prompt-templates/{id}': {
        get: {
          operationId: 'getPromptTemplate',
          summary: 'Get a prompt template',
          description: 'Returns a single prompt template by ID.',
          tags: ['PromptTemplates'],
          parameters: [uuidParam('id', 'Prompt template ID')],
          responses: {
            '200': jsonResponse('Prompt template', { $ref: '#/components/schemas/PromptTemplate' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        put: {
          operationId: 'updatePromptTemplate',
          summary: 'Update a prompt template',
          description: 'Updates label, content, channel type, default status, or active status of a prompt template.',
          tags: ['PromptTemplates'],
          parameters: [uuidParam('id', 'Prompt template ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'Updated human-readable label',
                example: 'SMS Reminder v2',
              },
              content: {
                type: 'string',
                description: 'Updated template content',
                example: 'Hey {{name}}, reminder: {{reminder_text}}',
              },
              channel_type: {
                type: 'string',
                enum: ['sms', 'email', 'ha_observation', 'general'],
                description: 'Updated channel type for the template',
                example: 'general',
              },
              is_default: {
                type: 'boolean',
                description: 'Whether to set this as the default for the channel type',
                example: true,
              },
              is_active: {
                type: 'boolean',
                description: 'Whether the template is active',
                example: true,
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated prompt template', { $ref: '#/components/schemas/PromptTemplate' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deletePromptTemplate',
          summary: 'Soft-delete a prompt template',
          description: 'Soft-deletes a prompt template by setting is_active to false.',
          tags: ['PromptTemplates'],
          parameters: [uuidParam('id', 'Prompt template ID')],
          responses: {
            '204': { description: 'Prompt template deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
