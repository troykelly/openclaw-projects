/**
 * OpenClaw OpenClaw Projects Plugin
 *
 * This plugin provides memory management, projects, todos, and contacts
 * integration for OpenClaw agents.
 */

import type { PluginConfig } from './config.js'
import { validateConfig } from './config.js'
import { createLogger, type Logger } from './logger.js'
import { createApiClient, type ApiClient } from './api-client.js'
import { extractContext, type PluginContext } from './context.js'
import { tools } from './tools/index.js'

/** Plugin registration context from OpenClaw runtime */
export interface RegistrationContext {
  config: Record<string, unknown>
  logger?: Logger
  runtime?: unknown
}

/** Plugin instance after registration */
export interface PluginInstance {
  id: string
  name: string
  kind: string
  config: PluginConfig
  apiClient: ApiClient
  context: PluginContext
  tools: typeof tools
}

/**
 * Registers the plugin with OpenClaw.
 * Called by the OpenClaw runtime during plugin initialization.
 */
export function register(ctx: RegistrationContext): PluginInstance {
  const logger = ctx.logger ?? createLogger('openclaw-projects')

  // Validate configuration
  const config = validateConfig(ctx.config)

  // Create API client
  const apiClient = createApiClient({ config, logger })

  // Extract context
  const context = extractContext(ctx.runtime)

  logger.info('Plugin registered', {
    agentId: context.agent.agentId,
    sessionId: context.session.sessionId,
  })

  return {
    id: 'openclaw-projects',
    name: 'OpenClaw Projects Plugin',
    kind: 'memory',
    config,
    apiClient,
    context,
    tools,
  }
}

/** Plugin definition object for OpenClaw */
export const plugin = {
  id: 'openclaw-projects',
  name: 'OpenClaw Projects Plugin',
  kind: 'memory',
  register,
}

// Re-export types and utilities
export type { PluginConfig } from './config.js'
export { validateConfig, safeValidateConfig } from './config.js'
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
export { extractContext } from './context.js'
