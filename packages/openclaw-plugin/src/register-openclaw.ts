/**
 * OpenClaw 2026 Plugin Registration
 *
 * This module implements the OpenClaw Gateway plugin API pattern:
 * - Default export function taking `api` object
 * - Tools registered via `api.registerTool()`
 * - Hooks registered via `api.on()` (modern) or `api.registerHook()` (legacy fallback)
 * - CLI registered via `api.registerCli()`
 */

import { ZodError } from 'zod';
import { type ApiClient, createApiClient } from './api-client.js';
import { type PluginConfig, type RawPluginConfig, redactConfig, resolveConfigSecretsSync, resolveNamespaceConfig, validateRawConfig } from './config.js';
import { extractContext, getUserScopeKey, resolveAgentId } from './context.js';
import { createOAuthGatewayMethods, registerOAuthGatewayRpcMethods } from './gateway/oauth-rpc-methods.js';
import { createGatewayMethods, registerGatewayRpcMethods } from './gateway/rpc-methods.js';
import { createAutoCaptureHook, createGraphAwareRecallHook } from './hooks.js';
import { createLogger, type Logger } from './logger.js';
import { createNotificationService } from './services/notification-service.js';
import {
  createContextSearchTool,
  createLinksQueryTool,
  createLinksRemoveTool,
  createLinksSetTool,
  createProjectSearchTool,
  createSkillStoreAggregateTool,
  createSkillStoreCollectionsTool,
  createSkillStoreDeleteTool,
  createSkillStoreGetTool,
  createSkillStoreListTool,
  createSkillStorePutTool,
  createSkillStoreSearchTool,
  createApiOnboardTool,
  createApiRecallTool,
  createApiGetTool,
  createApiListTool,
  createApiUpdateTool,
  createApiCredentialManageTool,
  createApiRefreshTool,
  createApiRemoveTool,
  createApiRestoreTool,
  // Terminal tools (Issue #1858)
  createTerminalConnectionListTool,
  createTerminalConnectionCreateTool,
  createTerminalConnectionUpdateTool,
  createTerminalConnectionDeleteTool,
  createTerminalConnectionTestTool,
  createTerminalCredentialCreateTool,
  createTerminalCredentialListTool,
  createTerminalCredentialDeleteTool,
  createTerminalSessionStartTool,
  createTerminalSessionListTool,
  createTerminalSessionTerminateTool,
  createTerminalSessionInfoTool,
  createTerminalSendCommandTool,
  createTerminalSendKeysTool,
  createTerminalCapturePaneTool,
  createTerminalSearchTool,
  createTerminalAnnotateTool,
  createTerminalTunnelCreateTool,
  createTerminalTunnelListTool,
  createTerminalTunnelCloseTool,
} from './tools/index.js';
import { zodToJsonSchema } from './utils/zod-to-json-schema.js';
import type {
  AgentToolResult,
  JSONSchema,
  JSONSchemaProperty,
  OpenClawPluginApi,
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
  PluginHookBeforeAgentStartEvent,
  PluginHookBeforeAgentStartResult,
  PluginHookMessageReceivedEvent,
  PluginInitializer,
  ToolDefinition,
  ToolResult,
} from './types/openclaw-api.js';
import { autoLinkInboundMessage } from './utils/auto-linker.js';
import { blendScores, computeGeoScore, haversineDistanceKm } from './utils/geo.js';
import {
  createBoundaryMarkers,
  detectInjectionPatternsAsync,
  sanitizeMessageForContext,
  sanitizeMetadataField,
  wrapExternalMessage,
} from './utils/injection-protection.js';
import { injectionLogLimiter } from './utils/injection-log-rate-limiter.js';
import { reverseGeocode } from './utils/nominatim.js';

/** Plugin state stored during registration */
interface PluginState {
  config: PluginConfig;
  logger: Logger;
  apiClient: ApiClient;
  /** Resolved agent identifier (Issue #1657: renamed from user_id) */
  agentId: string;
  /** Agent email from runtime context for identity resolution (#1567, #1657: renamed from user_email) */
  agentEmail?: string;
  /** Resolved namespace config (Issue #1428). Mutable: recall may be updated by dynamic discovery (#1537). */
  resolvedNamespace: { default: string; recall: string[] };
  /** Whether static recall config was explicitly set (Issue #1537) */
  hasStaticRecall: boolean;
  /** Timestamp of last successful namespace refresh (Issue #1537) */
  lastNamespaceRefreshMs: number;
  /** Guard against concurrent refresh calls (Issue #1537) */
  refreshInFlight: boolean;
  /** Session key of the currently active session (Issue #1655) */
  activeSessionKey?: string;
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

/** Namespace property for store/create tools (Issue #1428) */
const namespaceProperty: JSONSchemaProperty = {
  type: 'string',
  description: 'Target namespace for this operation. Defaults to the agent\'s configured namespace.',
  pattern: '^[a-z0-9][a-z0-9._-]*$',
  maxLength: 63,
};

/** Namespaces property for query/list tools (Issue #1428) */
const namespacesProperty: JSONSchemaProperty = {
  type: 'array',
  description: 'Namespaces to search. Defaults to the agent\'s configured recall namespaces.',
  items: {
    type: 'string',
    pattern: '^[a-z0-9][a-z0-9._-]*$',
    maxLength: 63,
  },
};

/** Add namespace param to a store/create tool schema (Issue #1428) */
function withNamespace(schema: JSONSchema): JSONSchema {
  return {
    ...schema,
    properties: { ...schema.properties, namespace: namespaceProperty },
  };
}

/** Add namespaces param to a query/list tool schema (Issue #1428) */
function withNamespaces(schema: JSONSchema): JSONSchema {
  return {
    ...schema,
    properties: { ...schema.properties, namespaces: namespacesProperty },
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
      enum: ['preference', 'fact', 'decision', 'context', 'entity', 'other'],
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
    location: {
      type: 'object',
      description: 'Current location for geo-aware recall ranking',
      properties: {
        lat: { type: 'number', minimum: -90, maximum: 90 },
        lng: { type: 'number', minimum: -180, maximum: 180 },
      },
      required: ['lat', 'lng'],
    },
    location_radius_km: {
      type: 'number',
      description: 'Filter memories within this radius (km) of the given location',
      minimum: 0.1,
      maximum: 100,
    },
    location_weight: {
      type: 'number',
      description: 'Weight for geo scoring (0 = content only, 1 = geo only)',
      minimum: 0,
      maximum: 1,
      default: 0.3,
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
    text: {
      type: 'string',
      description: 'Information to remember',
      minLength: 1,
      maxLength: 10000,
    },
    content: {
      type: 'string',
      description: 'Alias for text (backwards compatibility)',
      minLength: 1,
      maxLength: 10000,
    },
    importance: {
      type: 'number',
      description: 'Importance 0-1 (default: 0.7)',
      minimum: 0,
      maximum: 1,
      default: 0.7,
    },
    category: {
      type: 'string',
      description: 'Memory category',
      enum: ['preference', 'fact', 'decision', 'context', 'entity', 'other'],
      default: 'other',
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
    location: {
      type: 'object',
      description: 'Geographic location to associate with this memory',
      properties: {
        lat: {
          type: 'number',
          description: 'Latitude (-90 to 90)',
          minimum: -90,
          maximum: 90,
        },
        lng: {
          type: 'number',
          description: 'Longitude (-180 to 180)',
          minimum: -180,
          maximum: 180,
        },
        address: {
          type: 'string',
          description: 'Street address (max 500 chars)',
          maxLength: 500,
        },
        place_label: {
          type: 'string',
          description: 'Short place name (max 200 chars)',
          maxLength: 200,
        },
      },
      required: ['lat', 'lng'],
    },
  },
  required: ['text'],
};

/**
 * Memory forget tool JSON Schema
 */
const memoryForgetSchema: JSONSchema = {
  type: 'object',
  properties: {
    memory_id: {
      type: 'string',
      description: 'ID of the memory to forget (full UUID)',
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
    project_id: {
      type: 'string',
      description: 'Project ID to retrieve',
      format: 'uuid',
    },
  },
  required: ['project_id'],
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
    project_id: {
      type: 'string',
      description: 'Filter by project ID',
      format: 'uuid',
    },
    completed: {
      type: 'boolean',
      description: 'Filter by completion status. true = completed only, false = active only, omit = all.',
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of todos to return',
      minimum: 1,
      maximum: 200,
      default: 50,
    },
    offset: {
      type: 'integer',
      description: 'Offset for pagination',
      minimum: 0,
      default: 0,
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
    project_id: {
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
 * Todo search tool JSON Schema (Issue #1216)
 */
const todoSearchSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Natural language search query for finding work items',
      minLength: 1,
      maxLength: 1000,
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of results to return',
      minimum: 1,
      maximum: 50,
      default: 10,
    },
    kind: {
      type: 'string',
      description: 'Filter by work item kind',
      enum: ['task', 'project', 'initiative', 'epic', 'issue'],
    },
    status: {
      type: 'string',
      description: 'Filter by status (e.g., open, completed, in_progress)',
      maxLength: 50,
    },
  },
  required: ['query'],
};

/**
 * Project search tool JSON Schema (Issue #1217)
 */
const projectSearchSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Natural language search query for finding projects',
      minLength: 1,
      maxLength: 1000,
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of results to return',
      minimum: 1,
      maximum: 50,
      default: 10,
    },
    status: {
      type: 'string',
      description: 'Filter by project status',
      enum: ['active', 'completed', 'archived'],
    },
  },
  required: ['query'],
};

/**
 * Context search tool JSON Schema (Issue #1219)
 */
const contextSearchSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Natural language search query across memories, todos, projects, and messages',
      minLength: 1,
      maxLength: 1000,
    },
    entity_types: {
      type: 'array',
      description: 'Filter to specific entity types. Defaults to all (memory, todo, project, message).',
      items: {
        type: 'string',
        enum: ['memory', 'todo', 'project', 'message'],
      },
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of results to return',
      minimum: 1,
      maximum: 50,
      default: 10,
    },
  },
  required: ['query'],
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
    contact_id: {
      type: 'string',
      description: 'Contact ID to retrieve',
      format: 'uuid',
    },
  },
  required: ['contact_id'],
};

/**
 * Contact create tool JSON Schema
 */
const contactCreateSchema: JSONSchema = {
  type: 'object',
  properties: {
    display_name: {
      type: 'string',
      description: 'Full display name (required for organizations/groups, optional for persons if given_name or family_name provided)',
      maxLength: 200,
    },
    given_name: {
      type: 'string',
      description: 'Given (first) name',
      maxLength: 100,
    },
    family_name: {
      type: 'string',
      description: 'Family (last) name',
      maxLength: 100,
    },
    nickname: {
      type: 'string',
      description: 'Nickname or short name',
      maxLength: 100,
    },
    contact_kind: {
      type: 'string',
      description: 'Contact type',
      enum: ['person', 'organisation', 'group', 'agent'],
      default: 'person',
    },
    email: {
      type: 'string',
      description: 'Primary email address (creates an email endpoint)',
      format: 'email',
    },
    phone: {
      type: 'string',
      description: 'Primary phone number (creates a phone endpoint)',
    },
    notes: {
      type: 'string',
      description: 'Notes about the contact',
      maxLength: 5000,
    },
    tags: {
      type: 'array',
      description: 'Tags to assign to the contact (max 20)',
      items: { type: 'string', maxLength: 100 },
    },
  },
  required: [],
};

/**
 * Contact update tool JSON Schema (#1600)
 */
const contactUpdateSchema: JSONSchema = {
  type: 'object',
  properties: {
    contact_id: {
      type: 'string',
      description: 'ID of the contact to update',
      format: 'uuid',
    },
    display_name: {
      type: 'string',
      description: 'Updated display name',
      maxLength: 200,
    },
    given_name: { type: 'string', maxLength: 100 },
    family_name: { type: 'string', maxLength: 100 },
    nickname: { type: 'string', maxLength: 100 },
    notes: { type: 'string', maxLength: 5000 },
    tags: {
      type: 'array',
      description: 'Replace all tags (empty array removes all)',
      items: { type: 'string', maxLength: 100 },
    },
  },
  required: ['contact_id'],
};

/**
 * Contact merge tool JSON Schema (#1600)
 */
const contactMergeSchema: JSONSchema = {
  type: 'object',
  properties: {
    survivor_id: {
      type: 'string',
      description: 'ID of the contact to keep (survivor)',
      format: 'uuid',
    },
    loser_id: {
      type: 'string',
      description: 'ID of the contact to merge into the survivor (will be soft-deleted)',
      format: 'uuid',
    },
  },
  required: ['survivor_id', 'loser_id'],
};

/**
 * Contact tag add tool JSON Schema (#1600)
 */
const contactTagAddSchema: JSONSchema = {
  type: 'object',
  properties: {
    contact_id: {
      type: 'string',
      description: 'Contact ID',
      format: 'uuid',
    },
    tags: {
      type: 'array',
      description: 'Tags to add (1–20 tags)',
      items: { type: 'string', maxLength: 100 },
    },
  },
  required: ['contact_id', 'tags'],
};

/**
 * Contact tag remove tool JSON Schema (#1600)
 */
