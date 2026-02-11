/**
 * OpenClaw 2026 Plugin Registration
 *
 * This module implements the OpenClaw Gateway plugin API pattern:
 * - Default export function taking `api` object
 * - Tools registered via `api.registerTool()`
 * - Hooks registered via `api.on()` (modern) or `api.registerHook()` (legacy fallback)
 * - CLI registered via `api.registerCli()`
 */

import type {
  OpenClawPluginApi,
  PluginInitializer,
  ToolDefinition,
  JSONSchema,
  ToolResult,
  AgentToolResult,
  PluginHookBeforeAgentStartEvent,
  PluginHookAgentContext,
  PluginHookBeforeAgentStartResult,
  PluginHookAgentEndEvent,
} from './types/openclaw-api.js';
import { ZodError } from 'zod';
import { validateRawConfig, resolveConfigSecretsSync, redactConfig, type PluginConfig, type RawPluginConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { createApiClient, type ApiClient } from './api-client.js';
import { extractContext, getUserScopeKey } from './context.js';
import {
  createSkillStorePutTool,
  createSkillStoreGetTool,
  createSkillStoreListTool,
  createSkillStoreDeleteTool,
  createSkillStoreSearchTool,
  createSkillStoreCollectionsTool,
  createSkillStoreAggregateTool,
} from './tools/index.js';
import { createGatewayMethods, registerGatewayRpcMethods } from './gateway/rpc-methods.js';
import { createOAuthGatewayMethods, registerOAuthGatewayRpcMethods } from './gateway/oauth-rpc-methods.js';
import { createNotificationService } from './services/notification-service.js';
import { createAutoCaptureHook, createGraphAwareRecallHook } from './hooks.js';

/** Plugin state stored during registration */
interface PluginState {
  config: PluginConfig;
  logger: Logger;
  apiClient: ApiClient;
  userId: string;
}

/**
 * Convert internal ToolResult format to AgentToolResult format expected by OpenClaw Gateway.
 *
 * The Gateway expects: { content: [{ type: "text", text: "..." }] }
 * Our handlers return: { success: boolean, data?: { content: string, ... }, error?: string }
 */
function toAgentToolResult(result: ToolResult): AgentToolResult {
  if (result.success && result.data) {
    return {
      content: [{ type: 'text' as const, text: result.data.content }],
    };
  }

  // For errors, format the error message
  const errorText = result.error ?? 'An unexpected error occurred';
  return {
    content: [{ type: 'text' as const, text: `Error: ${errorText}` }],
  };
}

/**
 * Memory recall tool JSON Schema
 */
const memoryRecallSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query for semantic memory search',
      minLength: 1,
      maxLength: 1000,
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of memories to return',
      minimum: 1,
      maximum: 20,
      default: 5,
    },
    category: {
      type: 'string',
      description: 'Filter by memory category',
      enum: ['preference', 'fact', 'decision', 'context', 'other'],
    },
    tags: {
      type: 'array',
      description: 'Filter by tags for categorical queries (e.g., ["music", "food"])',
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
      },
    },
    relationship_id: {
      type: 'string',
      description: 'Scope search to a specific relationship between contacts',
      format: 'uuid',
    },
  },
  required: ['query'],
};

/**
 * Memory store tool JSON Schema
 */
const memoryStoreSchema: JSONSchema = {
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description: 'Memory content to store',
      minLength: 1,
      maxLength: 10000,
    },
    category: {
      type: 'string',
      description: 'Memory category',
      enum: ['preference', 'fact', 'decision', 'context', 'other'],
      default: 'fact',
    },
    importance: {
      type: 'number',
      description: 'Importance score (0-1)',
      minimum: 0,
      maximum: 1,
      default: 0.5,
    },
    tags: {
      type: 'array',
      description: 'Tags for structured retrieval (e.g., ["music", "work", "food"])',
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 100,
      },
    },
    relationship_id: {
      type: 'string',
      description: 'Scope memory to a specific relationship between contacts',
      format: 'uuid',
    },
  },
  required: ['content'],
};

/**
 * Memory forget tool JSON Schema
 */
const memoryForgetSchema: JSONSchema = {
  type: 'object',
  properties: {
    memoryId: {
      type: 'string',
      description: 'ID of the memory to forget',
      format: 'uuid',
    },
    query: {
      type: 'string',
      description: 'Search query to find memories to forget',
    },
  },
};

/**
 * Project list tool JSON Schema
 */
const projectListSchema: JSONSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      description: 'Filter by project status',
      enum: ['active', 'completed', 'archived', 'all'],
      default: 'active',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of projects to return',
      minimum: 1,
      maximum: 50,
      default: 10,
    },
  },
};

/**
 * Project get tool JSON Schema
 */
const projectGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    projectId: {
      type: 'string',
      description: 'Project ID to retrieve',
      format: 'uuid',
    },
  },
  required: ['projectId'],
};

/**
 * Project create tool JSON Schema
 */
const projectCreateSchema: JSONSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Project name',
      minLength: 1,
      maxLength: 200,
    },
    description: {
      type: 'string',
      description: 'Project description',
      maxLength: 5000,
    },
    status: {
      type: 'string',
      description: 'Initial project status',
      enum: ['active', 'completed', 'archived'],
      default: 'active',
    },
  },
  required: ['name'],
};

/**
 * Todo list tool JSON Schema
 */
const todoListSchema: JSONSchema = {
  type: 'object',
  properties: {
    projectId: {
      type: 'string',
      description: 'Filter by project ID',
      format: 'uuid',
    },
    status: {
      type: 'string',
      description: 'Filter by todo status',
      enum: ['pending', 'in_progress', 'completed', 'all'],
      default: 'pending',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of todos to return',
      minimum: 1,
      maximum: 100,
      default: 20,
    },
  },
};

/**
 * Todo create tool JSON Schema
 */
const todoCreateSchema: JSONSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Todo title',
      minLength: 1,
      maxLength: 500,
    },
    description: {
      type: 'string',
      description: 'Todo description',
      maxLength: 5000,
    },
    projectId: {
      type: 'string',
      description: 'Project to add the todo to',
      format: 'uuid',
    },
    priority: {
      type: 'string',
      description: 'Todo priority',
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    dueDate: {
      type: 'string',
      description: 'Due date in ISO 8601 format',
      format: 'date-time',
    },
  },
  required: ['title'],
};

/**
 * Todo complete tool JSON Schema
 */
const todoCompleteSchema: JSONSchema = {
  type: 'object',
  properties: {
    todoId: {
      type: 'string',
      description: 'Todo ID to mark as complete',
      format: 'uuid',
    },
  },
  required: ['todoId'],
};

/**
 * Contact search tool JSON Schema
 */
const contactSearchSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query for contacts',
      minLength: 1,
      maxLength: 500,
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of contacts to return',
      minimum: 1,
      maximum: 50,
      default: 10,
    },
  },
  required: ['query'],
};

/**
 * Contact get tool JSON Schema
 */
const contactGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    contactId: {
      type: 'string',
      description: 'Contact ID to retrieve',
      format: 'uuid',
    },
  },
  required: ['contactId'],
};

/**
 * Contact create tool JSON Schema
 */
const contactCreateSchema: JSONSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Contact name',
      minLength: 1,
      maxLength: 200,
    },
    email: {
      type: 'string',
      description: 'Contact email address',
      format: 'email',
    },
    phone: {
      type: 'string',
      description: 'Contact phone number',
    },
    notes: {
      type: 'string',
      description: 'Notes about the contact',
      maxLength: 5000,
    },
  },
  required: ['name'],
};

