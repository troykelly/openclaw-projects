/**
 * OpenClaw Projects Plugin
 *
 * This plugin provides memory management, projects, todos, and contacts
 * integration for OpenClaw agents.
 *
 * Registration pattern:
 * - OpenClaw 2026 API: `export default (api) => { ... }` (recommended)
 * - Legacy API: `register(ctx)` returns plugin instance
 */

// Re-export the OpenClaw 2026 API default export
export { default, registerOpenClaw, schemas } from './register-openclaw.js'

// Export OpenClaw API types
export type {
  OpenClawPluginAPI,
  PluginInitializer,
  PluginDefinition,
  ToolDefinition,
  ToolContext,
  ToolResult,
  JSONSchema,
  JSONSchemaProperty,
  HookEvent,
  HookHandler,
  PluginHookName,
  PluginHookBeforeAgentStartEvent,
  PluginHookAgentContext,
  PluginHookBeforeAgentStartResult,
  PluginHookAgentEndEvent,
  CliRegistrationCallback,
  CliRegistrationContext,
  ServiceDefinition,
} from './types/openclaw-api.js'

import type { PluginConfig, } from './config.js'
import {
  validateConfig,
  validateRawConfig,
  redactConfig,
} from './config.js'
import { createLogger, type Logger } from './logger.js'
import { createApiClient, type ApiClient } from './api-client.js'
import { extractContext, getUserScopeKey, type PluginContext } from './context.js'
import {
  createAutoRecallHook,
  createAutoCaptureHook,
  createHealthCheck,
  type AutoRecallEvent,
  type AutoRecallResult,
  type AutoCaptureEvent,
  type HealthCheckResult,
} from './hooks.js'
import {
  createCliCommands,
  type CliCommands,
} from './cli.js'
import {
  createMemoryRecallTool,
  createMemoryStoreTool,
  createMemoryForgetTool,
  createProjectListTool,
  createProjectGetTool,
  createProjectCreateTool,
  createTodoListTool,
  createTodoCreateTool,
  createTodoCompleteTool,
  createContactSearchTool,
  createContactGetTool,
  createContactCreateTool,
  type MemoryRecallTool,
  type MemoryStoreTool,
  type MemoryForgetTool,
  type ProjectListTool,
  type ProjectGetTool,
  type ProjectCreateTool,
  type TodoListTool,
  type TodoCreateTool,
  type TodoCompleteTool,
  type ContactSearchTool,
  type ContactGetTool,
  type ContactCreateTool,
} from './tools/index.js'

/** Plugin registration context from OpenClaw runtime */
export interface RegistrationContext {
  config: Record<string, unknown>
  logger?: Logger
  runtime?: unknown
}

/** Tool instances created for the plugin */
export interface PluginTools {
  memoryRecall: MemoryRecallTool
  memoryStore: MemoryStoreTool
  memoryForget: MemoryForgetTool
  projectList: ProjectListTool
  projectGet: ProjectGetTool
  projectCreate: ProjectCreateTool
  todoList: TodoListTool
  todoCreate: TodoCreateTool
  todoComplete: TodoCompleteTool
  contactSearch: ContactSearchTool
  contactGet: ContactGetTool
  contactCreate: ContactCreateTool
}

/** Lifecycle hooks for the plugin */
export interface PluginHooks {
  beforeAgentStart: (event: AutoRecallEvent) => Promise<AutoRecallResult | null>
  agentEnd: (event: AutoCaptureEvent) => Promise<void>
}

/** Plugin instance after registration */
export interface PluginInstance {
  id: string
  name: string
  kind: string
  config: PluginConfig
  apiClient: ApiClient
  context: PluginContext
  tools: PluginTools
  hooks: PluginHooks
  cli: CliCommands
  healthCheck: () => Promise<HealthCheckResult>
}

/**
 * Creates a plugin instance from resolved configuration.
 * Internal helper used by both sync and async registration.
 */
