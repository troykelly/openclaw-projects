/**
 * OpenAPI path definitions for dev prompt endpoints (Epic #2011, Issue #2014).
 * Routes: GET /dev-prompts, GET /dev-prompts/:id, GET /dev-prompts/by-key/:key,
 *         POST /dev-prompts, PATCH /dev-prompts/:id, DELETE /dev-prompts/:id,
 *         POST /dev-prompts/:id/reset, POST /dev-prompts/:id/render
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, namespaceParam, paginationParams, uuidParam, searchParam } from '../helpers.ts';

export function devPromptsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'DevPrompts', description: 'User-managed prompt templates for common development tasks' },
    ],
    schemas: {
      DevPrompt: {
        type: 'object',
        required: ['id', 'namespace', 'prompt_key', 'category', 'is_system', 'title', 'description', 'body', 'default_body', 'sort_order', 'is_active', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          namespace: { type: 'string', description: 'Namespace the prompt belongs to', example: 'troy' },
          prompt_key: { type: 'string', description: 'Snake_case key for programmatic access', example: 'new_feature_request', pattern: '^[a-z0-9][a-z0-9_]*$' },
          category: { type: 'string', enum: ['identification', 'creation', 'triage', 'shipping', 'general', 'custom'], description: 'Prompt category', example: 'creation' },
          is_system: { type: 'boolean', description: 'Whether this is a system-seeded prompt', example: true },
          title: { type: 'string', description: 'Human-readable title', example: 'New Feature Request' },
          description: { type: 'string', description: 'Description of what the prompt does', example: 'Create a feature request with epic breakdown' },
          body: { type: 'string', description: 'Handlebars template body', example: '# New Feature\n\nDate: {{ date_long }}' },
          default_body: { type: 'string', description: 'Original seeded body (system prompts only)', example: '# New Feature\n\nDate: {{ date_long }}' },
          sort_order: { type: 'integer', description: 'Display order (lower = first)', example: 20 },
          is_active: { type: 'boolean', description: 'Whether the prompt is active', example: true },
          deleted_at: { type: 'string', format: 'date-time', nullable: true, description: 'Soft-deletion timestamp' },
          created_at: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
          updated_at: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
        },
      },
      DevPromptCreateInput: {
        type: 'object',
        required: ['prompt_key', 'title', 'body'],
        properties: {
          prompt_key: { type: 'string', description: 'Snake_case key (unique per namespace)', example: 'my_custom_prompt', pattern: '^[a-z0-9][a-z0-9_]*$', maxLength: 100 },
          category: { type: 'string', enum: ['identification', 'creation', 'triage', 'shipping', 'general', 'custom'], default: 'custom' },
          title: { type: 'string', description: 'Human-readable title', minLength: 1 },
          description: { type: 'string', description: 'Description of the prompt' },
          body: { type: 'string', description: 'Handlebars template body' },
        },
      },
      DevPromptUpdateInput: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Human-readable title (ignored for system prompts)', minLength: 1 },
          description: { type: 'string', description: 'Description (ignored for system prompts)' },
          body: { type: 'string', description: 'Handlebars template body' },
          category: { type: 'string', enum: ['identification', 'creation', 'triage', 'shipping', 'general', 'custom'], description: 'Category (ignored for system prompts)' },
          is_active: { type: 'boolean', description: 'Whether the prompt is active' },
          sort_order: { type: 'integer', description: 'Display order (ignored for system prompts)' },
        },
      },
      DevPromptRenderInput: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Optional variables to supplement/override built-in template variables',
            example: { repo_org: 'troykelly', repo_name: 'openclaw-projects' },
          },
        },
      },
      DevPromptRenderResult: {
        type: 'object',
        required: ['rendered', 'variables_used', 'available_variables'],
        properties: {
          rendered: { type: 'string', description: 'Fully rendered template output' },
          variables_used: { type: 'array', items: { type: 'string' }, description: 'Names of variables referenced in the template' },
          available_variables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                example: { type: 'string' },
              },
            },
            description: 'Documentation for all available built-in variables',
          },
        },
      },
      DevPromptList: {
        type: 'object',
        required: ['total', 'limit', 'offset', 'items'],
        properties: {
          total: { type: 'integer', description: 'Total matching prompts' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          items: { type: 'array', items: { $ref: '#/components/schemas/DevPrompt' } },
        },
      },
    },
    paths: {
      '/dev-prompts': {
        get: {
          operationId: 'listDevPrompts',
          summary: 'List dev prompts',
          description: 'List dev prompts with optional filtering by category, system status, and search. System prompts in the default namespace are visible to all namespaces.',
          tags: ['DevPrompts'],
          parameters: [
            namespaceParam(),
            ...paginationParams(),
            searchParam('Search by title, description, or prompt_key'),
            { name: 'category', in: 'query', description: 'Filter by category', schema: { type: 'string', enum: ['identification', 'creation', 'triage', 'shipping', 'general', 'custom'] } },
            { name: 'is_system', in: 'query', description: 'Filter by system/user status', schema: { type: 'string', enum: ['true', 'false'] } },
            { name: 'include_inactive', in: 'query', description: 'Include inactive/deleted prompts', schema: { type: 'string', enum: ['true', 'false'] } },
          ],
          responses: {
            '200': jsonResponse('Paginated list of dev prompts', { $ref: '#/components/schemas/DevPromptList' }),
            ...errorResponses(400, 401),
          },
        },
        post: {
          operationId: 'createDevPrompt',
          summary: 'Create a user-defined dev prompt',
          description: 'Create a new custom dev prompt. The prompt_key must be unique within the namespace.',
          tags: ['DevPrompts'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({ $ref: '#/components/schemas/DevPromptCreateInput' }),
          responses: {
            '201': jsonResponse('Created dev prompt', { $ref: '#/components/schemas/DevPrompt' }),
            ...errorResponses(400, 401, 409),
          },
        },
      },
      '/dev-prompts/by-key/{key}': {
        get: {
          operationId: 'getDevPromptByKey',
          summary: 'Get dev prompt by key',
          description: 'Retrieve a dev prompt by its prompt_key. Searches the user\'s namespaces first, then falls back to system prompts in the default namespace.',
          tags: ['DevPrompts'],
          parameters: [
            namespaceParam(),
            { name: 'key', in: 'path', required: true, description: 'Prompt key', schema: { type: 'string' }, example: 'new_feature_request' },
          ],
          responses: {
            '200': jsonResponse('Dev prompt', { $ref: '#/components/schemas/DevPrompt' }),
            ...errorResponses(401, 404),
          },
        },
      },
      '/dev-prompts/{id}': {
        get: {
          operationId: 'getDevPrompt',
          summary: 'Get dev prompt by ID',
          tags: ['DevPrompts'],
          parameters: [namespaceParam(), uuidParam()],
          responses: {
            '200': jsonResponse('Dev prompt', { $ref: '#/components/schemas/DevPrompt' }),
            ...errorResponses(400, 401, 404),
          },
        },
        patch: {
          operationId: 'updateDevPrompt',
          summary: 'Update a dev prompt',
          description: 'Update a dev prompt. For system prompts, only body and is_active can be changed.',
          tags: ['DevPrompts'],
          parameters: [namespaceParam(), uuidParam()],
          requestBody: jsonBody({ $ref: '#/components/schemas/DevPromptUpdateInput' }),
          responses: {
            '200': jsonResponse('Updated dev prompt', { $ref: '#/components/schemas/DevPrompt' }),
            ...errorResponses(400, 401, 404),
          },
        },
        delete: {
          operationId: 'deleteDevPrompt',
          summary: 'Soft-delete a dev prompt',
          description: 'Soft-delete a user-defined dev prompt. System prompts cannot be deleted (returns 400).',
          tags: ['DevPrompts'],
          parameters: [namespaceParam(), uuidParam()],
          responses: {
            '204': { description: 'Successfully deleted' },
            ...errorResponses(400, 401, 404),
          },
        },
      },
      '/dev-prompts/{id}/reset': {
        post: {
          operationId: 'resetDevPrompt',
          summary: 'Reset system prompt to default body',
          description: 'Reset a system prompt\'s body to its original default_body. Only works for system prompts.',
          tags: ['DevPrompts'],
          parameters: [namespaceParam(), uuidParam()],
          responses: {
            '200': jsonResponse('Reset dev prompt', { $ref: '#/components/schemas/DevPrompt' }),
            ...errorResponses(400, 401),
          },
        },
      },
      '/dev-prompts/{id}/render': {
        post: {
          operationId: 'renderDevPrompt',
          summary: 'Render a dev prompt with Handlebars',
          description: 'Render a dev prompt body with Handlebars template variables. Built-in variables (date, namespace, etc.) are provided automatically. Optional user-supplied variables override built-ins.',
          tags: ['DevPrompts'],
          parameters: [namespaceParam(), uuidParam()],
          requestBody: jsonBody({ $ref: '#/components/schemas/DevPromptRenderInput' }, false),
          responses: {
            '200': jsonResponse('Rendered result', { $ref: '#/components/schemas/DevPromptRenderResult' }),
            ...errorResponses(400, 401, 404),
          },
        },
      },
    },
  };
}