/**
 * SMS send tool JSON Schema
 */
const smsSendSchema: JSONSchema = {
  type: 'object',
  properties: {
    to: {
      type: 'string',
      description: 'Recipient phone number in E.164 format (e.g., +15551234567)',
      pattern: '^\\+[1-9]\\d{1,14}$',
    },
    body: {
      type: 'string',
      description: 'SMS message body',
      minLength: 1,
      maxLength: 1600,
    },
    idempotencyKey: {
      type: 'string',
      description: 'Optional key to prevent duplicate sends',
    },
  },
  required: ['to', 'body'],
};

/**
 * Email send tool JSON Schema
 */
const emailSendSchema: JSONSchema = {
  type: 'object',
  properties: {
    to: {
      type: 'string',
      description: 'Recipient email address',
      format: 'email',
    },
    subject: {
      type: 'string',
      description: 'Email subject line',
      minLength: 1,
      maxLength: 998,
    },
    body: {
      type: 'string',
      description: 'Plain text email body',
      minLength: 1,
    },
    htmlBody: {
      type: 'string',
      description: 'Optional HTML email body',
    },
    threadId: {
      type: 'string',
      description: 'Optional thread ID for replies',
    },
    idempotencyKey: {
      type: 'string',
      description: 'Optional unique key to prevent duplicate sends',
    },
  },
  required: ['to', 'subject', 'body'],
};

/**
 * Message search tool JSON Schema
 */
const messageSearchSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query (semantic matching)',
      minLength: 1,
    },
    channel: {
      type: 'string',
      description: 'Filter by channel type',
      enum: ['sms', 'email', 'all'],
      default: 'all',
    },
    contactId: {
      type: 'string',
      description: 'Filter by contact ID',
      format: 'uuid',
    },
    limit: {
      type: 'integer',
      description: 'Maximum results to return',
      minimum: 1,
      maximum: 100,
      default: 10,
    },
    includeThread: {
      type: 'boolean',
      description: 'Include full thread context',
      default: false,
    },
  },
  required: ['query'],
};

/**
 * Thread list tool JSON Schema
 */
const threadListSchema: JSONSchema = {
  type: 'object',
  properties: {
    channel: {
      type: 'string',
      description: 'Filter by channel type',
      enum: ['sms', 'email'],
    },
    contactId: {
      type: 'string',
      description: 'Filter by contact ID',
      format: 'uuid',
    },
    limit: {
      type: 'integer',
      description: 'Maximum threads to return',
      minimum: 1,
      maximum: 100,
      default: 20,
    },
  },
};

/**
 * Thread get tool JSON Schema
 */
const threadGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    threadId: {
      type: 'string',
      description: 'Thread ID to retrieve',
    },
    messageLimit: {
      type: 'integer',
      description: 'Maximum messages to return',
      minimum: 1,
      maximum: 200,
      default: 50,
    },
  },
  required: ['threadId'],
};

/**
 * Relationship set tool JSON Schema
 */
const relationshipSetSchema: JSONSchema = {
  type: 'object',
  properties: {
    contact_a: {
      type: 'string',
      description: 'Name or ID of the first contact',
      minLength: 1,
      maxLength: 200,
    },
    contact_b: {
      type: 'string',
      description: 'Name or ID of the second contact',
      minLength: 1,
      maxLength: 200,
    },
    relationship: {
      type: 'string',
      description: "Description of the relationship, e.g. 'partner', 'parent of', 'member of', 'works for'",
      minLength: 1,
      maxLength: 200,
    },
    notes: {
      type: 'string',
      description: 'Optional context about this relationship',
      maxLength: 2000,
    },
  },
  required: ['contact_a', 'contact_b', 'relationship'],
};

/**
 * Relationship query tool JSON Schema
 */
const relationshipQuerySchema: JSONSchema = {
  type: 'object',
  properties: {
    contact: {
      type: 'string',
      description: 'Name or ID of the contact to query',
      minLength: 1,
      maxLength: 200,
    },
    type_filter: {
      type: 'string',
      description: 'Optional: filter by relationship type',
      maxLength: 200,
    },
  },
  required: ['contact'],
};

/**
 * File share tool JSON Schema
 */
const fileShareSchema: JSONSchema = {
  type: 'object',
  properties: {
    fileId: {
      type: 'string',
      description: 'The file ID to create a share link for',
      format: 'uuid',
    },
    expiresIn: {
      type: 'integer',
      description: 'Link expiry time in seconds (default: 3600, max: 604800)',
      minimum: 60,
      maximum: 604800,
      default: 3600,
    },
    maxDownloads: {
      type: 'integer',
      description: 'Optional maximum number of downloads',
      minimum: 1,
    },
  },
  required: ['fileId'],
};

/**
 * Skill store put tool JSON Schema
 */
const skillStorePutSchema: JSONSchema = {
  type: 'object',
  properties: {
    skill_id: {
      type: 'string',
      description: 'Identifier for the skill (alphanumeric, hyphens, underscores)',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-zA-Z0-9_-]+$',
    },
    collection: {
      type: 'string',
      description: 'Collection name for grouping items (default: _default)',
      maxLength: 200,
    },
    key: {
      type: 'string',
      description: 'Unique key within the collection for upsert behavior',
      maxLength: 500,
    },
    title: {
      type: 'string',
      description: 'Human-readable title',
      maxLength: 500,
    },
    summary: {
      type: 'string',
      description: 'Brief summary of the item',
      maxLength: 2000,
    },
    content: {
      type: 'string',
      description: 'Full text content',
      maxLength: 50000,
    },
    data: {
      type: 'object',
      description: 'Arbitrary JSON data payload (max 1MB serialized)',
    },
    media_url: {
      type: 'string',
      description: 'URL to associated media',
      format: 'uri',
    },
    media_type: {
      type: 'string',
      description: 'MIME type of associated media',
      maxLength: 100,
    },
    source_url: {
      type: 'string',
      description: 'URL of the original source',
      format: 'uri',
    },
    tags: {
      type: 'array',
      description: 'Tags for categorization (max 50)',
      items: { type: 'string', maxLength: 100 },
    },
    priority: {
      type: 'integer',
      description: 'Priority value (0-100)',
      minimum: 0,
      maximum: 100,
    },
    expires_at: {
      type: 'string',
      description: 'Expiry date in ISO 8601 format',
      format: 'date-time',
    },
    pinned: {
      type: 'boolean',
      description: 'Whether the item is pinned',
    },
    user_email: {
      type: 'string',
      description: 'Email of the user who owns this item',
      format: 'email',
    },
  },
  required: ['skill_id'],
};

/**
 * Skill store get tool JSON Schema
 */
const skillStoreGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'UUID of the item to retrieve',
      format: 'uuid',
    },
    skill_id: {
      type: 'string',
      description: 'Skill identifier (used with key for composite lookup)',
      maxLength: 100,
    },
    collection: {
      type: 'string',
      description: 'Collection name (used with skill_id + key)',
      maxLength: 200,
    },
    key: {
      type: 'string',
      description: 'Key within the collection (used with skill_id for composite lookup)',
      maxLength: 500,
    },
  },
};

/**
 * Skill store list tool JSON Schema
 */