function createPluginInstance(
  config: PluginConfig,
  logger: Logger,
  runtime: unknown
): PluginInstance {
  // Create API client
  const apiClient = createApiClient({ config, logger })

  // Extract context
  const context = extractContext(runtime)

  // Determine user scope key based on config
  const userId = getUserScopeKey(
    {
      agentId: context.agent.agentId,
      sessionKey: context.session.sessionId,
    },
    config.userScoping
  )

  // Create tools
  const tools: PluginTools = {
    memoryRecall: createMemoryRecallTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    memoryStore: createMemoryStoreTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    memoryForget: createMemoryForgetTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    projectList: createProjectListTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    projectGet: createProjectGetTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    projectCreate: createProjectCreateTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    todoList: createTodoListTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    todoCreate: createTodoCreateTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    todoComplete: createTodoCompleteTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    contactSearch: createContactSearchTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    contactGet: createContactGetTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    contactCreate: createContactCreateTool({
      client: apiClient,
      logger,
      config,
      userId,
    }),
  }

  // Create lifecycle hooks
  const hooks: PluginHooks = {
    beforeAgentStart: createAutoRecallHook({
      client: apiClient,
      logger,
      config,
      userId,
    }),
    agentEnd: createAutoCaptureHook({
      client: apiClient,
      logger,
      config,
      userId,
    }),
  }

  // Create health check
  const healthCheck = createHealthCheck({ client: apiClient, logger })

  // Create CLI commands
  const cli = createCliCommands({
    client: apiClient,
    logger,
    config,
    userId,
  })

  logger.info('Plugin registered', {
    agentId: context.agent.agentId,
    sessionId: context.session.sessionId,
    userId,
    config: redactConfig(config),
  })

  return {
    id: 'openclaw-projects',
    name: 'OpenClaw Projects Plugin',
    kind: 'memory',
    config,
    apiClient,
    context,
    tools,
    hooks,
    cli,
    healthCheck,
  }
}

/**
 * Registers the plugin with OpenClaw.
 *
 * Validates the raw configuration and resolves direct secret values
 * to produce a fully initialized plugin instance.
 */
export function register(ctx: RegistrationContext): PluginInstance {
  const logger = ctx.logger ?? createLogger('openclaw-projects')

  // Validate as raw config first to check structure
  const rawConfig = validateRawConfig(ctx.config)

  // For sync registration, we require direct values - file/command refs won't work
  // Build a resolved config from direct values only
  const config = validateConfig({
    apiUrl: rawConfig.apiUrl,
    apiKey: rawConfig.apiKey ?? '',
    twilioAccountSid: rawConfig.twilioAccountSid,
    twilioAuthToken: rawConfig.twilioAuthToken,
    twilioPhoneNumber: rawConfig.twilioPhoneNumber,
    postmarkToken: rawConfig.postmarkToken,
    postmarkFromEmail: rawConfig.postmarkFromEmail,
    secretCommandTimeout: rawConfig.secretCommandTimeout,
    autoRecall: rawConfig.autoRecall,
    autoCapture: rawConfig.autoCapture,
    userScoping: rawConfig.userScoping,
    maxRecallMemories: rawConfig.maxRecallMemories,
    minRecallScore: rawConfig.minRecallScore,
    timeout: rawConfig.timeout,
    maxRetries: rawConfig.maxRetries,
    debug: rawConfig.debug,
  })

  return createPluginInstance(config, logger, ctx.runtime)
}

/** Plugin definition object for OpenClaw */
export const plugin = {
  id: 'openclaw-projects',
  name: 'OpenClaw Projects Plugin',
  kind: 'memory',
  register,
}

// Re-export types and utilities
export type { PluginConfig, RawPluginConfig } from './config.js'
export {
  validateConfig,
  safeValidateConfig,
  validateRawConfig,
  safeValidateRawConfig,
  resolveConfigSecrets,
  resolveConfigSecretsSync,
  redactConfig,
} from './config.js'
export type { SecretConfig } from './secrets.js'
export { resolveSecret, resolveSecretSync, resolveSecrets, clearSecretCache, clearCachedSecret } from './secrets.js'
export type { Logger } from './logger.js'
export { createLogger, redactSensitive } from './logger.js'
export type { ApiClient, ApiResponse, ApiError } from './api-client.js'
export { createApiClient } from './api-client.js'
export type {
  PluginContext,
  UserContext,
  AgentContext,
  SessionContext,
} from './context.js'
export { extractContext, getUserScopeKey } from './context.js'