const contactTagRemoveSchema: JSONSchema = {
  type: 'object',
  properties: {
    contact_id: {
      type: 'string',
      description: 'Contact ID',
      format: 'uuid',
    },
    tag: {
      type: 'string',
      description: 'Tag to remove',
      maxLength: 100,
    },
  },
  required: ['contact_id', 'tag'],
};

/**
 * Contact resolve tool JSON Schema (#1601)
 * Resolves a sender identity (phone, email, name) to a contact match.
 */
const contactResolveSchema: JSONSchema = {
  type: 'object',
  properties: {
    phone: {
      type: 'string',
      description: 'Sender phone number to resolve',
    },
    email: {
      type: 'string',
      description: 'Sender email address to resolve',
      format: 'email',
    },
    name: {
      type: 'string',
      description: 'Sender name for fuzzy matching',
      maxLength: 200,
    },
  },
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
    idempotency_key: {
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
    html_body: {
      type: 'string',
      description: 'Optional HTML email body',
    },
    thread_id: {
      type: 'string',
      description: 'Optional thread ID for replies',
    },
    idempotency_key: {
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
    contact_id: {
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
    include_thread: {
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
    contact_id: {
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
    thread_id: {
      type: 'string',
      description: 'Thread ID to retrieve',
    },
    message_limit: {
      type: 'integer',
      description: 'Maximum messages to return',
      minimum: 1,
      maximum: 200,
      default: 50,
    },
  },
  required: ['thread_id'],
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
    file_id: {
      type: 'string',
      description: 'The file ID to create a share link for',
      format: 'uuid',
    },
    expires_in: {
      type: 'integer',
      description: 'Link expiry time in seconds (default: 3600, max: 604800)',
      minimum: 60,
      maximum: 604800,
      default: 3600,
    },
    max_downloads: {
      type: 'integer',
      description: 'Optional maximum number of downloads',
      minimum: 1,
    },
  },
  required: ['file_id'],
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
 * Entity linking tool JSON Schemas (Issue #1220)
 */
const linksSetSchema: JSONSchema = {
  type: 'object',
  properties: {
    source_type: {
      type: 'string',
      description: 'Type of the source entity',
      enum: ['memory', 'todo', 'project', 'contact'],
    },
    source_id: {
      type: 'string',
      description: 'UUID of the source entity',
      format: 'uuid',
    },
    target_type: {
      type: 'string',
      description: 'Type of the target entity or external reference',
      enum: ['memory', 'todo', 'project', 'contact', 'github_issue', 'url'],
    },
    target_ref: {
      type: 'string',
      description: 'Reference to the target: UUID for internal entities, "owner/repo#N" for GitHub issues, URL for urls',
      minLength: 1,
    },
    label: {
      type: 'string',
      description: 'Optional label describing the link (e.g., "spawned from", "tracks", "related to")',
      maxLength: 100,
    },
  },
  required: ['source_type', 'source_id', 'target_type', 'target_ref'],
};

const linksQuerySchema: JSONSchema = {
  type: 'object',
  properties: {
    entity_type: {
      type: 'string',
      description: 'Type of the entity to query links for',
      enum: ['memory', 'todo', 'project', 'contact'],
    },
    entity_id: {
      type: 'string',
      description: 'UUID of the entity to query links for',
      format: 'uuid',
    },
    link_types: {
      type: 'array',
      description: 'Optional filter to only return links to specific entity types',
      items: {
        type: 'string',
        enum: ['memory', 'todo', 'project', 'contact', 'github_issue', 'url'],
      },
    },
  },
  required: ['entity_type', 'entity_id'],
};

const linksRemoveSchema: JSONSchema = {
  type: 'object',
  properties: {
    source_type: {
      type: 'string',
      description: 'Type of the source entity',
      enum: ['memory', 'todo', 'project', 'contact'],
    },
    source_id: {
      type: 'string',
      description: 'UUID of the source entity',
      format: 'uuid',
    },
    target_type: {
      type: 'string',
      description: 'Type of the target entity or external reference',
      enum: ['memory', 'todo', 'project', 'contact', 'github_issue', 'url'],
    },
    target_ref: {
      type: 'string',
      description: 'Reference to the target',
      minLength: 1,
    },
  },
  required: ['source_type', 'source_id', 'target_type', 'target_ref'],
};

// Prompt template tool schemas (Epic #1497, Issue #1499)
const promptTemplateListSchema: JSONSchema = {
  type: 'object',
  properties: {
    channel_type: { type: 'string', description: 'Filter by channel type: sms, email, ha_observation, general', enum: ['sms', 'email', 'ha_observation', 'general'] },
    limit: { type: 'number', description: 'Max results to return (default 20)', minimum: 1, maximum: 100 },
    offset: { type: 'number', description: 'Pagination offset (default 0)', minimum: 0 },
  },
  required: [],
};

const promptTemplateGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'ID of the prompt template to retrieve' },
  },
  required: ['id'],
};

const promptTemplateCreateSchema: JSONSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Human-readable name for the template', minLength: 1 },
    content: { type: 'string', description: 'The prompt text', minLength: 1 },
    channel_type: { type: 'string', description: 'Channel type: sms, email, ha_observation, general', enum: ['sms', 'email', 'ha_observation', 'general'] },
    is_default: { type: 'boolean', description: 'Whether this is the default template for its channel type' },
  },
  required: ['label', 'content', 'channel_type'],
};

const promptTemplateUpdateSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'ID of the prompt template to update' },
    label: { type: 'string', description: 'New label' },
    content: { type: 'string', description: 'New prompt text' },
    channel_type: { type: 'string', description: 'New channel type', enum: ['sms', 'email', 'ha_observation', 'general'] },
    is_default: { type: 'boolean', description: 'Set as default for channel type' },
  },
  required: ['id'],
};

const promptTemplateDeleteSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'ID of the prompt template to delete (soft-delete)' },
  },
  required: ['id'],
};

// ── Inbound Destination schemas (Issue #1500) ──────────────

const inboundDestinationListSchema: JSONSchema = {
  type: 'object',
  properties: {
    channel_type: { type: 'string', description: 'Filter by channel type (sms, email)' },
    search: { type: 'string', description: 'Search by address or display name' },
    limit: { type: 'number', description: 'Max results (default 50, max 100)' },
    offset: { type: 'number', description: 'Offset for pagination' },
  },
};

const inboundDestinationGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'ID of the inbound destination' },
  },
  required: ['id'],
};

const inboundDestinationUpdateSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'ID of the inbound destination to update' },
    display_name: { type: 'string', description: 'Human-readable display name' },
    agent_id: { type: 'string', description: 'Agent ID for routing (null to clear)' },
    prompt_template_id: { type: 'string', description: 'Prompt template ID for routing (null to clear)' },
    context_id: { type: 'string', description: 'Context ID for routing (null to clear)' },
  },
  required: ['id'],
};

// ── Channel Default schemas (Issue #1501) ──────────────────

const channelDefaultListSchema: JSONSchema = {
  type: 'object',
  properties: {},
};

const channelDefaultGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    channel_type: { type: 'string', description: 'Channel type: sms, email, or ha_observation' },
  },
  required: ['channel_type'],
};

const channelDefaultSetSchema: JSONSchema = {
  type: 'object',
  properties: {
    channel_type: { type: 'string', description: 'Channel type: sms, email, or ha_observation' },
    agent_id: { type: 'string', description: 'Agent ID for this channel type' },
    prompt_template_id: { type: 'string', description: 'Prompt template ID (optional)' },
    context_id: { type: 'string', description: 'Context ID (optional)' },
  },
  required: ['channel_type', 'agent_id'],
};

// ── Namespace management tool schemas (Issue #1536) ─────────────

const namespaceListSchema: JSONSchema = {
  type: 'object',
  properties: {},
};

const namespaceCreateSchema: JSONSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Name of the namespace to create. Must be lowercase alphanumeric with dots, hyphens, or underscores.',
      pattern: '^[a-z0-9][a-z0-9._-]*$',
      maxLength: 63,
    },
  },
  required: ['name'],
};

const namespaceGrantSchema: JSONSchema = {
  type: 'object',
  properties: {
    namespace: {
      type: 'string',
      description: 'Namespace to grant access to.',
      pattern: '^[a-z0-9][a-z0-9._-]*$',
      maxLength: 63,
    },
    email: {
      type: 'string',
      description: 'Email of the user to grant access to.',
    },
    role: {
      type: 'string',
      description: 'Role to assign: owner, admin, member, or observer.',
      enum: ['owner', 'admin', 'member', 'observer'],
    },
    is_default: {
      type: 'boolean',
      description: 'Whether this becomes the user\'s default namespace.',
    },
  },
  required: ['namespace', 'email'],
};

const namespaceMembersSchema: JSONSchema = {
  type: 'object',
  properties: {
    namespace: {
      type: 'string',
      description: 'Namespace to list members for.',
      pattern: '^[a-z0-9][a-z0-9._-]*$',
      maxLength: 63,
    },
  },
  required: ['namespace'],
};

const namespaceRevokeSchema: JSONSchema = {
  type: 'object',
  properties: {
    namespace: {
      type: 'string',
      description: 'Namespace to revoke access from.',
      pattern: '^[a-z0-9][a-z0-9._-]*$',
      maxLength: 63,
    },
    grant_id: {
      type: 'string',
      description: 'ID of the grant to revoke.',
    },
  },
  required: ['namespace', 'grant_id'],
};

// ── API Onboarding tool schemas (#1784, #1785, #1786) ─────────────────────

const apiOnboardSchema: JSONSchema = {
  type: 'object',
  properties: {
    spec_url: { type: 'string', description: 'URL to fetch the OpenAPI spec from.', format: 'uri' },
    spec_content: { type: 'string', description: 'Inline OpenAPI spec content (JSON or YAML).' },
    name: { type: 'string', description: 'Human-readable name for the API.', maxLength: 200 },
    description: { type: 'string', description: 'Description of the API.', maxLength: 2000 },
    tags: { type: 'array', description: 'Tags to categorise the API.', items: { type: 'string' } },
    credentials: {
      type: 'array',
      description: 'Credentials for authenticating API calls.',
      items: {
        type: 'object',
        properties: {
          header_name: { type: 'string' },
          header_prefix: { type: 'string' },
          resolve_strategy: { type: 'string', enum: ['literal', 'env', 'file', 'command'] },
          resolve_reference: { type: 'string' },
          purpose: { type: 'string', enum: ['api_call', 'spec_fetch'] },
        },
        required: ['header_name', 'resolve_strategy', 'resolve_reference'],
      },
    },
    spec_auth_headers: { type: 'object', description: 'Headers for fetching the spec URL (if auth-protected).', additionalProperties: { type: 'string' } },
  },
  required: [],
};

const apiRecallSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Natural-language search query for API capabilities.', minLength: 1, maxLength: 1000 },
    limit: { type: 'integer', description: 'Maximum results to return.', minimum: 1, maximum: 50, default: 10 },
    memory_kind: { type: 'string', description: 'Filter by memory kind.', enum: ['overview', 'tag_group', 'operation'] },
    api_source_id: { type: 'string', description: 'Filter to a specific API source.', format: 'uuid' },
    tags: { type: 'array', description: 'Filter by tags.', items: { type: 'string' } },
  },
  required: ['query'],
};

const apiGetSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'UUID of the API source.', format: 'uuid' },
  },
  required: ['id'],
};

const apiListSchema: JSONSchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', description: 'Maximum results.', minimum: 1, maximum: 100 },
    offset: { type: 'integer', description: 'Pagination offset.', minimum: 0 },
    status: { type: 'string', description: 'Filter by status.', enum: ['active', 'error', 'disabled'] },
  },
  required: [],
};

const apiUpdateSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'UUID of the API source to update.', format: 'uuid' },
    name: { type: 'string', description: 'New name.', maxLength: 200 },
    description: { type: 'string', description: 'New description.', maxLength: 2000 },
    tags: { type: 'array', description: 'New tags.', items: { type: 'string' } },
    status: { type: 'string', description: 'New status.', enum: ['active', 'error', 'disabled'] },
  },
  required: ['id'],
};

const apiCredentialManageSchema: JSONSchema = {
  type: 'object',
  properties: {
    api_source_id: { type: 'string', description: 'UUID of the API source.', format: 'uuid' },
    action: { type: 'string', description: 'Action to perform.', enum: ['add', 'update', 'remove'] },
    credential_id: { type: 'string', description: 'UUID of the credential (for update/remove).', format: 'uuid' },
    header_name: { type: 'string', description: 'HTTP header name (e.g. Authorization).' },
    header_prefix: { type: 'string', description: 'Header value prefix (e.g. Bearer).' },
    resolve_strategy: { type: 'string', description: 'How to resolve the credential.', enum: ['literal', 'env', 'file', 'command'] },
    resolve_reference: { type: 'string', description: 'Credential value or reference.' },
    purpose: { type: 'string', description: 'Credential purpose.', enum: ['api_call', 'spec_fetch'] },
  },
  required: ['api_source_id', 'action'],
};

const apiRefreshSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'UUID of the API source to refresh.', format: 'uuid' },
  },
  required: ['id'],
};

const apiRemoveSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'UUID of the API source to soft-delete.', format: 'uuid' },
  },
  required: ['id'],
};

const apiRestoreSchema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'UUID of the API source to restore.', format: 'uuid' },
  },
  required: ['id'],
};