const skillStoreListSchema: JSONSchema = {
  type: 'object',
  properties: {
    skill_id: {
      type: 'string',
      description: 'Skill identifier to list items for',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-zA-Z0-9_-]+$',
    },
    collection: {
      type: 'string',
      description: 'Filter by collection name',
      maxLength: 200,
    },
    status: {
      type: 'string',
      description: 'Filter by item status',
      enum: ['active', 'archived', 'processing'],
    },
    tags: {
      type: 'array',
      description: 'Filter by tags',
      items: { type: 'string', maxLength: 100 },
    },
    since: {
      type: 'string',
      description: 'Only return items updated after this ISO 8601 date',
      format: 'date-time',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of items to return',
      minimum: 1,
      maximum: 200,
      default: 50,
    },
    offset: {
      type: 'integer',
      description: 'Number of items to skip for pagination',
      minimum: 0,
    },
    order_by: {
      type: 'string',
      description: 'Field to order results by',
      enum: ['created_at', 'updated_at', 'title', 'priority'],
    },
    user_email: {
      type: 'string',
      description: 'Filter by user email',
      format: 'email',
    },
  },
  required: ['skill_id'],
};

/**
 * Skill store delete tool JSON Schema
 */
const skillStoreDeleteSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'UUID of the item to delete',
      format: 'uuid',
    },
    skill_id: {
      type: 'string',
      description: 'Skill identifier (used with key for composite lookup)',
      maxLength: 100,
    },
    collection: {
      type: 'string',
      description: 'Collection name (used with skill_id + key)',
      maxLength: 200,
    },
    key: {
      type: 'string',
      description: 'Key within the collection (used with skill_id for composite lookup)',
      maxLength: 500,
    },
  },
};

/**
 * Skill store search tool JSON Schema
 */
const skillStoreSearchSchema: JSONSchema = {
  type: 'object',
  properties: {
    skill_id: {
      type: 'string',
      description: 'Skill identifier to search within',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-zA-Z0-9_-]+$',
    },
    query: {
      type: 'string',
      description: 'Search query text',
      minLength: 1,
    },
    collection: {
      type: 'string',
      description: 'Filter by collection name',
      maxLength: 200,
    },
    tags: {
      type: 'array',
      description: 'Filter by tags',
      items: { type: 'string', maxLength: 100 },
    },
    semantic: {
      type: 'boolean',
      description: 'Use semantic/vector search instead of full-text',
    },
    min_similarity: {
      type: 'number',
      description: 'Minimum similarity threshold for semantic search (0-1)',
      minimum: 0,
      maximum: 1,
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of results to return',
      minimum: 1,
      maximum: 200,
    },
    user_email: {
      type: 'string',
      description: 'Filter by user email',
      format: 'email',
    },
  },
  required: ['skill_id', 'query'],
};

/**
 * Skill store collections tool JSON Schema
 */
const skillStoreCollectionsSchema: JSONSchema = {
  type: 'object',
  properties: {
    skill_id: {
      type: 'string',
      description: 'Skill identifier to list collections for',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-zA-Z0-9_-]+$',
    },
    user_email: {
      type: 'string',
      description: 'Filter by user email',
      format: 'email',
    },
  },
  required: ['skill_id'],
};

/**
 * Skill store aggregate tool JSON Schema
 */
const skillStoreAggregateSchema: JSONSchema = {
  type: 'object',
  properties: {
    skill_id: {
      type: 'string',
      description: 'Skill identifier to aggregate',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-zA-Z0-9_-]+$',
    },
    collection: {
      type: 'string',
      description: 'Filter by collection name',
      maxLength: 200,
    },
    operation: {
      type: 'string',
      description: 'Aggregation operation to perform',
      enum: ['count', 'count_by_tag', 'count_by_status', 'latest', 'oldest'],
    },
    since: {
      type: 'string',
      description: 'Only include items after this ISO 8601 date',
      format: 'date-time',
    },
    until: {
      type: 'string',
      description: 'Only include items before this ISO 8601 date',
      format: 'date-time',
    },
    user_email: {
      type: 'string',
      description: 'Filter by user email',
      format: 'email',
    },
  },
  required: ['skill_id', 'operation'],
};

/**
 * Create tool execution handlers
 */