// Re-export tool types and factories
export type {
  MemoryRecallTool,
  MemoryRecallParams,
  MemoryRecallResult,
  Memory,
  MemoryStoreTool,
  MemoryStoreParams,
  MemoryStoreResult,
  StoredMemory,
  MemoryForgetTool,
  MemoryForgetParams,
  MemoryForgetResult,
  ProjectListTool,
  ProjectGetTool,
  ProjectCreateTool,
  ProjectListParams,
  ProjectGetParams,
  ProjectCreateParams,
  ProjectListResult,
  ProjectGetResult,
  ProjectCreateResult,
  Project,
  ProjectToolOptions,
  TodoListTool,
  TodoCreateTool,
  TodoCompleteTool,
  TodoListParams,
  TodoCreateParams,
  TodoCompleteParams,
  TodoListResult,
  TodoCreateResult,
  TodoCompleteResult,
  Todo,
  TodoToolOptions,
  ContactSearchTool,
  ContactGetTool,
  ContactCreateTool,
  ContactSearchParams,
  ContactGetParams,
  ContactCreateParams,
  ContactSearchResult,
  ContactGetResult,
  ContactCreateResult,
  Contact,
  ContactToolOptions,
} from './tools/index.js'
export {
  createMemoryRecallTool,
  createMemoryStoreTool,
  createMemoryForgetTool,
  createProjectListTool,
  createProjectGetTool,
  createProjectCreateTool,
  createTodoListTool,
  createTodoCreateTool,
  createTodoCompleteTool,
  createContactSearchTool,
  createContactGetTool,
  createContactCreateTool,
  MemoryRecallParamsSchema,
  MemoryStoreParamsSchema,
  MemoryForgetParamsSchema,
  MemoryCategory,
  ProjectListParamsSchema,
  ProjectGetParamsSchema,
  ProjectCreateParamsSchema,
  ProjectStatus,
  TodoListParamsSchema,
  TodoCreateParamsSchema,
  TodoCompleteParamsSchema,
  ContactSearchParamsSchema,
  ContactGetParamsSchema,
  ContactCreateParamsSchema,
} from './tools/index.js'

// Re-export hooks
export type {
  AutoRecallEvent,
  AutoRecallResult,
  AutoCaptureEvent,
  HealthCheckResult,
  AutoRecallHookOptions,
  AutoCaptureHookOptions,
  HealthCheckOptions,
} from './hooks.js'
export {
  createAutoRecallHook,
  createAutoCaptureHook,
  createHealthCheck,
} from './hooks.js'

// Re-export CLI
export type {
  CliContext,
  CliCommands,
  CommandResult,
  RecallOptions,
  ExportOptions,
  StatusData,
  UsersData,
  RecallData,
  StatsData,
  ExportData,
  MemoryItem,
} from './cli.js'
export {
  createCliCommands,
  createStatusCommand,
  createUsersCommand,
  createRecallCommand,
  createStatsCommand,
  createExportCommand,
} from './cli.js'

// Re-export Gateway RPC methods
export type {
  NotificationEvent,
  SubscribeParams,
  SubscribeResult,
  UnsubscribeParams,
  UnsubscribeResult,
  GetNotificationsParams,
  GetNotificationsResult,
  Notification,
  GatewayMethods,
  GatewayMethodsOptions,
} from './gateway/rpc-methods.js'
export {
  createGatewayMethods,
  registerGatewayRpcMethods,
} from './gateway/rpc-methods.js'

// Re-export notification service
export type {
  NotificationServiceConfig,
  NotificationServiceEvents,
  NotificationServiceOptions,
  NotificationService,
} from './services/notification-service.js'
export {
  createNotificationService,
} from './services/notification-service.js'