/**
 * Async namespace discovery — fetches accessible namespaces from the API
 * and updates state.resolvedNamespace.recall in-place (Issue #1537).
 * Exported for testing.
 */
export async function refreshNamespacesAsync(state: PluginState): Promise<void> {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;

  try {
    const response = await state.apiClient.get<Array<{ namespace: string; priority?: number; role?: string }>>(
      '/api/namespaces',
      { user_id: state.agentId, user_email: state.agentEmail },
    );

    if (!response.success) {
      state.logger.warn('Namespace discovery failed, keeping cached list', { error: response.error.message });
      // Do NOT update timestamp on failure — let the next check retry sooner
      return;
    }

    const items = Array.isArray(response.data) ? response.data : [];
    if (items.length === 0) {
      state.logger.warn(
        'Namespace discovery returned empty list — M2M tokens may lack namespace grants. ' +
          'Ensure the server returns all namespaces for M2M tokens with api:full scope (#1561).',
      );
      // Successful call — stamp to prevent immediate re-fetch
      state.lastNamespaceRefreshMs = Date.now();
      return;
    }

    // Sort by priority descending, then alphabetically
    const discovered = items
      .sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50) || a.namespace.localeCompare(b.namespace))
      .map((ns) => ns.namespace);

    // Update in-place so existing references see the change
    state.resolvedNamespace.recall = discovered;
    // Stamp only after successful fetch
    state.lastNamespaceRefreshMs = Date.now();
    state.logger.info('Namespace list refreshed via dynamic discovery', { namespaces: discovered });
  } catch (error) {
    state.logger.warn('Namespace discovery error, keeping cached list', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Do NOT update timestamp on failure — let the next check retry sooner
  } finally {
    state.refreshInFlight = false;
  }
}

/**
 * Create tool execution handlers
 */