function createToolHandlers(state: PluginState) {
  const { config, logger, apiClient, userId } = state;

  return {
    async memory_recall(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        query,
        limit = config.maxRecallMemories,
        category,
        tags,
        relationship_id,
      } = params as {
        query: string;
        limit?: number;
        category?: string;
        tags?: string[];
        relationship_id?: string;
      };

      try {
        const queryParams = new URLSearchParams({ q: query, limit: String(limit) });
        if (category) queryParams.set('category', category);
        if (tags && tags.length > 0) queryParams.set('tags', tags.join(','));
        if (relationship_id) queryParams.set('relationship_id', relationship_id);

        const response = await apiClient.get<{ memories: Array<{ id: string; content: string; category: string; score?: number }> }>(
          `/api/memories/search?${queryParams}`,
          { userId },
        );

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const memories = response.data.memories ?? [];
        const content = memories.length > 0 ? memories.map((m) => `- [${m.category}] ${m.content}`).join('\n') : 'No relevant memories found.';

        return {
          success: true,
          data: {
            content,
            details: { count: memories.length, memories, userId },
          },
        };
      } catch (error) {
        logger.error('memory_recall failed', { error });
        return { success: false, error: 'Failed to search memories' };
      }
    },

    async memory_store(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        content,
        category = 'fact',
        importance = 0.5,
        tags,
        relationship_id,
      } = params as {
        content: string;
        category?: string;
        importance?: number;
        tags?: string[];
        relationship_id?: string;
      };

      try {
        const payload: Record<string, unknown> = { content, category, importance };
        if (tags && tags.length > 0) payload.tags = tags;
        if (relationship_id) payload.relationship_id = relationship_id;

        const response = await apiClient.post<{ id: string }>('/api/memories', payload, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Memory stored successfully (ID: ${response.data.id})`,
            details: { id: response.data.id, userId },
          },
        };
      } catch (error) {
        logger.error('memory_store failed', { error });
        return { success: false, error: 'Failed to store memory' };
      }
    },

    async memory_forget(params: Record<string, unknown>): Promise<ToolResult> {
      const { memoryId, query } = params as { memoryId?: string; query?: string };

      try {
        if (memoryId) {
          const response = await apiClient.delete(`/api/memories/${memoryId}`, { userId });
          if (!response.success) {
            return { success: false, error: response.error.message };
          }
          return {
            success: true,
            data: { content: `Memory ${memoryId} forgotten successfully` },
          };
        }

        if (query) {
          const response = await apiClient.post<{ deleted: number }>('/api/memories/forget', { query }, { userId });
          if (!response.success) {
            return { success: false, error: response.error.message };
          }
          return {
            success: true,
            data: {
              content: `Forgotten ${response.data.deleted} matching memories`,
              details: { deletedCount: response.data.deleted },
            },
          };
        }

        return { success: false, error: 'Either memoryId or query is required' };
      } catch (error) {
        logger.error('memory_forget failed', { error });
        return { success: false, error: 'Failed to forget memory' };
      }
    },

    async project_list(params: Record<string, unknown>): Promise<ToolResult> {
      const { status = 'active', limit = 10 } = params as { status?: string; limit?: number };

      try {
        const queryParams = new URLSearchParams({ limit: String(limit) });
        if (status !== 'all') queryParams.set('status', status);

        const response = await apiClient.get<{ projects: Array<{ id: string; name: string; status: string }> }>(`/api/projects?${queryParams}`, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const projects = response.data.projects ?? [];
        const content = projects.length > 0 ? projects.map((p) => `- ${p.name} (${p.status})`).join('\n') : 'No projects found.';

        return {
          success: true,
          data: { content, details: { count: projects.length, projects } },
        };
      } catch (error) {
        logger.error('project_list failed', { error });
        return { success: false, error: 'Failed to list projects' };
      }
    },

    async project_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { projectId } = params as { projectId: string };

      try {
        const response = await apiClient.get<{ id: string; name: string; description?: string; status: string }>(`/api/projects/${projectId}`, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const project = response.data;
        return {
          success: true,
          data: {
            content: `Project: ${project.name}\nStatus: ${project.status}\n${project.description || ''}`,
            details: { project },
          },
        };
      } catch (error) {
        logger.error('project_get failed', { error });
        return { success: false, error: 'Failed to get project' };
      }
    },

    async project_create(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        name,
        description,
        status = 'active',
      } = params as {
        name: string;
        description?: string;
        status?: string;
      };

      try {
        const response = await apiClient.post<{ id: string }>('/api/projects', { name, description, status }, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Project "${name}" created successfully (ID: ${response.data.id})`,
            details: { id: response.data.id },
          },
        };
      } catch (error) {
        logger.error('project_create failed', { error });
        return { success: false, error: 'Failed to create project' };
      }
    },

    async todo_list(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        projectId,
        status = 'pending',
        limit = 20,
      } = params as {
        projectId?: string;
        status?: string;
        limit?: number;
      };

      try {
        const queryParams = new URLSearchParams({ limit: String(limit) });
        if (status !== 'all') queryParams.set('status', status);
        if (projectId) queryParams.set('projectId', projectId);

        const response = await apiClient.get<{ todos: Array<{ id: string; title: string; status: string }> }>(`/api/todos?${queryParams}`, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const todos = response.data.todos ?? [];
        const content = todos.length > 0 ? todos.map((t) => `- [${t.status}] ${t.title}`).join('\n') : 'No todos found.';

        return {
          success: true,
          data: { content, details: { count: todos.length, todos } },
        };
      } catch (error) {
        logger.error('todo_list failed', { error });
        return { success: false, error: 'Failed to list todos' };
      }
    },

    async todo_create(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        title,
        description,
        projectId,
        priority = 'medium',
        dueDate,
      } = params as {
        title: string;
        description?: string;
        projectId?: string;
        priority?: string;
        dueDate?: string;
      };

      try {
        const response = await apiClient.post<{ id: string }>('/api/todos', { title, description, projectId, priority, dueDate }, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Todo "${title}" created successfully (ID: ${response.data.id})`,
            details: { id: response.data.id },
          },
        };
      } catch (error) {
        logger.error('todo_create failed', { error });
        return { success: false, error: 'Failed to create todo' };
      }
    },

    async todo_complete(params: Record<string, unknown>): Promise<ToolResult> {
      const { todoId } = params as { todoId: string };

      try {
        const response = await apiClient.patch<{ id: string }>(`/api/todos/${todoId}`, { status: 'completed' }, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: { content: `Todo ${todoId} marked as complete` },
        };
      } catch (error) {
        logger.error('todo_complete failed', { error });
        return { success: false, error: 'Failed to complete todo' };
      }
    },

    async contact_search(params: Record<string, unknown>): Promise<ToolResult> {
      const { query, limit = 10 } = params as { query: string; limit?: number };

      try {
        const queryParams = new URLSearchParams({ q: query, limit: String(limit) });
        const response = await apiClient.get<{ contacts: Array<{ id: string; name: string; email?: string }> }>(`/api/contacts/search?${queryParams}`, {
          userId,
        });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const contacts = response.data.contacts ?? [];
        const content = contacts.length > 0 ? contacts.map((c) => `- ${c.name}${c.email ? ` (${c.email})` : ''}`).join('\n') : 'No contacts found.';

        return {
          success: true,
          data: { content, details: { count: contacts.length, contacts } },
        };
      } catch (error) {
        logger.error('contact_search failed', { error });
        return { success: false, error: 'Failed to search contacts' };
      }
    },

    async contact_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { contactId } = params as { contactId: string };

      try {
        const response = await apiClient.get<{ id: string; name: string; email?: string; phone?: string; notes?: string }>(`/api/contacts/${contactId}`, {
          userId,
        });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const contact = response.data;
        const lines = [`Contact: ${contact.name}`];
        if (contact.email) lines.push(`Email: ${contact.email}`);
        if (contact.phone) lines.push(`Phone: ${contact.phone}`);
        if (contact.notes) lines.push(`Notes: ${contact.notes}`);

        return {
          success: true,
          data: { content: lines.join('\n'), details: { contact } },
        };
      } catch (error) {
        logger.error('contact_get failed', { error });
        return { success: false, error: 'Failed to get contact' };
      }
    },

    async contact_create(params: Record<string, unknown>): Promise<ToolResult> {
      const { name, email, phone, notes } = params as {
        name: string;
        email?: string;
        phone?: string;
        notes?: string;
      };

      try {
        const response = await apiClient.post<{ id: string }>('/api/contacts', { name, email, phone, notes }, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Contact "${name}" created successfully (ID: ${response.data.id})`,
            details: { id: response.data.id },
          },
        };
      } catch (error) {
        logger.error('contact_create failed', { error });
        return { success: false, error: 'Failed to create contact' };
      }
    },

    async sms_send(params: Record<string, unknown>): Promise<ToolResult> {
      const { to, body, idempotencyKey } = params as {
        to: string;
        body: string;
        idempotencyKey?: string;
      };

      // Check Twilio configuration
      if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioPhoneNumber) {
        return {
          success: false,
          error: 'Twilio is not configured. Please configure Twilio credentials.',
        };
      }

      // Validate E.164 format
      const e164Regex = /^\+[1-9]\d{1,14}$/;
      if (!e164Regex.test(to)) {
        return {
          success: false,
          error: 'to: Phone number must be in E.164 format (e.g., +15551234567)',
        };
      }

      // Validate body length
      if (!body || body.length === 0) {
        return {
          success: false,
          error: 'body: Message body cannot be empty',
        };
      }
      if (body.length > 1600) {
        return {
          success: false,
          error: 'body: Message body must be 1600 characters or less',
        };
      }

      logger.info('sms_send invoked', {
        userId,
        bodyLength: body.length,
        hasIdempotencyKey: !!idempotencyKey,
      });

      try {
        const response = await apiClient.post<{
          messageId: string;
          threadId?: string;
          status: string;
        }>('/api/twilio/sms/send', { to, body, idempotencyKey }, { userId });

        if (!response.success) {
          logger.error('sms_send API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to send SMS',
          };
        }

        const { messageId, threadId, status } = response.data;

        logger.debug('sms_send completed', {
          userId,
          messageId,
          status,
        });

        return {
          success: true,
          data: {
            content: `SMS sent successfully (ID: ${messageId}, Status: ${status})`,
            details: { messageId, threadId, status, userId },
          },
        };
      } catch (error) {
        logger.error('sms_send failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });

        // Sanitize error message (remove phone numbers for privacy)
        let errorMessage = 'An unexpected error occurred while sending SMS.';
        if (error instanceof Error) {
          errorMessage = error.message.replace(/\+\d{1,15}/g, '[phone]');
        }

        return {
          success: false,
          error: errorMessage,
        };
      }
    },

    async email_send(params: Record<string, unknown>): Promise<ToolResult> {
      const { to, subject, body, htmlBody, threadId, idempotencyKey } = params as {
        to: string;
        subject: string;
        body: string;
        htmlBody?: string;
        threadId?: string;
        idempotencyKey?: string;
      };

      // Check Postmark configuration
      if (!config.postmarkToken || !config.postmarkFromEmail) {
        return {
          success: false,
          error: 'Postmark is not configured. Please configure Postmark credentials.',
        };
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(to)) {
        return {
          success: false,
          error: 'to: Invalid email address format',
        };
      }

      // Validate subject
      if (!subject || subject.length === 0) {
        return {
          success: false,
          error: 'subject: Subject cannot be empty',
        };
      }
      if (subject.length > 998) {
        return {
          success: false,
          error: 'subject: Subject must be 998 characters or less',
        };
      }

      // Validate body
      if (!body || body.length === 0) {
        return {
          success: false,
          error: 'body: Email body cannot be empty',
        };
      }

      logger.info('email_send invoked', {
        userId,
        subjectLength: subject.length,
        bodyLength: body.length,
        hasHtmlBody: !!htmlBody,
        hasThreadId: !!threadId,
        hasIdempotencyKey: !!idempotencyKey,
      });

      try {
        const response = await apiClient.post<{
          messageId: string;
          threadId?: string;
          status: string;
        }>('/api/postmark/email/send', { to, subject, body, htmlBody, threadId, idempotencyKey }, { userId });

        if (!response.success) {
          logger.error('email_send API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to send email',
          };
        }

        const { messageId, threadId: responseThreadId, status } = response.data;

        logger.debug('email_send completed', {
          userId,
          messageId,
          status,
        });

        return {
          success: true,
          data: {
            content: `Email sent successfully (ID: ${messageId}, Status: ${status})`,
            details: { messageId, threadId: responseThreadId, status, userId },
          },
        };
      } catch (error) {
        logger.error('email_send failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });

        // Sanitize error message (remove email addresses for privacy)
        let errorMessage = 'An unexpected error occurred while sending email.';
        if (error instanceof Error) {
          errorMessage = error.message.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');
        }

        return {
          success: false,
          error: errorMessage,
        };
      }
    },

    async message_search(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        query,
        channel = 'all',
        contactId,
        limit = 10,
        includeThread = false,
      } = params as {
        query: string;
        channel?: string;
        contactId?: string;
        limit?: number;
        includeThread?: boolean;
      };

      // Validate query
      if (!query || query.length === 0) {
        return {
          success: false,
          error: 'query: Search query cannot be empty',
        };
      }

      logger.info('message_search invoked', {
        userId,
        queryLength: query.length,
        channel,
        hasContactId: !!contactId,
        limit,
        includeThread,
      });

      try {
        // Build query parameters
        const queryParams = new URLSearchParams();
        queryParams.set('q', query);
        queryParams.set('types', 'message');
        queryParams.set('limit', String(limit));

        if (channel !== 'all') {
          queryParams.set('channel', channel);
        }
        if (contactId) {
          queryParams.set('contactId', contactId);
        }
        if (includeThread) {
          queryParams.set('includeThread', 'true');
        }

        const response = await apiClient.get<{
          results: Array<{
            id: string;
            body: string;
            direction: 'inbound' | 'outbound';
            channel: string;
            contactName?: string;
            timestamp: string;
            score: number;
          }>;
          total: number;
        }>(`/api/search?${queryParams}`, { userId });

        if (!response.success) {
          logger.error('message_search API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search messages',
          };
        }

        const { results, total } = response.data;

        // Transform results
        const messages = results.map((r) => ({
          id: r.id,
          body: r.body,
          direction: r.direction,
          channel: r.channel,
          contactName: r.contactName,
          timestamp: r.timestamp,
          similarity: r.score,
        }));

        logger.debug('message_search completed', {
          userId,
          resultCount: messages.length,
          total,
        });

        // Format content for display
        const content =
          messages.length > 0
            ? messages
                .map((m) => {
                  const prefix = m.direction === 'inbound' ? '←' : '→';
                  const contact = m.contactName || 'Unknown';
                  const similarity = `(${Math.round(m.similarity * 100)}%)`;
                  return `${prefix} [${m.channel}] ${contact} ${similarity}: ${m.body.substring(0, 100)}${m.body.length > 100 ? '...' : ''}`;
                })
                .join('\n')
            : 'No messages found matching your query.';

        return {
          success: true,
          data: {
            content,
            details: { messages, total, userId },
          },
        };
      } catch (error) {
        logger.error('message_search failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while searching messages.',
        };
      }
    },

    async thread_list(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        channel,
        contactId,
        limit = 20,
      } = params as {
        channel?: string;
        contactId?: string;
        limit?: number;
      };

      logger.info('thread_list invoked', {
        userId,
        channel,
        hasContactId: !!contactId,
        limit,
      });

      try {
        const queryParams = new URLSearchParams();
        queryParams.set('limit', String(limit));

        if (channel) {
          queryParams.set('channel', channel);
        }
        if (contactId) {
          queryParams.set('contactId', contactId);
        }

        const response = await apiClient.get<{
          threads: Array<{
            id: string;
            channel: string;
            contactName?: string;
            endpointValue: string;
            messageCount: number;
            lastMessageAt?: string;
          }>;
          total: number;
        }>(`/api/threads?${queryParams}`, { userId });

        if (!response.success) {
          logger.error('thread_list API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to list threads',
          };
        }

        const { threads, total } = response.data;

        logger.debug('thread_list completed', {
          userId,
          threadCount: threads.length,
          total,
        });

        const content =
          threads.length > 0
            ? threads
                .map((t) => {
                  const contact = t.contactName || t.endpointValue;
                  const msgCount = `${t.messageCount} message${t.messageCount !== 1 ? 's' : ''}`;
                  return `[${t.channel}] ${contact} - ${msgCount}`;
                })
                .join('\n')
            : 'No threads found.';

        return {
          success: true,
          data: {
            content,
            details: { threads, total, userId },
          },
        };
      } catch (error) {
        logger.error('thread_list failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while listing threads.',
        };
      }
    },

    async thread_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { threadId, messageLimit = 50 } = params as {
        threadId: string;
        messageLimit?: number;
      };

      // Validate threadId
      if (!threadId || threadId.length === 0) {
        return {
          success: false,
          error: 'threadId: Thread ID is required',
        };
      }

      logger.info('thread_get invoked', {
        userId,
        threadId,
        messageLimit,
      });

      try {
        const queryParams = new URLSearchParams();
        queryParams.set('messageLimit', String(messageLimit));

        const response = await apiClient.get<{
          thread: {
            id: string;
            channel: string;
            contactName?: string;
            endpointValue?: string;
          };
          messages: Array<{
            id: string;
            direction: 'inbound' | 'outbound';
            body: string;
            subject?: string;
            deliveryStatus?: string;
            createdAt: string;
          }>;
        }>(`/api/threads/${threadId}?${queryParams}`, { userId });

        if (!response.success) {
          logger.error('thread_get API error', {
            userId,
            threadId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to get thread',
          };
        }

        const { thread, messages } = response.data;

        logger.debug('thread_get completed', {
          userId,
          threadId,
          messageCount: messages.length,
        });

        const contact = thread.contactName || thread.endpointValue || 'Unknown';
        const header = `Thread with ${contact} [${thread.channel}]`;

        const messageContent =
          messages.length > 0
            ? messages
                .map((m) => {
                  const prefix = m.direction === 'inbound' ? '←' : '→';
                  const timestamp = new Date(m.createdAt).toLocaleString();
                  return `${prefix} [${timestamp}] ${m.body}`;
                })
                .join('\n')
            : 'No messages in this thread.';

        const content = `${header}\n\n${messageContent}`;

        return {
          success: true,
          data: {
            content,
            details: { thread, messages, userId },
          },
        };
      } catch (error) {
        logger.error('thread_get failed', {
          userId,
          threadId,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while getting thread.',
        };
      }
    },

    async relationship_set(params: Record<string, unknown>): Promise<ToolResult> {
      const { contact_a, contact_b, relationship, notes } = params as {
        contact_a: string;
        contact_b: string;
        relationship: string;
        notes?: string;
      };

      if (!contact_a || !contact_b || !relationship) {
        return {
          success: false,
          error: 'contact_a, contact_b, and relationship are required',
        };
      }

      logger.info('relationship_set invoked', {
        userId,
        contactALength: contact_a.length,
        contactBLength: contact_b.length,
        relationshipLength: relationship.length,
        hasNotes: !!notes,
      });

      try {
        const body: Record<string, unknown> = {
          contactA: contact_a,
          contactB: contact_b,
          relationshipType: relationship,
        };
        if (notes) {
          body.notes = notes;
        }

        const response = await apiClient.post<{
          relationship: { id: string };
          contactA: { id: string; displayName: string };
          contactB: { id: string; displayName: string };
          relationshipType: { id: string; name: string; label: string };
          created: boolean;
        }>('/api/relationships/set', body, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const { relationship: rel, contactA, contactB, relationshipType, created } = response.data;
        const content = created
          ? `Recorded: ${contactA.displayName} [${relationshipType.label}] ${contactB.displayName}`
          : `Relationship already exists: ${contactA.displayName} [${relationshipType.label}] ${contactB.displayName}`;

        return {
          success: true,
          data: {
            content,
            details: {
              relationshipId: rel.id,
              created,
              contactA,
              contactB,
              relationshipType,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('relationship_set failed', { error });
        return { success: false, error: 'Failed to set relationship' };
      }
    },

    async relationship_query(params: Record<string, unknown>): Promise<ToolResult> {
      const { contact, type_filter } = params as {
        contact: string;
        type_filter?: string;
      };

      if (!contact) {
        return {
          success: false,
          error: 'contact is required',
        };
      }

      logger.info('relationship_query invoked', {
        userId,
        contactLength: contact.length,
        hasTypeFilter: !!type_filter,
      });

      try {
        const queryParams = new URLSearchParams({ contact });
        if (type_filter) {
          queryParams.set('type_filter', type_filter);
        }

        const response = await apiClient.get<{
          contactId: string;
          contactName: string;
          relatedContacts: Array<{
            contactId: string;
            contactName: string;
            contactKind: string;
            relationshipId: string;
            relationshipTypeName: string;
            relationshipTypeLabel: string;
            isDirectional: boolean;
            notes: string | null;
          }>;
        }>(`/api/relationships/query?${queryParams}`, { userId });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const { contactId, contactName, relatedContacts } = response.data;

        if (relatedContacts.length === 0) {
          return {
            success: true,
            data: {
              content: `No relationships found for ${contactName}.`,
              details: { contactId, contactName, relatedContacts: [], userId },
            },
          };
        }

        const lines = [`Relationships for ${contactName}:`];
        for (const rel of relatedContacts) {
          const kindTag = rel.contactKind !== 'person' ? ` [${rel.contactKind}]` : '';
          const notesTag = rel.notes ? ` -- ${rel.notes}` : '';
          lines.push(`- ${rel.relationshipTypeLabel}: ${rel.contactName}${kindTag}${notesTag}`);
        }

        return {
          success: true,
          data: {
            content: lines.join('\n'),
            details: { contactId, contactName, relatedContacts, userId },
          },
        };
      } catch (error) {
        logger.error('relationship_query failed', { error });
        return { success: false, error: 'Failed to query relationships' };
      }
    },

    async file_share(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        fileId,
        expiresIn = 3600,
        maxDownloads,
      } = params as {
        fileId: string;
        expiresIn?: number;
        maxDownloads?: number;
      };

      if (!fileId) {
        return {
          success: false,
          error: 'fileId is required',
        };
      }

      // Validate expiresIn range
      if (expiresIn < 60 || expiresIn > 604800) {
        return {
          success: false,
          error: 'expiresIn must be between 60 and 604800 seconds (1 minute to 7 days)',
        };
      }

      logger.info('file_share invoked', {
        userId,
        fileId,
        expiresIn,
        maxDownloads,
      });

      try {
        const body: Record<string, unknown> = { expiresIn };
        if (maxDownloads !== undefined) {
          body.maxDownloads = maxDownloads;
        }

        const response = await apiClient.post<{
          shareToken: string;
          url: string;
          expiresAt: string;
          expiresIn: number;
          filename: string;
          contentType: string;
          sizeBytes: number;
        }>(`/api/files/${fileId}/share`, body, { userId });

        if (!response.success) {
          logger.error('file_share API error', {
            userId,
            fileId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to create share link',
          };
        }

        const { url, shareToken, expiresAt, filename, contentType, sizeBytes } = response.data;

        logger.debug('file_share completed', {
          userId,
          fileId,
          shareToken,
          expiresAt,
        });

        // Format file size
        const formatSize = (bytes: number): string => {
          if (bytes < 1024) return `${bytes} B`;
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
          if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
          return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        };

        // Format duration
        const formatDuration = (seconds: number): string => {
          if (seconds < 60) return `${seconds} seconds`;
          if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
          if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
          return `${Math.floor(seconds / 86400)} days`;
        };

        const expiryText = formatDuration(expiresIn);
        const sizeText = formatSize(sizeBytes);
        const downloadLimit = maxDownloads ? ` (max ${maxDownloads} downloads)` : '';

        return {
          success: true,
          data: {
            content: `Share link created for "${filename}" (${sizeText}). ` + `Valid for ${expiryText}${downloadLimit}.\n\nURL: ${url}`,
            details: {
              url,
              shareToken,
              expiresAt,
              expiresIn,
              filename,
              contentType,
              sizeBytes,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('file_share failed', {
          userId,
          fileId,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while creating share link.',
        };
      }
    },

    // Skill store tools: delegate to tool modules for Zod validation,
    // credential detection, text sanitization, and error sanitization (Issue #824)
    ...(() => {
      const toolOptions = { client: apiClient, logger, config, userId };
      const putTool = createSkillStorePutTool(toolOptions);
      const getTool = createSkillStoreGetTool(toolOptions);
      const listTool = createSkillStoreListTool(toolOptions);
      const deleteTool = createSkillStoreDeleteTool(toolOptions);
      const searchTool = createSkillStoreSearchTool(toolOptions);
      const collectionsTool = createSkillStoreCollectionsTool(toolOptions);
      const aggregateTool = createSkillStoreAggregateTool(toolOptions);

      return {
        skill_store_put: (params: Record<string, unknown>) => putTool.execute(params),
        skill_store_get: (params: Record<string, unknown>) => getTool.execute(params),
        skill_store_list: (params: Record<string, unknown>) => listTool.execute(params),
        skill_store_delete: (params: Record<string, unknown>) => deleteTool.execute(params),
        skill_store_search: (params: Record<string, unknown>) => searchTool.execute(params),
        skill_store_collections: (params: Record<string, unknown>) => collectionsTool.execute(params),
        skill_store_aggregate: (params: Record<string, unknown>) => aggregateTool.execute(params),
      };
    })(),
  };
}

/**
 * OpenClaw 2026 Plugin Registration Function
 *
 * This is the main entry point for the plugin using the OpenClaw API pattern.
 * Registers all tools, hooks, and CLI commands via the provided API object.
 */
export const registerOpenClaw: PluginInitializer = (api: OpenClawPluginApi) => {
  // Validate and resolve configuration synchronously.
  // OpenClaw's loader does NOT await the register function — it checks if the
  // result is thenable and logs a warning. All registrations must happen
  // synchronously during this call.
  const logger = api.logger ?? createLogger('openclaw-projects');

  // The SDK provides plugin-specific config via api.pluginConfig (from
  // plugins.entries.<id>.config). Fall back to api.config for older SDKs
  // or test environments that put plugin config there directly.
  const pluginCfg = api.pluginConfig ?? api.config;

  let rawConfig: RawPluginConfig;
  try {
    rawConfig = validateRawConfig(pluginCfg);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const issues = error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      logger.error(`[openclaw-projects] Invalid plugin configuration:\n${issues}`);
    } else {
      logger.error(`[openclaw-projects] Invalid plugin configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  let config: PluginConfig;
  try {
    config = resolveConfigSecretsSync(rawConfig);
  } catch (error: unknown) {
    logger.error(`[openclaw-projects] Failed to resolve secrets: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const apiClient = createApiClient({ config, logger });

  // Extract context and user ID
  const context = extractContext(api.runtime);
  const userId = getUserScopeKey(
    {
      agentId: context.agent.agentId,
      sessionKey: context.session.sessionId,
    },
    config.userScoping,
  );

  // Store plugin state
  const state: PluginState = { config, logger, apiClient, userId };

  // Create tool handlers
  const handlers = createToolHandlers(state);

  // Register all 27 tools with correct OpenClaw Gateway execute signature
  // Signature: (toolCallId: string, params: T, signal?: AbortSignal, onUpdate?: (partial: any) => void) => AgentToolResult
  const tools: ToolDefinition[] = [
    {
      name: 'memory_recall',
      description: 'Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.',
      parameters: memoryRecallSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.memory_recall(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'memory_store',
      description: 'Store a new memory for future reference. Use when the user shares important preferences, facts, or decisions.',
      parameters: memoryStoreSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.memory_store(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'memory_forget',
      description: 'Remove a memory by ID or search query. Use when information is outdated or the user requests deletion.',
      parameters: memoryForgetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.memory_forget(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'project_list',
      description: 'List projects for the user. Use to see what projects exist or filter by status.',
      parameters: projectListSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.project_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'project_get',
      description: 'Get details about a specific project. Use when you need full project information.',
      parameters: projectGetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.project_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'project_create',
      description: 'Create a new project. Use when the user wants to start tracking a new initiative.',
      parameters: projectCreateSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.project_create(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'todo_list',
      description: 'List todos, optionally filtered by project or status. Use to see pending tasks.',
      parameters: todoListSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.todo_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'todo_create',
      description: 'Create a new todo item. Use when the user wants to track a task.',
      parameters: todoCreateSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.todo_create(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'todo_complete',
      description: 'Mark a todo as complete. Use when a task is done.',
      parameters: todoCompleteSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.todo_complete(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_search',
      description: 'Search contacts by name, email, or other fields. Use to find people.',
      parameters: contactSearchSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_search(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_get',
      description: 'Get details about a specific contact. Use when you need full contact information.',
      parameters: contactGetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_create',
      description: 'Create a new contact. Use when the user mentions someone new to track.',
      parameters: contactCreateSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_create(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'sms_send',
      description:
        'Send an SMS message to a phone number. Use when you need to notify someone via text message. Requires the recipient phone number in E.164 format (e.g., +15551234567).',
      parameters: smsSendSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.sms_send(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'email_send',
      description: 'Send an email message. Use when you need to communicate via email. Requires the recipient email address, subject, and body.',
      parameters: emailSendSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.email_send(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'message_search',
      description:
        'Search message history semantically. Use when you need to find past conversations, messages about specific topics, or communications with contacts. Supports filtering by channel (SMS/email) and contact.',
      parameters: messageSearchSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.message_search(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'thread_list',
      description: 'List message threads (conversations). Use to see recent conversations with contacts. Can filter by channel (SMS/email) or contact.',
      parameters: threadListSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.thread_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'thread_get',
      description: 'Get a thread with its message history. Use to view the full conversation in a thread.',
      parameters: threadGetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.thread_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'relationship_set',
      description:
        "Record a relationship between two people, groups, or organisations. Examples: 'Troy is Alex\\'s partner', 'Sam is a member of The Kelly Household', 'Troy works for Acme Corp'. The system handles directionality and type matching automatically.",
      parameters: relationshipSetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.relationship_set(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'relationship_query',
      description:
        "Query a contact's relationships. Returns all relationships including family, partners, group memberships, professional connections, etc. Handles directional relationships automatically.",
      parameters: relationshipQuerySchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.relationship_query(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'file_share',
      description:
        'Generate a shareable download link for a file. Use when you need to share a file with someone outside the system. The link is time-limited and can be configured with an expiry time and optional download limit.',
      parameters: fileShareSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.file_share(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'skill_store_put',
      description:
        'Store or update data in the skill store. Use for persisting skill state, configuration, cached results, or any structured data. When a key is provided, existing items with the same (skill_id, collection, key) are updated.',
      parameters: skillStorePutSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.skill_store_put(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'skill_store_get',
      description:
        'Retrieve an item from the skill store by ID or by composite key (skill_id + collection + key). Returns the full item including data payload.',
      parameters: skillStoreGetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.skill_store_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'skill_store_list',
      description:
        'List items in the skill store with filtering and pagination. Requires skill_id. Can filter by collection, status, tags, date range, and user email.',
      parameters: skillStoreListSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.skill_store_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'skill_store_delete',
      description: 'Delete an item from the skill store by ID or by composite key (skill_id + collection + key). Performs a soft delete by default.',
      parameters: skillStoreDeleteSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.skill_store_delete(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'skill_store_search',
      description:
        'Search skill store items by text or semantic similarity. Use when looking for stored data, notes, or content by topic. Supports full-text search (default) and optional semantic/vector search with graceful fallback to text when embeddings are not available.',
      parameters: skillStoreSearchSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.skill_store_search(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'skill_store_collections',
      description: 'List all collections for a skill with item counts. Use to discover what data categories exist and how many items each collection contains.',
      parameters: skillStoreCollectionsSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.skill_store_collections(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'skill_store_aggregate',
      description:
        'Run simple aggregations on skill store items. Useful for understanding data volume, distribution, and boundaries. Operations: count, count_by_tag, count_by_status, latest, oldest.',
      parameters: skillStoreAggregateSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.skill_store_aggregate(params);
        return toAgentToolResult(result);
      },
    },
  ];

  for (const tool of tools) {
    api.registerTool(tool);
  }

  // Register hooks using api.on() (modern) with fallback to registerHook (legacy)
  // The auto-recall and auto-capture hooks are consolidated from hooks.ts
  // into this registration path using the correct OpenClaw hook contract.

  /** Default timeout for hook execution (5 seconds) */
  const HOOK_TIMEOUT_MS = 5000;

  if (config.autoRecall) {
    // Create the graph-aware auto-recall hook which traverses the user's
    // relationship graph for multi-scope context retrieval.
    // Falls back to basic memory search if the graph-aware endpoint is unavailable.
    const autoRecallHook = createGraphAwareRecallHook({
      client: apiClient,
      logger,
      config,
      userId,
      timeoutMs: HOOK_TIMEOUT_MS,
    });

    /**
     * before_agent_start handler: Extracts the user's prompt from the event,
     * performs semantic memory search, and returns { prependContext } to inject
     * relevant memories into the conversation.
     */
    const beforeAgentStartHandler = async (
      event: PluginHookBeforeAgentStartEvent,
      _ctx: PluginHookAgentContext,
    ): Promise<PluginHookBeforeAgentStartResult | undefined> => {
      logger.debug('Auto-recall hook triggered', {
        promptLength: event.prompt?.length ?? 0,
      });

      try {
        // Use the consolidated hook which has timeout protection and
        // uses the user's actual prompt for semantic search
        const result = await autoRecallHook({ prompt: event.prompt });

        if (result?.prependContext) {
          return { prependContext: result.prependContext };
        }
      } catch (error) {
        // Hook errors should never crash the agent
        logger.error('Auto-recall hook failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // Return undefined (void) when no context is available
    };

    if (typeof api.on === 'function') {
      // Modern registration: api.on('before_agent_start', handler)
      // Cast needed: our typed handler satisfies the runtime contract but
      // the generic api.on() signature uses (...args: unknown[]) => unknown
      api.on('before_agent_start', beforeAgentStartHandler as (...args: unknown[]) => unknown);
    } else {
      // Legacy fallback: api.registerHook('beforeAgentStart', handler)
      api.registerHook('beforeAgentStart', beforeAgentStartHandler as (event: unknown) => Promise<unknown>);
    }
  }

  if (config.autoCapture) {
    // Create the auto-capture hook using the consolidated hooks.ts implementation
    const autoCaptureHook = createAutoCaptureHook({
      client: apiClient,
      logger,
      config,
      userId,
      timeoutMs: HOOK_TIMEOUT_MS * 2, // Allow more time for capture (10s)
    });

    /**
     * agent_end handler: Extracts messages from the completed conversation,
     * filters sensitive content, and posts to the capture API for memory storage.
     */
    const agentEndHandler = async (event: PluginHookAgentEndEvent, _ctx: PluginHookAgentContext): Promise<void> => {
      logger.debug('Auto-capture hook triggered', {
        messageCount: event.messages?.length ?? 0,
        success: event.success,
      });

      try {
        // Convert the event messages to the format expected by the capture hook
        const messages = (event.messages ?? []).map((msg) => {
          if (typeof msg === 'object' && msg !== null) {
            const msgObj = msg as Record<string, unknown>;
            return {
              role: String(msgObj.role ?? 'unknown'),
              content: String(msgObj.content ?? ''),
            };
          }
          return { role: 'unknown', content: String(msg) };
        });

        await autoCaptureHook({ messages });
      } catch (error) {
        // Hook errors should never crash the agent
        logger.error('Auto-capture hook failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    if (typeof api.on === 'function') {
      // Modern registration: api.on('agent_end', handler)
      // Cast needed: our typed handler satisfies the runtime contract but
      // the generic api.on() signature uses (...args: unknown[]) => unknown
      api.on('agent_end', agentEndHandler as (...args: unknown[]) => unknown);
    } else {
      // Legacy fallback: api.registerHook('agentEnd', handler)
      api.registerHook('agentEnd', agentEndHandler as (event: unknown) => Promise<unknown>);
    }
  }

  // Register Gateway RPC methods (Issue #324)
  const gatewayMethods = createGatewayMethods({
    logger,
    apiClient,
    userId,
  });
  registerGatewayRpcMethods(api, gatewayMethods);

  // Register OAuth Gateway RPC methods (Issue #1054)
  const oauthGatewayMethods = createOAuthGatewayMethods({
    logger,
    apiClient,
    userId,
  });
  registerOAuthGatewayRpcMethods(api, oauthGatewayMethods);

  // Register background notification service (Issue #325)
  // Create a simple event emitter for notifications
  // In production, this would be provided by the OpenClaw runtime
  logger.warn('No runtime event emitter available — using stub. Notification events will be logged but not dispatched.');
  const eventEmitter = {
    emit: (event: string, payload: unknown) => {
      logger.debug('Notification event emitted (stub)', { event, payload });
    },
    on: (_event: string, _handler: (payload: unknown) => void) => {
      logger.debug('Event handler registered on stub emitter (will not fire)');
    },
    off: (_event: string, _handler: (payload: unknown) => void) => {
      logger.debug('Event handler removed from stub emitter');
    },
  };

  const notificationService = createNotificationService({
    logger,
    apiClient,
    userId,
    events: eventEmitter,
    config: {
      enabled: config.autoRecall, // Only enable if auto-recall is enabled
      pollIntervalMs: 30000,
    },
  });

  api.registerService(notificationService);

  // Register CLI commands
  api.registerCli(({ program }) => {
    program
      .command('status')
      .description('Show plugin status and statistics')
      .action(async () => {
        try {
          const response = await apiClient.get('/api/health', { userId });
          if (response.success) {
            console.log('Plugin Status: Connected');
          } else {
            console.error(`Plugin Status: Error - ${response.error.message}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Plugin Status: Error - Unable to connect: ${message}`);
        }
      });

    program
      .command('recall')
      .description('Recall memories matching a query')
      .action(async (...args: unknown[]) => {
        const query = typeof args[0] === 'string' ? args[0] : '';
        const options = (args[1] ?? {}) as { limit?: string };
        const result = await handlers.memory_recall({
          query,
          limit: options.limit ? Number.parseInt(options.limit, 10) : 5,
        });
        if (result.success && result.data) {
          console.log(result.data.content);
        } else {
          console.error('Error:', result.error);
        }
      });
  });

  logger.info('OpenClaw Projects plugin registered', {
    agentId: context.agent.agentId,
    sessionId: context.session.sessionId,
    userId,
    toolCount: tools.length,
    config: redactConfig(config),
  });
};

/** Default export for OpenClaw 2026 API compatibility */
export default registerOpenClaw;

/** Export JSON Schemas for external use */
export const schemas = {
  memoryRecall: memoryRecallSchema,
  memoryStore: memoryStoreSchema,
  memoryForget: memoryForgetSchema,
  projectList: projectListSchema,
  projectGet: projectGetSchema,
  projectCreate: projectCreateSchema,
  todoList: todoListSchema,
  todoCreate: todoCreateSchema,
  todoComplete: todoCompleteSchema,
  contactSearch: contactSearchSchema,
  contactGet: contactGetSchema,
  contactCreate: contactCreateSchema,
  smsSend: smsSendSchema,
  emailSend: emailSendSchema,
  messageSearch: messageSearchSchema,
  threadList: threadListSchema,
  threadGet: threadGetSchema,
  relationshipSet: relationshipSetSchema,
  relationshipQuery: relationshipQuerySchema,
  fileShare: fileShareSchema,
  skillStorePut: skillStorePutSchema,
  skillStoreGet: skillStoreGetSchema,
  skillStoreList: skillStoreListSchema,
  skillStoreDelete: skillStoreDeleteSchema,
  skillStoreSearch: skillStoreSearchSchema,
  skillStoreCollections: skillStoreCollectionsSchema,
  skillStoreAggregate: skillStoreAggregateSchema,
};
