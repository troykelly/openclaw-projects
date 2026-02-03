/**
 * OpenClaw Plugin API types.
 *
 * These types define the contract between plugins and the OpenClaw Gateway runtime.
 * Based on OpenClaw 2026 plugin architecture.
 */

import type { Logger } from '../logger.js'

/** JSON Schema for tool parameters */
export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null'
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
  additionalProperties?: boolean | JSONSchema
  description?: string
  default?: unknown
}

export interface JSONSchemaProperty {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null'
  description?: string
  default?: unknown
  enum?: string[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  items?: JSONSchema | JSONSchemaProperty
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
  format?: string
}

/** Tool execution context */
export interface ToolContext {
  userId?: string
  agentId?: string
  sessionId?: string
  requestId?: string
}

/** Tool execution result */
export interface ToolResult {
  success: boolean
  data?: {
    content: string
    details?: Record<string, unknown>
  }
  error?: string
}

/** Tool definition for api.registerTool() */
export interface ToolDefinition {
  /** Tool name (snake_case) */
  name: string
  /** Human-readable description shown to agents */
  description: string
  /** JSON Schema for tool parameters */
  parameters: JSONSchema
  /** Tool execution function */
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

/** Hook event types */
export type HookEvent =
  | 'beforeAgentStart'
  | 'afterAgentStart'
  | 'beforeAgentEnd'
  | 'agentEnd'
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'messageReceived'
  | 'messageSent'

/** Hook handler function */
export type HookHandler<T = unknown> = (event: T) => Promise<T | null | void>

/** CLI registration callback */
export interface CliRegistrationContext {
  /** Commander program instance */
  program: {
    command: (name: string) => {
      description: (desc: string) => {
        option: (flags: string, desc: string) => unknown
        action: (handler: (...args: unknown[]) => void | Promise<void>) => unknown
      }
    }
  }
}

export type CliRegistrationCallback = (context: CliRegistrationContext) => void

/** Service definition for background processes */
export interface ServiceDefinition {
  /** Unique service ID */
  id: string
  /** Called when plugin starts */
  start: () => Promise<void>
  /** Called when plugin stops */
  stop: () => Promise<void>
}

/** OpenClaw Plugin API provided to plugins */
export interface OpenClawPluginAPI {
  /** Current plugin configuration (validated against configSchema) */
  config: Record<string, unknown>

  /** Logger instance */
  logger: Logger

  /** Plugin ID */
  pluginId: string

  /** Runtime utilities */
  runtime?: {
    tts?: {
      textToSpeechTelephony: (
        text: string,
        options?: { voice?: string }
      ) => Promise<{ pcm: Buffer; sampleRate: number }>
    }
  }

  /**
   * Register a tool with the OpenClaw Gateway.
   * Tools are exposed to agents for execution.
   */
  registerTool: (tool: ToolDefinition) => void

  /**
   * Register a lifecycle hook.
   * Hooks allow intercepting and modifying plugin/agent lifecycle events.
   */
  registerHook: <T = unknown>(event: HookEvent, handler: HookHandler<T>) => void

  /**
   * Register CLI commands.
   * Commands are available via `openclaw <plugin-id> <command>`.
   */
  registerCli: (callback: CliRegistrationCallback) => void

  /**
   * Register a background service.
   * Services are started when the plugin loads and stopped when it unloads.
   */
  registerService: (service: ServiceDefinition) => void

  /**
   * Register an RPC method for the Gateway.
   * Methods are exposed as `pluginId.methodName`.
   */
  registerGatewayMethod: <T = unknown, R = unknown>(
    methodName: string,
    handler: (params: T) => Promise<R>
  ) => void
}

/** Plugin initialization function signature */
export type PluginInitializer = (api: OpenClawPluginAPI) => void | Promise<void>

/** Object-based plugin definition (alternative to function export) */
export interface PluginDefinition {
  id: string
  name: string
  configSchema?: JSONSchema
  register: PluginInitializer
}