function createToolHandlers(state: PluginState) {
  const { config, logger, apiClient } = state;

  // Issue #1644: Read user_id from mutable state on every call.
  const getAgentId = (): string => state.agentId;

  /** Read user_id and namespace from mutable state on every call (Issue #1644, #1797) */
  const reqOpts = (): { user_id: string; user_email?: string; namespace: string } => ({
    user_id: state.agentId,
    user_email: state.agentEmail,
    namespace: state.resolvedNamespace.default,
  });

  /**
   * Request options with namespace header for by-ID operations (#1760).
   * Only use for GET/PATCH/DELETE on specific items (e.g. /api/work-items/:id).
   * Do NOT use for list/search/create — those already pass namespace via body/query
   * and the X-Namespace header would override them (middleware checks headers first).
   */
  const reqOptsScoped = (): { user_id: string; user_email?: string; namespace: string } => ({
    ...reqOpts(),
    namespace: state.resolvedNamespace.default,
  });

  /** Read namespace from mutable state on every call (Issue #1644) */
  function getStoreNamespace(params: Record<string, unknown>): string {
    const ns = params.namespace;
    if (typeof ns === 'string' && ns.length > 0) return ns;
    return state.resolvedNamespace.default;
  }

  /**
   * Get the effective namespaces for a query/list operation.
   * Uses explicit tool param if provided, otherwise falls back to config recall list.
   * Triggers async refresh if stale (Issue #1537).
   */
  function getRecallNamespaces(params: Record<string, unknown>): string[] {
    const ns = params.namespaces;
    if (Array.isArray(ns) && ns.length > 0) return ns as string[];

    // Issue #1537: trigger background refresh if stale
    const interval = config.namespaceRefreshIntervalMs ?? 300_000;
    if (interval > 0 && !state.hasStaticRecall && Date.now() - state.lastNamespaceRefreshMs > interval) {
      refreshNamespacesAsync(state);
    }

    return state.resolvedNamespace.recall;
  }

  return {
    async memory_recall(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        query,
        limit = config.maxRecallMemories,
        category,
        tags,
        relationship_id,
        location,
        location_radius_km,
        location_weight,
      } = params as {
        query: string;
        limit?: number;
        category?: string;
        tags?: string[];
        relationship_id?: string;
        location?: { lat: number; lng: number };
        location_radius_km?: number;
        location_weight?: number;
      };

      try {
        // Over-fetch when location is provided to allow geo re-ranking
        const apiLimit = location ? Math.min(limit * 3, 60) : limit;

        const queryParams = new URLSearchParams({ q: query, limit: String(apiLimit) });
        if (category) queryParams.set('memory_type', category);
        if (tags && tags.length > 0) queryParams.set('tags', tags.join(','));
        if (relationship_id) queryParams.set('relationship_id', relationship_id);
        // Namespace scoping (Issue #1428)
        const ns = getRecallNamespaces(params);
        if (ns.length > 0) queryParams.set('namespaces', ns.join(','));

        const response = await apiClient.get<{
          results: Array<{
            id: string;
            content: string;
            type: string;
            similarity?: number;
            lat?: number | null;
            lng?: number | null;
            address?: string | null;
            place_label?: string | null;
          }>;
        }>(`/api/memories/search?${queryParams}`, reqOpts());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        let memories = (response.data.results ?? []).map((m) => ({
          ...m,
          category: m.type === 'note' ? 'other' : m.type,
          score: m.similarity,
        }));

        // Apply geo re-ranking if location is provided
        if (location) {
          const { lat: qLat, lng: qLng } = location;
          const weight = location_weight ?? 0.3;

          // Filter by radius if specified
          if (location_radius_km !== undefined) {
            memories = memories.filter((m) => {
              if (m.lat == null || m.lng == null) return false;
              return haversineDistanceKm(qLat, qLng, m.lat, m.lng) <= location_radius_km;
            });
          }

          // Compute blended scores and re-sort
          memories = memories
            .map((m) => {
              const contentScore = m.score ?? 0;
              let geoScore = 0.5;
              if (m.lat != null && m.lng != null) {
                geoScore = computeGeoScore(haversineDistanceKm(qLat, qLng, m.lat, m.lng));
              }
              return { ...m, score: blendScores(contentScore, geoScore, weight) };
            })
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, limit);
        }

        const content = memories.length > 0 ? memories.map((m) => `- [${m.type}] ${m.content}`).join('\n') : 'No relevant memories found.';

        return {
          success: true,
          data: {
            content,
            details: { count: memories.length, memories, user_id: state.agentId },
          },
        };
      } catch (error) {
        logger.error('memory_recall failed', { error });
        return { success: false, error: 'Failed to search memories' };
      }
    },

    async memory_store(params: Record<string, unknown>): Promise<ToolResult> {
      // Accept 'text' (OpenClaw native) or 'content' (backwards compat)
      const {
        text,
        content: contentAlias,
        category = 'other',
        importance = 0.7,
        tags,
        relationship_id,
        location,
      } = params as {
        text?: string;
        content?: string;
        category?: string;
        importance?: number;
        tags?: string[];
        relationship_id?: string;
        location?: { lat: number; lng: number; address?: string; place_label?: string };
      };

      const memoryText = text || contentAlias;
      if (!memoryText) {
        return { success: false, error: 'text is required' };
      }

      try {
        // Map to backend's /api/memories/unified which expects 'content'
        // Map 'category' → 'memory_type' (backend term)
        const payload: Record<string, unknown> = {
          content: memoryText,
          memory_type: category === 'entity' ? 'reference' : category === 'other' ? 'note' : category,
          importance,
          namespace: getStoreNamespace(params), // Issue #1428
        };
        if (tags && tags.length > 0) payload.tags = tags;
        if (relationship_id) payload.relationship_id = relationship_id;
        if (location) {
          payload.lat = location.lat;
          payload.lng = location.lng;

          // Reverse geocode if address is missing and Nominatim is configured
          if (!location.address && config.nominatimUrl) {
            const geocoded = await reverseGeocode(location.lat, location.lng, config.nominatimUrl);
            if (geocoded) {
              payload.address = geocoded.address;
              if (!location.place_label && geocoded.place_label) {
                payload.place_label = geocoded.place_label;
              }
            }
          }

          if (location.address) payload.address = location.address;
          if (location.place_label) payload.place_label = location.place_label;
        }

        const response = await apiClient.post<{ id: string }>('/api/memories/unified', payload, reqOpts());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Stored: "${memoryText.slice(0, 100)}${memoryText.length > 100 ? '...' : ''}"`,
            details: { action: 'created', id: response.data.id },
          },
        };
      } catch (error) {
        logger.error('memory_store failed', { error });
        return { success: false, error: 'Failed to store memory' };
      }
    },

    async memory_forget(params: Record<string, unknown>): Promise<ToolResult> {
      const { memory_id, query } = params as { memory_id?: string; query?: string };

      try {
        if (memory_id) {
          const response = await apiClient.delete(`/api/memories/${memory_id}`, reqOptsScoped());
          if (!response.success) {
            return { success: false, error: response.error.message };
          }
          return {
            success: true,
            data: { content: `Memory ${memory_id} forgotten successfully` },
          };
        }

        if (query) {
          // Match OpenClaw gateway memory_forget behavior:
          // Search → single high-confidence match auto-deletes, multiple returns candidates.
          const forgetQp = new URLSearchParams({ q: query, limit: '5' });
          const forgetNs = getRecallNamespaces(params);
          if (forgetNs.length > 0) forgetQp.set('namespaces', forgetNs.join(','));
          const searchResponse = await apiClient.get<{ results: Array<{ id: string; content: string; similarity?: number }> }>(
            `/api/memories/search?${forgetQp}`,
            reqOpts(),
          );
          if (!searchResponse.success) {
            return { success: false, error: searchResponse.error.message };
          }
          const matches = searchResponse.data.results ?? [];
          if (matches.length === 0) {
            return {
              success: true,
              data: { content: 'No matching memories found.', details: { found: 0 } },
            };
          }

          // Single high-confidence match → auto-delete
          if (matches.length === 1 && (matches[0].similarity ?? 0) > 0.9) {
            const delResponse = await apiClient.delete(`/api/memories/${matches[0].id}`, reqOptsScoped());
            if (!delResponse.success) {
              return { success: false, error: delResponse.error.message };
            }
            return {
              success: true,
              data: {
                content: `Forgotten: "${matches[0].content}"`,
                details: { action: 'deleted', id: matches[0].id },
              },
            };
          }

          // Multiple matches or low confidence → return candidates, don't delete
          const list = matches.map((m) => `- [${m.id}] ${m.content.slice(0, 60)}${m.content.length > 60 ? '...' : ''}`).join('\n');
          return {
            success: true,
            data: {
              content: `Found ${matches.length} candidates. Specify memory_id:\n${list}`,
              details: { action: 'candidates', candidates: matches.map((m) => ({ id: m.id, content: m.content, similarity: m.similarity })) },
            },
          };
        }

        return { success: false, error: 'Either memory_id or query is required' };
      } catch (error) {
        logger.error('memory_forget failed', { error });
        return { success: false, error: 'Failed to forget memory' };
      }
    },

    async project_list(params: Record<string, unknown>): Promise<ToolResult> {
      const { status = 'active', limit = 10 } = params as { status?: string; limit?: number };

      try {
        const queryParams = new URLSearchParams({ item_type: 'project', limit: String(limit) });
        if (status !== 'all') queryParams.set('status', status);
        queryParams.set('user_email', state.agentId); // Issue #1172: scope by user
        // Namespace scoping (Issue #1428)
        const projListNs = getRecallNamespaces(params);
        if (projListNs.length > 0) queryParams.set('namespaces', projListNs.join(','));

        const response = await apiClient.get<{ items: Array<{ id: string; title: string; status: string }> }>(`/api/work-items?${queryParams}`, reqOpts());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const projects = response.data.items ?? [];
        const content = projects.length > 0 ? projects.map((p) => `- ${p.title} (${p.status})`).join('\n') : 'No projects found.';

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
      const { project_id } = params as { project_id: string };

      try {
        const response = await apiClient.get<{ id: string; title: string; description?: string; status: string }>(
          `/api/work-items/${project_id}?user_email=${encodeURIComponent(state.agentId)}`,
          reqOptsScoped(),
        );

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const project = response.data;
        return {
          success: true,
          data: {
            content: `Project: ${project.title}\nStatus: ${project.status}\n${project.description || ''}`,
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
        const response = await apiClient.post<{ id: string }>(
          '/api/work-items',
          { title: name, description, item_type: 'project', status, user_email: state.agentId, namespace: getStoreNamespace(params) },
          reqOpts(),
        );

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
        project_id,
        completed,
        limit = 50,
        offset = 0,
      } = params as {
        project_id?: string;
        completed?: boolean;
        limit?: number;
        offset?: number;
      };

      try {
        const queryParams = new URLSearchParams({
          item_type: 'task',
          limit: String(limit),
          offset: String(offset),
          user_email: state.agentId, // Issue #1172: scope by user
        });
        if (project_id) queryParams.set('parent_work_item_id', project_id);
        if (completed !== undefined) {
          queryParams.set('status', completed ? 'completed' : 'active');
        }
        // Namespace scoping (Issue #1428)
        const todoListNs = getRecallNamespaces(params);
        if (todoListNs.length > 0) queryParams.set('namespaces', todoListNs.join(','));

        const response = await apiClient.get<{
          items?: Array<{ id: string; title: string; status: string; completed?: boolean; dueDate?: string }>;
          total?: number;
        }>(`/api/work-items?${queryParams}`, reqOpts());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const todos = response.data.items ?? [];
        const total = response.data.total ?? todos.length;

        if (todos.length === 0) {
          return {
            success: true,
            data: { content: 'No todos found.', details: { count: 0, total: 0, todos: [] } },
          };
        }

        const content = todos
          .map((t) => {
            const checkbox = t.completed ? '[x]' : '[ ]';
            const dueStr = t.dueDate ? ` (due: ${t.dueDate})` : '';
            return `- ${checkbox} ${t.title}${dueStr}`;
          })
          .join('\n');

        return {
          success: true,
          data: { content, details: { count: todos.length, total, todos } },
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
        project_id,
        priority = 'medium',
        dueDate,
      } = params as {
        title: string;
        description?: string;
        project_id?: string;
        priority?: string;
        dueDate?: string;
      };

      try {
        const body: Record<string, unknown> = { title, description, item_type: 'task', priority, user_email: state.agentId, namespace: getStoreNamespace(params) };
        if (project_id) body.parent_work_item_id = project_id;
        if (dueDate) body.not_after = dueDate;

        const response = await apiClient.post<{ id: string }>('/api/work-items', body, reqOpts());

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
        const response = await apiClient.patch<{ id: string }>(
          `/api/work-items/${todoId}/status?user_email=${encodeURIComponent(state.agentId)}`,
          { status: 'completed' },
          reqOptsScoped(),
        );

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

    async todo_search(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        query,
        limit = 10,
        kind,
        status,
      } = params as {
        query: string;
        limit?: number;
        kind?: string;
        status?: string;
      };

      if (!query || query.trim().length === 0) {
        return { success: false, error: 'query is required' };
      }

      try {
        // Over-fetch by 3x to compensate for client-side kind/status filtering (Issue #1216 review fix)
        const fetchLimit = kind || status ? Math.min((limit as number) * 3, 50) : (limit as number);

        const queryParams = new URLSearchParams({
          q: query.trim(),
          types: 'work_item',
          limit: String(fetchLimit),
          semantic: 'true',
          user_email: state.agentId, // Issue #1216: scope results to current user
        });
        // Namespace scoping (Issue #1428)
        const todoSearchNs = getRecallNamespaces(params);
        if (todoSearchNs.length > 0) queryParams.set('namespaces', todoSearchNs.join(','));

        const response = await apiClient.get<{
          results: Array<{
            id: string;
            title: string;
            snippet: string;
            score: number;
            type: string;
            metadata?: { kind?: string; status?: string };
          }>;
          search_type: string;
          total: number;
        }>(`/api/search?${queryParams}`, reqOpts());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        let results = response.data.results ?? [];

        // Client-side filtering by kind and status, then truncate to requested limit
        if (kind) {
          results = results.filter((r) => r.metadata?.kind === kind);
        }
        if (status) {
          results = results.filter((r) => r.metadata?.status === status);
        }
        results = results.slice(0, limit as number);

        if (results.length === 0) {
          return {
            success: true,
            data: {
              content: 'No matching work items found.',
              details: { count: 0, results: [], search_type: response.data.search_type },
            },
          };
        }

        const content = results
          .map((r) => {
            const kindStr = r.metadata?.kind ? `[${r.metadata.kind}]` : '';
            const statusStr = r.metadata?.status ? ` (${r.metadata.status})` : '';
            const snippetStr = r.snippet ? ` - ${r.snippet}` : '';
            return `- ${kindStr} **${r.title}**${statusStr}${snippetStr}`;
          })
          .join('\n');

        return {
          success: true,
          data: {
            content,
            details: {
              count: results.length,
              results: results.map((r) => ({
                id: r.id,
                title: r.title,
                snippet: r.snippet,
                score: r.score,
                kind: r.metadata?.kind,
                status: r.metadata?.status,
              })),
              search_type: response.data.search_type,
            },
          },
        };
      } catch (error) {
        logger.error('todo_search failed', { error });
        return { success: false, error: 'Failed to search work items' };
      }
    },

    async project_search(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createProjectSearchTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async context_search(params: Record<string, unknown>): Promise<ToolResult> {
      const contextNs = getRecallNamespaces(params);
      const tool = createContextSearchTool({ client: apiClient, logger, config, user_id: getAgentId(), namespaces: contextNs.length > 0 ? contextNs : undefined });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async contact_search(params: Record<string, unknown>): Promise<ToolResult> {
      const { query, limit = 10 } = params as { query: string; limit?: number };

      try {
        const queryParams = new URLSearchParams({ search: query, limit: String(limit), user_email: state.agentId });
        const contactSearchNs = getRecallNamespaces(params);
        if (contactSearchNs.length > 0) queryParams.set('namespaces', contactSearchNs.join(','));
        const response = await apiClient.get<{ contacts: Array<{ id: string; display_name: string; email?: string }> }>(`/api/contacts?${queryParams}`, {
          user_id: state.agentId,
        });

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const contacts = response.data.contacts ?? [];
        const content = contacts.length > 0 ? contacts.map((c) => `- ${c.display_name}${c.email ? ` (${c.email})` : ''}`).join('\n') : 'No contacts found.';

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
      const { contact_id } = params as { contact_id: string };

      try {
        const response = await apiClient.get<{ id: string; display_name?: string; given_name?: string; family_name?: string; email?: string; phone?: string; notes?: string }>(
          `/api/contacts/${contact_id}?user_email=${encodeURIComponent(state.agentId)}`,
          reqOptsScoped(),
        );

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const contact = response.data;
        const contactName = contact.display_name || [contact.given_name, contact.family_name].filter(Boolean).join(' ') || 'Unknown';
        const lines = [`Contact: ${contactName}`];
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
      const { display_name, given_name, family_name, nickname, contact_kind, email, phone, notes, tags } = params as {
        display_name?: string;
        given_name?: string;
        family_name?: string;
        nickname?: string;
        contact_kind?: string;
        email?: string;
        phone?: string;
        notes?: string;
        tags?: string[];
      };

      // Must have display_name or at least given_name/family_name
      const name = display_name || [given_name, family_name].filter(Boolean).join(' ');
      if (!name) {
        return { success: false, error: 'Either display_name or given_name/family_name is required' };
      }

      try {
        const body: Record<string, unknown> = {
          user_email: state.agentId,
          namespace: getStoreNamespace(params),
          notes,
          contact_kind: contact_kind ?? 'person',
          tags,
        };
        if (display_name) body.display_name = display_name;
        if (given_name) body.given_name = given_name;
        if (family_name) body.family_name = family_name;
        if (nickname) body.nickname = nickname;

        // Build endpoints array from convenience fields
        const endpoints: Array<{ type: string; value: string }> = [];
        if (email) endpoints.push({ type: 'email', value: email });
        if (phone) endpoints.push({ type: 'phone', value: phone });
        if (endpoints.length > 0) body.endpoints = endpoints;

        const response = await apiClient.post<{ id: string; display_name?: string }>('/api/contacts', body, reqOpts());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Contact "${name}" created successfully (ID: ${response.data.id})`,
            details: { id: response.data.id, display_name: response.data.display_name ?? name },
          },
        };
      } catch (error) {
        logger.error('contact_create failed', { error });
        return { success: false, error: 'Failed to create contact' };
      }
    },

    async contact_update(params: Record<string, unknown>): Promise<ToolResult> {
      const { contact_id, ...updates } = params as {
        contact_id: string;
        display_name?: string;
        given_name?: string;
        family_name?: string;
        nickname?: string;
        notes?: string;
        tags?: string[];
      };

      if (!contact_id) return { success: false, error: 'contact_id is required' };

      try {
        const body: Record<string, unknown> = { namespace: getStoreNamespace(params) };
        for (const [k, v] of Object.entries(updates)) {
          if (k !== 'namespace' && v !== undefined) body[k] = v;
        }

        const response = await apiClient.patch<{ id: string; display_name?: string }>(`/api/contacts/${contact_id}`, body, reqOptsScoped());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Contact ${contact_id} updated successfully`,
            details: { id: contact_id, display_name: response.data.display_name },
          },
        };
      } catch (error) {
        logger.error('contact_update failed', { error });
        return { success: false, error: 'Failed to update contact' };
      }
    },

    async contact_merge(params: Record<string, unknown>): Promise<ToolResult> {
      const { survivor_id, loser_id } = params as { survivor_id: string; loser_id: string };

      if (!survivor_id || !loser_id) return { success: false, error: 'survivor_id and loser_id are required' };

      try {
        const response = await apiClient.post<{ survivor_id: string; merged_endpoint_count?: number }>(
          '/api/contacts/merge',
          { survivor_id, loser_id, namespace: getStoreNamespace(params) },
          reqOpts(),
        );

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Contacts merged successfully. Survivor: ${survivor_id}`,
            details: response.data,
          },
        };
      } catch (error) {
        logger.error('contact_merge failed', { error });
        return { success: false, error: 'Failed to merge contacts' };
      }
    },

    async contact_tag_add(params: Record<string, unknown>): Promise<ToolResult> {
      const { contact_id, tags } = params as { contact_id: string; tags: string[] };

      if (!contact_id || !tags?.length) return { success: false, error: 'contact_id and tags are required' };

      try {
        const response = await apiClient.post(`/api/contacts/${contact_id}/tags`, { tags }, reqOptsScoped());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Added ${tags.length} tag(s) to contact ${contact_id}: ${tags.join(', ')}`,
            details: { contact_id, tags },
          },
        };
      } catch (error) {
        logger.error('contact_tag_add failed', { error });
        return { success: false, error: 'Failed to add tags' };
      }
    },

    async contact_tag_remove(params: Record<string, unknown>): Promise<ToolResult> {
      const { contact_id, tag } = params as { contact_id: string; tag: string };

      if (!contact_id || !tag) return { success: false, error: 'contact_id and tag are required' };

      try {
        const response = await apiClient.delete(`/api/contacts/${contact_id}/tags/${encodeURIComponent(tag)}`, reqOptsScoped());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        return {
          success: true,
          data: {
            content: `Removed tag "${tag}" from contact ${contact_id}`,
            details: { contact_id, tag },
          },
        };
      } catch (error) {
        logger.error('contact_tag_remove failed', { error });
        return { success: false, error: 'Failed to remove tag' };
      }
    },

    async contact_resolve(params: Record<string, unknown>): Promise<ToolResult> {
      const { phone, email, name } = params as { phone?: string; email?: string; name?: string };

      if (!phone && !email && !name) {
        return { success: false, error: 'At least one of phone, email, or name is required' };
      }

      try {
        const queryParams = new URLSearchParams();
        if (phone) queryParams.set('phone', phone);
        if (email) queryParams.set('email', email);
        if (name) queryParams.set('name', name);

        const response = await apiClient.get<{ matches: Array<{ contact_id: string; display_name: string; confidence: number; endpoints?: Array<{ type: string; value: string }> }> }>(
          `/api/contacts/suggest-match?${queryParams}`,
          reqOpts(),
        );

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const matches = response.data.matches ?? [];
        if (matches.length === 0) {
          return {
            success: true,
            data: {
              content: 'No matching contacts found for the provided sender information.',
              details: { matches: [], resolved: false },
            },
          };
        }

        const best = matches[0];
        const content = matches
          .map((m) => `- ${m.display_name} (${Math.round(m.confidence * 100)}% match, ID: ${m.contact_id})`)
          .join('\n');

        return {
          success: true,
          data: {
            content: `Found ${matches.length} matching contact(s):\n${content}`,
            details: {
              matches,
              resolved: best.confidence >= 0.8,
              best_match: best,
            },
          },
        };
      } catch (error) {
        logger.error('contact_resolve failed', { error });
        return { success: false, error: 'Failed to resolve sender identity' };
      }
    },

    async sms_send(params: Record<string, unknown>): Promise<ToolResult> {
      const { to, body, idempotency_key } = params as {
        to: string;
        body: string;
        idempotency_key?: string;
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
        user_id: state.agentId,
        bodyLength: body.length,
        hasIdempotencyKey: !!idempotency_key,
      });

      try {
        const response = await apiClient.post<{
          message_id: string;
          thread_id?: string;
          status: string;
        }>('/api/twilio/sms/send', { to, body, idempotency_key }, reqOpts());

        if (!response.success) {
          logger.error('sms_send API error', {
            user_id: state.agentId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to send SMS',
          };
        }

        const { message_id, thread_id, status } = response.data;

        logger.debug('sms_send completed', {
          user_id: state.agentId,
          message_id,
          status,
        });

        return {
          success: true,
          data: {
            content: `SMS sent successfully (ID: ${message_id}, Status: ${status})`,
            details: { message_id, thread_id, status, user_id: state.agentId },
          },
        };
      } catch (error) {
        logger.error('sms_send failed', {
          user_id: state.agentId,
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
      const { to, subject, body, html_body, thread_id, idempotency_key } = params as {
        to: string;
        subject: string;
        body: string;
        html_body?: string;
        thread_id?: string;
        idempotency_key?: string;
      };

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
        user_id: state.agentId,
        subjectLength: subject.length,
        bodyLength: body.length,
        hasHtmlBody: !!html_body,
        hasThreadId: !!thread_id,
        hasIdempotencyKey: !!idempotency_key,
      });

      try {
        const response = await apiClient.post<{
          message_id: string;
          thread_id?: string;
          status: string;
        }>('/api/postmark/email/send', { to, subject, body, html_body, thread_id, idempotency_key }, reqOpts());

        if (!response.success) {
          logger.error('email_send API error', {
            user_id: state.agentId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to send email',
          };
        }

        const { message_id, thread_id: responseThreadId, status } = response.data;

        logger.debug('email_send completed', {
          user_id: state.agentId,
          message_id,
          status,
        });

        return {
          success: true,
          data: {
            content: `Email sent successfully (ID: ${message_id}, Status: ${status})`,
            details: { message_id, thread_id: responseThreadId, status, user_id: state.agentId },
          },
        };
      } catch (error) {
        logger.error('email_send failed', {
          user_id: state.agentId,
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
        contact_id,
        limit = 10,
        include_thread = false,
      } = params as {
        query: string;
        channel?: string;
        contact_id?: string;
        limit?: number;
        include_thread?: boolean;
      };

      // Validate query
      if (!query || query.length === 0) {
        return {
          success: false,
          error: 'query: Search query cannot be empty',
        };
      }

      logger.info('message_search invoked', {
        user_id: state.agentId,
        queryLength: query.length,
        channel,
        hasContactId: !!contact_id,
        limit,
        include_thread,
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
        if (contact_id) {
          queryParams.set('contact_id', contact_id);
        }
        if (include_thread) {
          queryParams.set('include_thread', 'true');
        }

        // Unified search API: returns { results: [{ type, id, title, snippet, score, metadata }], total }
        const response = await apiClient.get<{
          results: Array<{
            type: string;
            id: string;
            title: string;
            snippet: string;
            score: number;
            metadata?: {
              channel?: string;
              direction?: string;
              received_at?: string;
              contact_name?: string;
            };
          }>;
          total: number;
        }>(`/api/search?${queryParams}`, reqOpts());

        if (!response.success) {
          logger.error('message_search API error', {
            user_id: state.agentId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to search messages',
          };
        }

        const { results, total } = response.data;

        // Transform unified search results to message format
        const messages = results.map((r) => ({
          id: r.id,
          body: r.snippet,
          direction: (r.metadata?.direction as 'inbound' | 'outbound') || 'inbound',
          channel: r.metadata?.channel || 'unknown',
          contact_name: r.metadata?.contact_name,
          timestamp: r.metadata?.received_at || '',
          similarity: r.score,
        }));

        logger.debug('message_search completed', {
          user_id: state.agentId,
          resultCount: messages.length,
          total,
        });

        // SECURITY: Run injection detection on the FULL message body BEFORE any
        // truncation. Bodies are later truncated to 100 chars for display, but
        // detection must see the complete content to catch payloads that an
        // attacker could hide beyond the truncation boundary. (Issue #1258)
        // Rate-limited to prevent log flooding from volume attacks. (#1257)
        for (const m of messages) {
          if (m.direction === 'inbound' && m.body) {
            const detection = await detectInjectionPatternsAsync(m.body, {
              promptGuardUrl: config.promptGuardUrl,
            });
            if (detection.detected) {
              const logDecision = injectionLogLimiter.shouldLog(state.agentId);
              if (logDecision.log) {
                logger.warn(
                  logDecision.summary ? 'injection detection log summary for previous window' : 'potential prompt injection detected in message_search result',
                  {
                    user_id: state.agentId,
                    message_id: m.id,
                    patterns: detection.patterns,
                    source: detection.source,
                    ...(logDecision.suppressed > 0 && { suppressedCount: logDecision.suppressed }),
                  },
                );
              }
            }
          }
        }

        // Format content for display with injection protection.
        // NOTE: Truncation happens here AFTER detection above — do not reorder.
        // Generate a per-invocation nonce for boundary markers (#1255)
        const { nonce } = createBoundaryMarkers();
        const content =
          messages.length > 0
            ? messages
                .map((m) => {
                  const prefix = m.direction === 'inbound' ? '←' : '→';
                  const contact = sanitizeMetadataField(m.contact_name || 'Unknown', nonce);
                  const safeChannel = sanitizeMetadataField(m.channel, nonce);
                  const similarity = `(${Math.round(m.similarity * 100)}%)`;
                  const rawBody = m.body || '';
                  const truncatedBody = rawBody.substring(0, 100) + (rawBody.length > 100 ? '...' : '');
                  const body_text = sanitizeMessageForContext(truncatedBody, {
                    direction: m.direction,
                    channel: m.channel,
                    sender: m.contact_name || 'Unknown',
                    nonce,
                  });
                  return `${prefix} [${safeChannel}] ${contact} ${similarity}: ${body_text}`;
                })
                .join('\n')
            : 'No messages found matching your query.';

        return {
          success: true,
          data: {
            content,
            details: { messages, total, user_id: state.agentId },
          },
        };
      } catch (error) {
        logger.error('message_search failed', {
          user_id: state.agentId,
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
        contact_id,
        limit = 20,
      } = params as {
        channel?: string;
        contact_id?: string;
        limit?: number;
      };

      logger.info('thread_list invoked', {
        user_id: state.agentId,
        channel,
        hasContactId: !!contact_id,
        limit,
      });

      try {
        // No /api/threads listing exists. Use unified search with types=message.
        const queryParams = new URLSearchParams();
        queryParams.set('types', 'message');
        queryParams.set('limit', String(limit));

        if (channel) {
          queryParams.set('channel', channel);
        }
        if (contact_id) {
          queryParams.set('contact_id', contact_id);
        }

        const response = await apiClient.get<{
          threads: Array<{
            id: string;
            channel: string;
            contact_name?: string;
            endpoint_value: string;
            message_count: number;
            last_message_at?: string;
          }>;
          results: Array<{
            id: string;
            type: string;
            title?: string;
            snippet?: string;
          }>;
          total: number;
        }>(`/api/search?${queryParams}`, reqOpts());

        if (!response.success) {
          logger.error('thread_list API error', {
            user_id: state.agentId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to list threads',
          };
        }

        // Search API returns { results: [...], total }, not { threads: [...] }
        const results = response.data.results ?? response.data.threads ?? [];
        const total = response.data.total ?? results.length;

        logger.debug('thread_list completed', {
          user_id: state.agentId,
          threadCount: results.length,
          total,
        });

        // Format content with injection protection.
        // Sanitize all fields that may contain external message content.
        // Generate a per-invocation nonce for boundary markers (#1255)
        const { nonce: threadListNonce } = createBoundaryMarkers();
        const content =
          results.length > 0
            ? results
                .map((r) => {
                  // Handle both thread and search result formats
                  if ('channel' in r) {
                    const t = r as { channel: string; contact_name?: string; endpoint_value?: string; message_count?: number };
                    const safeContact = sanitizeMetadataField(t.contact_name || t.endpoint_value || 'Unknown', threadListNonce);
                    const safeChannel = sanitizeMetadataField(t.channel, threadListNonce);
                    const msgCount = t.message_count ? `${t.message_count} message${t.message_count !== 1 ? 's' : ''}` : '';
                    return `[${safeChannel}] ${safeContact}${msgCount ? ` - ${msgCount}` : ''}`;
                  }
                  const safeTitle = r.title ? sanitizeMetadataField(r.title, threadListNonce) : '';
                  const wrappedSnippet = r.snippet ? wrapExternalMessage(r.snippet, { nonce: threadListNonce }) : '';
                  return `- ${safeTitle || wrappedSnippet || r.id}`;
                })
                .join('\n')
            : 'No threads found.';

        return {
          success: true,
          data: {
            content,
            details: { threads: results, total, user_id: state.agentId },
          },
        };
      } catch (error) {
        logger.error('thread_list failed', {
          user_id: state.agentId,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : 'An unexpected error occurred while listing threads.',
        };
      }
    },

    async thread_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { thread_id, message_limit = 50 } = params as {
        thread_id: string;
        message_limit?: number;
      };

      // Validate thread_id
      if (!thread_id || thread_id.length === 0) {
        return {
          success: false,
          error: 'thread_id: Thread ID is required',
        };
      }

      logger.info('thread_get invoked', {
        user_id: state.agentId,
        thread_id,
        message_limit,
      });

      try {
        const queryParams = new URLSearchParams();
        queryParams.set('limit', String(message_limit));

        const response = await apiClient.get<{
          thread: {
            id: string;
            channel: string;
            contact_name?: string;
            endpoint_value?: string;
          };
          messages: Array<{
            id: string;
            direction: 'inbound' | 'outbound';
            body: string;
            subject?: string;
            deliveryStatus?: string;
            created_at: string;
          }>;
        }>(`/api/threads/${thread_id}/history?${queryParams}`, reqOpts());

        if (!response.success) {
          logger.error('thread_get API error', {
            user_id: state.agentId,
            thread_id,
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
          user_id: state.agentId,
          thread_id,
          message_count: messages.length,
        });

        // Generate a per-invocation nonce for boundary markers (#1255)
        const { nonce: threadGetNonce } = createBoundaryMarkers();
        const contact = sanitizeMetadataField(thread.contact_name || thread.endpoint_value || 'Unknown', threadGetNonce);
        const safeChannel = sanitizeMetadataField(thread.channel, threadGetNonce);
        const header = `Thread with ${contact} [${safeChannel}]`;

        // Detect and log potential injection patterns in inbound messages
        // Rate-limited to prevent log flooding from volume attacks. (#1257)
        for (const m of messages) {
          if (m.direction === 'inbound' && m.body) {
            const detection = await detectInjectionPatternsAsync(m.body, {
              promptGuardUrl: config.promptGuardUrl,
            });
            if (detection.detected) {
              const logDecision = injectionLogLimiter.shouldLog(state.agentId);
              if (logDecision.log) {
                logger.warn(
                  logDecision.summary ? 'injection detection log summary for previous window' : 'potential prompt injection detected in thread_get result',
                  {
                    user_id: state.agentId,
                    thread_id,
                    message_id: m.id,
                    patterns: detection.patterns,
                    source: detection.source,
                    ...(logDecision.suppressed > 0 && { suppressedCount: logDecision.suppressed }),
                  },
                );
              }
            }
          }
        }

        const messageContent =
          messages.length > 0
            ? messages
                .map((m) => {
                  const prefix = m.direction === 'inbound' ? '←' : '→';
                  const timestamp = new Date(m.created_at).toLocaleString();
                  const body = sanitizeMessageForContext(m.body || '', {
                    direction: m.direction,
                    channel: thread.channel,
                    sender: contact,
                    nonce: threadGetNonce,
                  });
                  return `${prefix} [${timestamp}] ${body}`;
                })
                .join('\n')
            : 'No messages in this thread.';

        const content = `${header}\n\n${messageContent}`;

        return {
          success: true,
          data: {
            content,
            details: { thread, messages, user_id: state.agentId },
          },
        };
      } catch (error) {
        logger.error('thread_get failed', {
          user_id: state.agentId,
          thread_id,
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
        user_id: state.agentId,
        contactALength: contact_a.length,
        contactBLength: contact_b.length,
        relationshipLength: relationship.length,
        hasNotes: !!notes,
      });

      try {
        const body: Record<string, unknown> = {
          contact_a,
          contact_b,
          relationship_type: relationship,
          user_email: state.agentId, // Issue #1172: scope by user
          namespace: getStoreNamespace(params), // Issue #1428
        };
        if (notes) {
          body.notes = notes;
        }

        const response = await apiClient.post<{
          relationship: { id: string };
          contact_a: { id: string; display_name: string };
          contact_b: { id: string; display_name: string };
          relationship_type: { id: string; name: string; label: string };
          created: boolean;
        }>('/api/relationships/set', body, reqOpts());

        if (!response.success) {
          return { success: false, error: response.error.message };
        }

        const { relationship: rel, contact_a: respA, contact_b: respB, relationship_type, created } = response.data;
        const content = created
          ? `Recorded: ${respA.display_name} [${relationship_type.label}] ${respB.display_name}`
          : `Relationship already exists: ${respA.display_name} [${relationship_type.label}] ${respB.display_name}`;

        return {
          success: true,
          data: {
            content,
            details: {
              relationship_id: rel.id,
              created,
              contact_a: respA,
              contact_b: respB,
              relationship_type,
              user_id: state.agentId,
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
        user_id: state.agentId,
        contactLength: contact.length,
        hasTypeFilter: !!type_filter,
      });

      try {
        // Resolve contact to a UUID — accept UUID directly or search by name
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let contact_id: string;

        if (uuidRegex.test(contact)) {
          contact_id = contact;
        } else {
          // Search for contact by name (Issue #1172: scope by user_email)
          const searchParams = new URLSearchParams({ search: contact, limit: '1', user_email: state.agentId });
          const searchResponse = await apiClient.get<{
            contacts: Array<{ id: string; display_name: string }>;
          }>(`/api/contacts?${searchParams}`, reqOpts());

          if (!searchResponse.success) {
            return { success: false, error: searchResponse.error.message };
          }

          const contacts = searchResponse.data.contacts ?? [];
          if (contacts.length === 0) {
            return { success: false, error: 'Contact not found.' };
          }
          contact_id = contacts[0].id;
        }

        // Use graph traversal endpoint which returns related_contacts
        const response = await apiClient.get<{
          contact_id: string;
          contact_name: string;
          related_contacts: Array<{
            contact_id: string;
            contact_name: string;
            contact_kind: string;
            relationship_id: string;
            relationship_type_name: string;
            relationship_type_label: string;
            is_directional: boolean;
            notes: string | null;
          }>;
        }>(`/api/contacts/${contact_id}/relationships?user_email=${encodeURIComponent(state.agentId)}`, reqOptsScoped());

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Contact not found.' };
          }
          return { success: false, error: response.error.message };
        }

        let { related_contacts } = response.data;
        const { contact_name } = response.data;

        // Apply type_filter client-side if provided
        if (type_filter && related_contacts.length > 0) {
          const filterLower = type_filter.toLowerCase();
          related_contacts = related_contacts.filter(
            (rel) => rel.relationship_type_name.toLowerCase().includes(filterLower) || rel.relationship_type_label.toLowerCase().includes(filterLower),
          );
        }

        if (related_contacts.length === 0) {
          return {
            success: true,
            data: {
              content: `No relationships found for ${contact_name}.`,
              details: { contact_id, contact_name, related_contacts: [], user_id: state.agentId },
            },
          };
        }

        const lines = [`Relationships for ${contact_name}:`];
        for (const rel of related_contacts) {
          const kindTag = rel.contact_kind !== 'person' ? ` [${rel.contact_kind}]` : '';
          const notesTag = rel.notes ? ` -- ${rel.notes}` : '';
          lines.push(`- ${rel.relationship_type_label}: ${rel.contact_name}${kindTag}${notesTag}`);
        }

        return {
          success: true,
          data: {
            content: lines.join('\n'),
            details: { contact_id, contact_name, related_contacts, user_id: state.agentId },
          },
        };
      } catch (error) {
        logger.error('relationship_query failed', { error });
        return { success: false, error: 'Failed to query relationships' };
      }
    },

    async file_share(params: Record<string, unknown>): Promise<ToolResult> {
      const {
        file_id: fileId,
        expires_in: expiresIn = 3600,
        max_downloads: maxDownloads,
      } = params as {
        file_id: string;
        expires_in?: number;
        max_downloads?: number;
      };

      if (!fileId) {
        return {
          success: false,
          error: 'file_id is required',
        };
      }

      // Validate expires_in range
      if (expiresIn < 60 || expiresIn > 604800) {
        return {
          success: false,
          error: 'expires_in must be between 60 and 604800 seconds (1 minute to 7 days)',
        };
      }

      logger.info('file_share invoked', {
        user_id: state.agentId,
        file_id: fileId,
        expires_in: expiresIn,
        max_downloads: maxDownloads,
      });

      try {
        const body: Record<string, unknown> = { expires_in: expiresIn };
        if (maxDownloads !== undefined) {
          body.max_downloads = maxDownloads;
        }

        const response = await apiClient.post<{
          share_token: string;
          url: string;
          expires_at: string;
          expires_in: number;
          filename: string;
          content_type: string;
          size_bytes: number;
        }>(`/api/files/${fileId}/share`, body, reqOpts());

        if (!response.success) {
          logger.error('file_share API error', {
            user_id: state.agentId,
            file_id: fileId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to create share link',
          };
        }

        const { url, share_token, expires_at, filename, content_type, size_bytes } = response.data;

        logger.debug('file_share completed', {
          user_id: state.agentId,
          file_id: fileId,
          share_token,
          expires_at,
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
        const sizeText = formatSize(size_bytes);
        const downloadLimit = maxDownloads ? ` (max ${maxDownloads} downloads)` : '';

        return {
          success: true,
          data: {
            content: `Share link created for "${filename}" (${sizeText}). ` + `Valid for ${expiryText}${downloadLimit}.\n\nURL: ${url}`,
            details: {
              url,
              share_token,
              expires_at,
              expires_in: expiresIn,
              filename,
              content_type,
              size_bytes,
              user_id: state.agentId,
            },
          },
        };
      } catch (error) {
        logger.error('file_share failed', {
          user_id: state.agentId,
          file_id: fileId,
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
    // NOTE: These tools capture user_id at creation time. When state.agentId is updated
    // by hook context (Issue #1644), skill store tools will use the registration-time value.
    // This is acceptable because skill store operations are scoped by API key, not user_id.
    // A follow-up issue should refactor tool modules to accept getter functions.
    ...(() => {
      const toolOptions = { client: apiClient, logger, config, user_id: getAgentId() };
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

    // Entity link tools: delegate to tool modules (Issue #1220)
    ...(() => {
      const toolOptions = { client: apiClient, logger, config, user_id: getAgentId() };
      // NOTE: Same caveat as skill store tools above (Issue #1644).
      const setTool = createLinksSetTool(toolOptions);
      const queryTool = createLinksQueryTool(toolOptions);
      const removeTool = createLinksRemoveTool(toolOptions);

      return {
        links_set: (params: Record<string, unknown>) => setTool.execute(params),
        links_query: (params: Record<string, unknown>) => queryTool.execute(params),
        links_remove: (params: Record<string, unknown>) => removeTool.execute(params),
      };
    })(),

    // Prompt template tools (Epic #1497, Issue #1499)
    async prompt_template_list(params: Record<string, unknown>): Promise<ToolResult> {
      const { channel_type, limit = 20, offset = 0 } = params as {
        channel_type?: string;
        limit?: number;
        offset?: number;
      };
      try {
        const queryParams = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (channel_type) queryParams.set('channel_type', channel_type);

        const response = await apiClient.get<{ items?: Array<{ id: string; label: string; channel_type: string; is_default: boolean }>; total?: number }>(
          `/api/prompt-templates?${queryParams.toString()}`,
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to list prompt templates' };
        }
        const items = response.data.items ?? [];
        const content = items.length === 0
          ? 'No prompt templates found.'
          : items.map((t) => `- **${t.label}** [${t.channel_type}]${t.is_default ? ' (default)' : ''}`).join('\n');
        return { success: true, data: { content, details: { items, total: response.data.total ?? items.length } } };
      } catch (error) {
        logger.error('prompt_template_list failed', { error });
        return { success: false, error: 'Failed to list prompt templates' };
      }
    },

    async prompt_template_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { id } = params as { id: string };
      try {
        const response = await apiClient.get<{ id: string; label: string; content: string; channel_type: string; is_default: boolean }>(
          `/api/prompt-templates/${id}`,
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Prompt template not found' };
        }
        const t = response.data;
        return { success: true, data: { content: `**${t.label}** [${t.channel_type}]${t.is_default ? ' (default)' : ''}\n\n${t.content}`, details: t } };
      } catch (error) {
        logger.error('prompt_template_get failed', { error });
        return { success: false, error: 'Failed to get prompt template' };
      }
    },

    async prompt_template_create(params: Record<string, unknown>): Promise<ToolResult> {
      const { label, content, channel_type, is_default } = params as {
        label: string;
        content: string;
        channel_type: string;
        is_default?: boolean;
      };
      try {
        const response = await apiClient.post<{ id: string; label: string }>(
          '/api/prompt-templates',
          { label, content, channel_type, is_default },
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to create prompt template' };
        }
        return { success: true, data: { content: `Created prompt template "${response.data.label}" (${response.data.id})`, details: response.data } };
      } catch (error) {
        logger.error('prompt_template_create failed', { error });
        return { success: false, error: 'Failed to create prompt template' };
      }
    },

    async prompt_template_update(params: Record<string, unknown>): Promise<ToolResult> {
      const { id, ...updates } = params as { id: string; label?: string; content?: string; channel_type?: string; is_default?: boolean };
      try {
        const response = await apiClient.put<{ id: string; label: string }>(
          `/api/prompt-templates/${id}`,
          updates,
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to update prompt template' };
        }
        return { success: true, data: { content: `Updated prompt template "${response.data.label}"`, details: response.data } };
      } catch (error) {
        logger.error('prompt_template_update failed', { error });
        return { success: false, error: 'Failed to update prompt template' };
      }
    },

    async prompt_template_delete(params: Record<string, unknown>): Promise<ToolResult> {
      const { id } = params as { id: string };
      try {
        const response = await apiClient.delete(`/api/prompt-templates/${id}`, reqOpts());
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to delete prompt template' };
        }
        return { success: true, data: { content: `Deleted prompt template ${id}`, details: { id } } };
      } catch (error) {
        logger.error('prompt_template_delete failed', { error });
        return { success: false, error: 'Failed to delete prompt template' };
      }
    },

    // ── Inbound Destination tools (Issue #1500) ──────────────

    async inbound_destination_list(params: Record<string, unknown>): Promise<ToolResult> {
      const { channel_type, search, limit, offset } = params as {
        channel_type?: string;
        search?: string;
        limit?: number;
        offset?: number;
      };
      try {
        const queryParams = new URLSearchParams();
        if (channel_type) queryParams.set('channel_type', channel_type);
        if (search) queryParams.set('search', search);
        if (limit !== undefined) queryParams.set('limit', String(limit));
        if (offset !== undefined) queryParams.set('offset', String(offset));

        const response = await apiClient.get<{ items: Array<{ id: string; address: string; channel_type: string; display_name?: string; agent_id?: string }>; total: number }>(
          `/api/inbound-destinations?${queryParams.toString()}`,
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to list inbound destinations' };
        }
        const items = response.data.items ?? [];
        const content = items.length === 0
          ? 'No inbound destinations found.'
          : items.map((d) => `- **${d.address}** [${d.channel_type}]${d.display_name ? ` — ${d.display_name}` : ''}${d.agent_id ? ` (agent: ${d.agent_id})` : ''}`).join('\n');
        return { success: true, data: { content, details: { items, total: response.data.total ?? items.length } } };
      } catch (error) {
        logger.error('inbound_destination_list failed', { error });
        return { success: false, error: 'Failed to list inbound destinations' };
      }
    },

    async inbound_destination_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { id } = params as { id: string };
      try {
        const response = await apiClient.get<{ id: string; address: string; channel_type: string; display_name?: string; agent_id?: string; prompt_template_id?: string; context_id?: string }>(
          `/api/inbound-destinations/${id}`,
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Inbound destination not found' };
        }
        const d = response.data;
        const lines = [`**${d.address}** [${d.channel_type}]`];
        if (d.display_name) lines.push(`Display: ${d.display_name}`);
        if (d.agent_id) lines.push(`Agent: ${d.agent_id}`);
        if (d.prompt_template_id) lines.push(`Prompt Template: ${d.prompt_template_id}`);
        if (d.context_id) lines.push(`Context: ${d.context_id}`);
        return { success: true, data: { content: lines.join('\n'), details: d } };
      } catch (error) {
        logger.error('inbound_destination_get failed', { error });
        return { success: false, error: 'Failed to get inbound destination' };
      }
    },

    async inbound_destination_update(params: Record<string, unknown>): Promise<ToolResult> {
      const { id, ...updates } = params as { id: string; display_name?: string; agent_id?: string | null; prompt_template_id?: string | null; context_id?: string | null };
      try {
        const response = await apiClient.put<{ id: string; address: string; display_name?: string }>(
          `/api/inbound-destinations/${id}`,
          updates,
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to update inbound destination' };
        }
        return { success: true, data: { content: `Updated inbound destination "${response.data.address}"`, details: response.data } };
      } catch (error) {
        logger.error('inbound_destination_update failed', { error });
        return { success: false, error: 'Failed to update inbound destination' };
      }
    },

    // ── Channel Default tools (Issue #1501) ──────────────────

    async channel_default_list(): Promise<ToolResult> {
      try {
        const response = await apiClient.get<Array<{ channel_type: string; agent_id: string; prompt_template_id?: string }>>(
          '/api/channel-defaults',
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to list channel defaults' };
        }
        const items = Array.isArray(response.data) ? response.data : [];
        const content = items.length === 0
          ? 'No channel defaults configured.'
          : items.map((d) => `- **${d.channel_type}**: agent=${d.agent_id}${d.prompt_template_id ? ` prompt=${d.prompt_template_id}` : ''}`).join('\n');
        return { success: true, data: { content, details: { items } } };
      } catch (error) {
        logger.error('channel_default_list failed', { error });
        return { success: false, error: 'Failed to list channel defaults' };
      }
    },

    async channel_default_get(params: Record<string, unknown>): Promise<ToolResult> {
      const { channel_type } = params as { channel_type: string };
      try {
        const response = await apiClient.get<{ channel_type: string; agent_id: string; prompt_template_id?: string; context_id?: string }>(
          `/api/channel-defaults/${channel_type}`,
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Channel default not found' };
        }
        const d = response.data;
        const lines = [`**${d.channel_type}** → agent: ${d.agent_id}`];
        if (d.prompt_template_id) lines.push(`Prompt Template: ${d.prompt_template_id}`);
        if (d.context_id) lines.push(`Context: ${d.context_id}`);
        return { success: true, data: { content: lines.join('\n'), details: d } };
      } catch (error) {
        logger.error('channel_default_get failed', { error });
        return { success: false, error: 'Failed to get channel default' };
      }
    },

    async channel_default_set(params: Record<string, unknown>): Promise<ToolResult> {
      const { channel_type, agent_id, prompt_template_id, context_id } = params as {
        channel_type: string;
        agent_id: string;
        prompt_template_id?: string;
        context_id?: string;
      };
      try {
        const response = await apiClient.put<{ channel_type: string; agent_id: string }>(
          `/api/channel-defaults/${channel_type}`,
          { agent_id, prompt_template_id, context_id },
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to set channel default' };
        }
        return { success: true, data: { content: `Set ${channel_type} default → agent: ${response.data.agent_id}`, details: response.data } };
      } catch (error) {
        logger.error('channel_default_set failed', { error });
        return { success: false, error: 'Failed to set channel default' };
      }
    },

    // ── Namespace management handlers (Issue #1536) ──────────────

    async namespace_list(): Promise<ToolResult> {
      try {
        const response = await apiClient.get<Array<{ namespace: string; role?: string; is_default?: boolean; priority?: number; grant_count?: number }>>(
          '/api/namespaces',
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to list namespaces' };
        }
        const items = Array.isArray(response.data) ? response.data : [];
        if (items.length === 0) {
          return { success: true, data: { content: 'No namespaces found.', details: { items: [] } } };
        }
        const content = items.map((ns) => {
          const parts = [`- **${ns.namespace}**`];
          if (ns.role) parts.push(`role=${ns.role}`);
          if (ns.is_default) parts.push('(default)');
          if (ns.priority !== undefined) parts.push(`priority=${ns.priority}`);
          if (ns.grant_count !== undefined) parts.push(`members=${ns.grant_count}`);
          return parts.join(' ');
        }).join('\n');
        return { success: true, data: { content, details: { items } } };
      } catch (error) {
        logger.error('namespace_list failed', { error });
        return { success: false, error: 'Failed to list namespaces' };
      }
    },

    async namespace_create(params: Record<string, unknown>): Promise<ToolResult> {
      const { name } = params as { name: string };
      try {
        const response = await apiClient.post<{ namespace: string; created: boolean }>(
          '/api/namespaces',
          { name },
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to create namespace' };
        }
        return { success: true, data: { content: `Created namespace **${response.data.namespace}**.`, details: response.data } };
      } catch (error) {
        logger.error('namespace_create failed', { error });
        return { success: false, error: 'Failed to create namespace' };
      }
    },

    async namespace_grant(params: Record<string, unknown>): Promise<ToolResult> {
      const { namespace, email, role, is_default } = params as {
        namespace: string;
        email: string;
        role?: string;
        is_default?: boolean;
      };
      try {
        const response = await apiClient.post<{ id: string; email: string; namespace: string; role: string; is_default: boolean }>(
          `/api/namespaces/${encodeURIComponent(namespace)}/grants`,
          { email, role: role || 'member', is_default: is_default ?? false },
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to grant namespace access' };
        }
        const d = response.data;
        return { success: true, data: { content: `Granted **${d.role}** access to **${d.namespace}** for ${d.email}.`, details: d } };
      } catch (error) {
        logger.error('namespace_grant failed', { error });
        return { success: false, error: 'Failed to grant namespace access' };
      }
    },

    async namespace_members(params: Record<string, unknown>): Promise<ToolResult> {
      const { namespace } = params as { namespace: string };
      try {
        const response = await apiClient.get<{ namespace: string; members: Array<{ id: string; email: string; access: string; is_home: boolean }>; member_count: number }>(
          `/api/namespaces/${encodeURIComponent(namespace)}`,
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to list namespace members' };
        }
        const { members, member_count } = response.data;
        if (members.length === 0) {
          return { success: true, data: { content: `Namespace **${namespace}** has no members.`, details: response.data } };
        }
        const content = [`**${namespace}** — ${member_count} member(s):`, ...members.map((m) => `- ${m.email} (${m.access}${m.is_home ? ', home' : ''})`)].join('\n');
        return { success: true, data: { content, details: response.data } };
      } catch (error) {
        logger.error('namespace_members failed', { error });
        return { success: false, error: 'Failed to list namespace members' };
      }
    },

    async namespace_revoke(params: Record<string, unknown>): Promise<ToolResult> {
      const { namespace, grant_id } = params as { namespace: string; grant_id: string };
      try {
        const response = await apiClient.delete<{ deleted: boolean }>(
          `/api/namespaces/${encodeURIComponent(namespace)}/grants/${encodeURIComponent(grant_id)}`,
          reqOpts(),
        );
        if (!response.success) {
          return { success: false, error: response.error.message || 'Failed to revoke namespace access' };
        }
        return { success: true, data: { content: `Revoked grant ${grant_id} from namespace **${namespace}**.`, details: { grant_id, namespace } } };
      } catch (error) {
        logger.error('namespace_revoke failed', { error });
        return { success: false, error: 'Failed to revoke namespace access' };
      }
    },

    // ── API Onboarding tools (#1784, #1785, #1786) ──────────────────────

    async api_onboard(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createApiOnboardTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async api_recall(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createApiRecallTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async api_get(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createApiGetTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async api_list(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createApiListTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async api_update(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createApiUpdateTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async api_credential_manage(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createApiCredentialManageTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async api_refresh(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createApiRefreshTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async api_remove(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createApiRemoveTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },

    async api_restore(params: Record<string, unknown>): Promise<ToolResult> {
      const tool = createApiRestoreTool({ client: apiClient, logger, config, user_id: getAgentId() });
      return tool.execute(params as Parameters<typeof tool.execute>[0]);
    },
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
  const user_id = getUserScopeKey(
    {
      agentId: context.agent.agentId,
      sessionKey: context.session.sessionId,
    },
    // Backward compat: use userScoping if provided, otherwise default to 'agent'
    config.userScoping ?? 'agent',
  );

  // Resolve namespace config (Issue #1428)
  const resolvedNamespace = resolveNamespaceConfig(config.namespace, context.agent.agentId);
  // Issue #1537: detect whether static recall was explicitly configured
  const hasStaticRecall = Array.isArray(config.namespace?.recall) && config.namespace.recall.length > 0;
  logger.info('Namespace config resolved', {
    agentId: context.agent.agentId,
    defaultNamespace: resolvedNamespace.default,
    recallNamespaces: resolvedNamespace.recall,
    hasStaticRecall,
  });

  // Extract user email from runtime context for identity resolution (#1567).
  // The agent ID (user_id) may be a short name like "troy" which doesn't match
  // user_setting.email. The email is needed for FK-constrained operations.
  const user_email = context.user?.email;

  // Store plugin state
  const state: PluginState = { config, logger, apiClient, agentId: user_id, agentEmail: user_email, resolvedNamespace, hasStaticRecall, lastNamespaceRefreshMs: 0, refreshInFlight: false };

  // Create tool handlers
  const handlers = createToolHandlers(state);

  // Register all 30 tools with correct OpenClaw Gateway execute signature
  // Signature: (toolCallId: string, params: T, signal?: AbortSignal, onUpdate?: (partial: any) => void) => AgentToolResult
  const tools: ToolDefinition[] = [
    {
      name: 'memory_recall',
      description: 'Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.',
      parameters: withNamespaces(memoryRecallSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.memory_recall(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'memory_store',
      description: 'Store a new memory for future reference. Use when the user shares important preferences, facts, or decisions.',
      parameters: withNamespace(memoryStoreSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.memory_store(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'memory_forget',
      description: 'Remove a memory by ID or search query. Use when information is outdated or the user requests deletion.',
      parameters: withNamespaces(memoryForgetSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.memory_forget(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'project_list',
      description: 'List projects for the user. Use to see what projects exist or filter by status.',
      parameters: withNamespaces(projectListSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.project_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'project_get',
      description: 'Get details about a specific project. Use when you need full project information.',
      parameters: withNamespaces(projectGetSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.project_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'project_create',
      description: 'Create a new project. Use when the user wants to start tracking a new initiative.',
      parameters: withNamespace(projectCreateSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.project_create(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'todo_list',
      description: 'List todos, optionally filtered by project or status. Use to see pending tasks.',
      parameters: withNamespaces(todoListSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.todo_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'todo_create',
      description: 'Create a new todo item. Use when the user wants to track a task.',
      parameters: withNamespace(todoCreateSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.todo_create(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'todo_complete',
      description: 'Mark a todo as complete. Use when a task is done.',
      parameters: withNamespaces(todoCompleteSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.todo_complete(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'todo_search',
      description:
        'Search todos and work items by natural language query. Uses semantic and text search to find relevant items. Optionally filter by kind or status.',
      parameters: withNamespaces(todoSearchSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.todo_search(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'project_search',
      description:
        'Search projects by natural language query. Uses semantic and text search to find relevant projects. Optionally filter by status (active, completed, archived).',
      parameters: withNamespaces(projectSearchSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.project_search(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'context_search',
      description:
        'Search across memories, todos, projects, and messages simultaneously. Use when you need broad context about a topic, person, or project. Returns a blended ranked list from all entity types. Optionally filter by entity_types to narrow the search.',
      parameters: withNamespaces(contextSearchSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.context_search(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_search',
      description: 'Search contacts by name, email, or other fields. Use to find people.',
      parameters: withNamespaces(contactSearchSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_search(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_get',
      description: 'Get details about a specific contact. Use when you need full contact information.',
      parameters: withNamespaces(contactGetSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_create',
      description: 'Create a new contact. Supports structured names (given_name, family_name) or display_name. Optionally include email, phone, tags.',
      parameters: withNamespace(contactCreateSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_create(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_update',
      description: 'Update an existing contact. Can change name, notes, tags, and other fields.',
      parameters: withNamespace(contactUpdateSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_update(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_merge',
      description: 'Merge two contacts into one. The survivor keeps all data; the loser is soft-deleted. Use when duplicate contacts are detected.',
      parameters: withNamespace(contactMergeSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_merge(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_tag_add',
      description: 'Add tags to a contact for categorization.',
      parameters: withNamespace(contactTagAddSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_tag_add(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_tag_remove',
      description: 'Remove a tag from a contact.',
      parameters: withNamespace(contactTagRemoveSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_tag_remove(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'contact_resolve',
      description: 'Resolve a sender identity (phone, email, or name) to an existing contact. Use when an inbound message arrives and you need to identify who sent it.',
      parameters: withNamespaces(contactResolveSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.contact_resolve(params);
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
      parameters: withNamespaces(messageSearchSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.message_search(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'thread_list',
      description: 'List message threads (conversations). Use to see recent conversations with contacts. Can filter by channel (SMS/email) or contact.',
      parameters: withNamespaces(threadListSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.thread_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'thread_get',
      description: 'Get a thread with its message history. Use to view the full conversation in a thread.',
      parameters: withNamespaces(threadGetSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.thread_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'relationship_set',
      description:
        "Record a relationship between two people, groups, or organisations. Examples: 'Troy is Alex\\'s partner', 'Sam is a member of The Kelly Household', 'Troy works for Acme Corp'. The system handles directionality and type matching automatically.",
      parameters: withNamespace(relationshipSetSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.relationship_set(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'relationship_query',
      description:
        "Query a contact's relationships. Returns all relationships including family, partners, group memberships, professional connections, etc. Handles directional relationships automatically.",
      parameters: withNamespaces(relationshipQuerySchema),
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
    {
      name: 'links_set',
      description:
        'Create a link between two entities (memory, todo, project, contact, GitHub issue, or URL). Links are bidirectional and can be traversed from either end. Use to connect related items for cross-reference and context discovery.',
      parameters: withNamespace(linksSetSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.links_set(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'links_query',
      description:
        'Query all links for an entity (memory, todo, project, or contact). Returns connected entities including other items, GitHub issues, and URLs. Optionally filter by link target types.',
      parameters: withNamespaces(linksQuerySchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.links_query(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'links_remove',
      description:
        'Remove a link between two entities. Deletes both directions of the link. Use when a connection is no longer relevant or was created in error.',
      parameters: withNamespaces(linksRemoveSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.links_remove(params);
        return toAgentToolResult(result);
      },
    },
    // Prompt template tools (Epic #1497, Issue #1499)
    {
      name: 'prompt_template_list',
      description: 'List prompt templates used for inbound message triage. Filter by channel type (sms, email, ha_observation, general).',
      parameters: promptTemplateListSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.prompt_template_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'prompt_template_get',
      description: 'Get a prompt template by ID. Returns the full template including prompt content.',
      parameters: promptTemplateGetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.prompt_template_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'prompt_template_create',
      description: 'Create a new prompt template for inbound message triage. Requires agentadmin access.',
      parameters: promptTemplateCreateSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.prompt_template_create(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'prompt_template_update',
      description: 'Update an existing prompt template. Can change label, content, channel type, or set as default.',
      parameters: promptTemplateUpdateSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.prompt_template_update(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'prompt_template_delete',
      description: 'Soft-delete a prompt template (sets is_active to false). Template can still be viewed but will not be used for routing.',
      parameters: promptTemplateDeleteSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.prompt_template_delete(params);
        return toAgentToolResult(result);
      },
    },
    // ── Inbound Destination tools (Issue #1500) ──────────────
    {
      name: 'inbound_destination_list',
      description: 'List discovered inbound destinations (phone numbers and email addresses). Auto-created when messages arrive.',
      parameters: inboundDestinationListSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.inbound_destination_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'inbound_destination_get',
      description: 'Get an inbound destination by ID. Returns routing config (agent, prompt template, context).',
      parameters: inboundDestinationGetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.inbound_destination_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'inbound_destination_update',
      description: 'Update routing overrides for an inbound destination. Set agent, prompt template, or context for routing.',
      parameters: inboundDestinationUpdateSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.inbound_destination_update(params);
        return toAgentToolResult(result);
      },
    },
    // ── Channel Default tools (Issue #1501) ──────────────────
    {
      name: 'channel_default_list',
      description: 'List all channel defaults (per-channel routing config). Shows which agent handles each channel type.',
      parameters: channelDefaultListSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.channel_default_list();
        return toAgentToolResult(result);
      },
    },
    {
      name: 'channel_default_get',
      description: 'Get the default routing config for a specific channel type (sms, email, ha_observation).',
      parameters: channelDefaultGetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.channel_default_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'channel_default_set',
      description: 'Set or update the default routing config for a channel type. Requires agentadmin access.',
      parameters: channelDefaultSetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.channel_default_set(params);
        return toAgentToolResult(result);
      },
    },
    // ── Namespace management tools (Issue #1536) ─────────────────
    {
      name: 'namespace_list',
      description: 'List all namespaces accessible to the current user or agent. Shows role, priority, and default status.',
      parameters: namespaceListSchema,
      execute: async (_toolCallId: string, _params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.namespace_list();
        return toAgentToolResult(result);
      },
    },
    {
      name: 'namespace_create',
      description: 'Create a new namespace. The creating user becomes the owner automatically.',
      parameters: namespaceCreateSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.namespace_create(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'namespace_grant',
      description: 'Grant a user access to a namespace with a specific role. Use to share data between users.',
      parameters: namespaceGrantSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.namespace_grant(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'namespace_members',
      description: 'List all members of a namespace with their roles and default status.',
      parameters: namespaceMembersSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.namespace_members(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'namespace_revoke',
      description: 'Revoke a user\'s access to a namespace by grant ID. Requires owner or admin role.',
      parameters: namespaceRevokeSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.namespace_revoke(params);
        return toAgentToolResult(result);
      },
    },

    // ── API Onboarding tools (#1784, #1785, #1786) ──────────────────────

    {
      name: 'api_onboard',
      description: 'Onboard a new API by providing its OpenAPI spec URL or inline content. Parses the spec into searchable memories and optionally stores credentials.',
      parameters: withNamespace(apiOnboardSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.api_onboard(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'api_recall',
      description: 'Search onboarded API memories to find endpoints, operations, and capabilities. Returns operation details including method, path, parameters, and credentials.',
      parameters: withNamespaces(apiRecallSchema),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.api_recall(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'api_get',
      description: 'Get details about a specific onboarded API source including its status, spec version, and tags.',
      parameters: apiGetSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.api_get(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'api_list',
      description: 'List all onboarded API sources. Optionally filter by status (active, error, disabled).',
      parameters: apiListSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.api_list(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'api_update',
      description: 'Update an onboarded API source. Change its name, description, tags, or status.',
      parameters: apiUpdateSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.api_update(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'api_credential_manage',
      description: 'Manage credentials for an onboarded API source: add, update, or remove authentication headers.',
      parameters: apiCredentialManageSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.api_credential_manage(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'api_refresh',
      description: 'Refresh an API source by re-fetching its OpenAPI spec and updating memories. Returns a diff summary.',
      parameters: apiRefreshSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.api_refresh(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'api_remove',
      description: 'Soft-delete an onboarded API source. Can be restored later with api_restore.',
      parameters: apiRemoveSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.api_remove(params);
        return toAgentToolResult(result);
      },
    },
    {
      name: 'api_restore',
      description: 'Restore a previously soft-deleted API source.',
      parameters: apiRestoreSchema,
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await handlers.api_restore(params);
        return toAgentToolResult(result);
      },
    },
  ];

  // ── Terminal tools (Issue #1858) ──────────────────────────────
  // Register all 20 terminal plugin tools using factory pattern.

  const termToolOpts = { client: apiClient, logger, config, user_id };

  const terminalToolFactories = [
    createTerminalConnectionListTool,
    createTerminalConnectionCreateTool,
    createTerminalConnectionUpdateTool,
    createTerminalConnectionDeleteTool,
    createTerminalConnectionTestTool,
    createTerminalCredentialCreateTool,
    createTerminalCredentialListTool,
    createTerminalCredentialDeleteTool,
    createTerminalSessionStartTool,
    createTerminalSessionListTool,
    createTerminalSessionTerminateTool,
    createTerminalSessionInfoTool,
    createTerminalSendCommandTool,
    createTerminalSendKeysTool,
    createTerminalCapturePaneTool,
    createTerminalSearchTool,
    createTerminalAnnotateTool,
    createTerminalTunnelCreateTool,
    createTerminalTunnelListTool,
    createTerminalTunnelCloseTool,
  ] as const;

  for (const factory of terminalToolFactories) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- factory functions have heterogeneous option types that share the same shape
    const tool = (factory as (opts: typeof termToolOpts) => { name: string; description: string; parameters: unknown; execute: (params: any) => Promise<any> })(termToolOpts);

    tools.push({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters as import('zod').ZodTypeAny),
      execute: async (_toolCallId: string, params: Record<string, unknown>, _signal?: AbortSignal, _onUpdate?: (partial: unknown) => void) => {
        const result = await tool.execute(params);
        return toAgentToolResult(result);
      },
    });
  }

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
      getAgentId: () => state.agentId,
      timeoutMs: HOOK_TIMEOUT_MS,
    });

    /**
     * before_agent_start handler: Extracts the user's prompt from the event,
     * performs semantic memory search, and returns { prependContext } to inject
     * relevant memories into the conversation.
     */
    const beforeAgentStartHandler = async (
      event: PluginHookBeforeAgentStartEvent,
      ctx: PluginHookAgentContext,
    ): Promise<PluginHookBeforeAgentStartResult | undefined> => {
      // Issue #1655: Detect concurrent session conflict
      if (state.activeSessionKey && ctx.sessionKey && state.activeSessionKey !== ctx.sessionKey) {
        logger.warn('Concurrent session detected — agent identity may be stale', {
          previousSession: state.activeSessionKey,
          newSession: ctx.sessionKey,
          previousAgentId: state.agentId,
        });
      }
      state.activeSessionKey = ctx.sessionKey;

      // Issue #1644: resolve agent ID from hook context and update state
      const resolvedId = resolveAgentId(ctx, config.agentId, state.agentId);
      if (resolvedId !== state.agentId) {
        const previousId = state.agentId;
        state.agentId = resolvedId;
        state.resolvedNamespace = resolveNamespaceConfig(config.namespace, resolvedId);
        logger.info('Agent ID resolved from hook context', {
          previousId,
          resolvedId,
          defaultNamespace: state.resolvedNamespace.default,
          recallNamespaces: state.resolvedNamespace.recall,
        });
      }

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
      getAgentId: () => state.agentId,
      timeoutMs: HOOK_TIMEOUT_MS * 2, // Allow more time for capture (10s)
    });

    /**
     * agent_end handler: Extracts messages from the completed conversation,
     * filters sensitive content, and posts to the capture API for memory storage.
     */
    const agentEndHandler = async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext): Promise<void> => {
      // Issue #1644: ensure agent ID is resolved even if before_agent_start didn't fire
      const resolvedId = resolveAgentId(ctx, config.agentId, state.agentId);
      if (resolvedId !== state.agentId) {
        state.agentId = resolvedId;
        state.resolvedNamespace = resolveNamespaceConfig(config.namespace, resolvedId);
        logger.info('Agent ID resolved from agent_end context', {
          resolvedId,
          defaultNamespace: state.resolvedNamespace.default,
        });
      }

      logger.debug('Auto-capture hook triggered', {
        message_count: event.messages?.length ?? 0,
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

      // Issue #1655: Clear session key after agent ends
      state.activeSessionKey = undefined;
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

  // Register auto-linking hook for inbound messages (Issue #1223)
  // When an inbound SMS/email arrives, automatically link the thread to
  // matching contacts (by sender email/phone) and related projects/todos
  // (by semantic content matching).
  {
    /**
     * message_received handler: Extracts sender and content info from the
     * inbound message event and runs auto-linking in the background.
     * Failures are logged but never crash message processing.
     */
    const messageReceivedHandler = async (event: PluginHookMessageReceivedEvent, _ctx: PluginHookAgentContext): Promise<void> => {
      // Skip if no thread ID (nothing to link to)
      if (!event.thread_id) {
        logger.debug('Auto-link skipped: no thread_id in message_received event');
        return;
      }

      // Skip if no content and no sender info (nothing to match on)
      if (!event.content && !event.senderEmail && !event.senderPhone && !event.sender) {
        logger.debug('Auto-link skipped: no content or sender info in event');
        return;
      }

      try {
        await autoLinkInboundMessage({
          client: apiClient,
          logger,
          getAgentId: () => state.agentId,
          message: {
            thread_id: event.thread_id,
            senderEmail: event.senderEmail ?? (event.sender?.includes('@') ? event.sender : undefined),
            senderPhone: event.senderPhone ?? (event.sender && !event.sender.includes('@') ? event.sender : undefined),
            content: event.content ?? '',
          },
        });
      } catch (error) {
        // Hook errors should never crash inbound message processing
        logger.error('Auto-link hook failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    if (typeof api.on === 'function') {
      api.on('message_received', messageReceivedHandler as (...args: unknown[]) => unknown);
    } else {
      api.registerHook('messageReceived', messageReceivedHandler as (event: unknown) => Promise<unknown>);
    }
  }

  // Register Gateway RPC methods (Issue #324)
  const gatewayMethods = createGatewayMethods({
    logger,
    apiClient,
    getAgentId: () => state.agentId,
  });
  registerGatewayRpcMethods(api, gatewayMethods);

  // Register OAuth Gateway RPC methods (Issue #1054)
  const oauthGatewayMethods = createOAuthGatewayMethods({
    logger,
    apiClient,
    getAgentId: () => state.agentId,
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
    getAgentId: () => state.agentId,
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
          const response = await apiClient.get('/api/health', { user_id: state.agentId, user_email: state.agentEmail });
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

  // Issue #1644: warn if agent ID is "unknown" at registration (will be resolved from hook context later)
  if (context.agent.agentId === 'unknown' && !config.agentId) {
    logger.warn(
      'Agent ID not available at registration time — will resolve from hook context. ' +
      'Set config.agentId for explicit override. (Issue #1644)',
    );
  }

  logger.info('OpenClaw Projects plugin registered', {
    agentId: context.agent.agentId,
    sessionId: context.session.sessionId,
    user_id: state.agentId,
    toolCount: tools.length,
    config: redactConfig(config),
  });

  // Issue #1564: Log resolved namespace config on startup for debugging
  logger.debug('Namespace config resolved', {
    default: state.resolvedNamespace.default,
    recall: state.resolvedNamespace.recall,
    hasStaticRecall,
    refreshInterval: config.namespaceRefreshIntervalMs ?? 300_000,
  });

  // Issue #1537: Fire-and-forget initial namespace discovery.
  // Static recall config takes precedence — only discover dynamically if recall is not explicitly set.
  const refreshInterval = config.namespaceRefreshIntervalMs ?? 300_000;
  if (refreshInterval > 0 && !hasStaticRecall) {
    refreshNamespacesAsync(state).catch((err) => {
      logger.warn('Initial namespace discovery failed', { error: err instanceof Error ? err.message : String(err) });
    });
  }
};

/** Default export for OpenClaw 2026 API compatibility */
export default registerOpenClaw;

/** Export JSON Schemas for external use */
export const schemas = {
  memoryRecall: withNamespaces(memoryRecallSchema),
  memoryStore: withNamespace(memoryStoreSchema),
  memoryForget: withNamespaces(memoryForgetSchema),
  projectList: withNamespaces(projectListSchema),
  projectGet: withNamespaces(projectGetSchema),
  projectCreate: withNamespace(projectCreateSchema),
  todoList: withNamespaces(todoListSchema),
  todoCreate: withNamespace(todoCreateSchema),
  todoComplete: withNamespaces(todoCompleteSchema),
  todoSearch: withNamespaces(todoSearchSchema),
  projectSearch: withNamespaces(projectSearchSchema),
  contactSearch: withNamespaces(contactSearchSchema),
  contactGet: withNamespaces(contactGetSchema),
  contactCreate: withNamespace(contactCreateSchema),
  contactUpdate: withNamespace(contactUpdateSchema),
  contactMerge: withNamespace(contactMergeSchema),
  contactTagAdd: withNamespace(contactTagAddSchema),
  contactTagRemove: withNamespace(contactTagRemoveSchema),
  contactResolve: withNamespaces(contactResolveSchema),
  smsSend: smsSendSchema,
  emailSend: emailSendSchema,
  messageSearch: withNamespaces(messageSearchSchema),
  threadList: withNamespaces(threadListSchema),
  threadGet: withNamespaces(threadGetSchema),
  relationshipSet: withNamespace(relationshipSetSchema),
  relationshipQuery: withNamespaces(relationshipQuerySchema),
  fileShare: fileShareSchema,
  skillStorePut: skillStorePutSchema,
  skillStoreGet: skillStoreGetSchema,
  skillStoreList: skillStoreListSchema,
  skillStoreDelete: skillStoreDeleteSchema,
  skillStoreSearch: skillStoreSearchSchema,
  skillStoreCollections: skillStoreCollectionsSchema,
  skillStoreAggregate: skillStoreAggregateSchema,
  namespaceList: namespaceListSchema,
  namespaceCreate: namespaceCreateSchema,
  namespaceGrant: namespaceGrantSchema,
  namespaceMembers: namespaceMembersSchema,
  namespaceRevoke: namespaceRevokeSchema,
};
