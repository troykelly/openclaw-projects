/**
 * OpenClaw Plugin API types.
 *
 * These types define the contract between plugins and the OpenClaw Gateway runtime.
 * Based on OpenClaw 2026 plugin architecture.
 *
 * All types are defined locally because the `openclaw/plugin-sdk` public API
 * does not export the individual hook types (PluginHookName, etc.) — they exist
 * only as internal types within the SDK's plugins/types.d.ts. Importing from
 * deep internal paths would be fragile and could break on any SDK update.
 *
 * The SDK's OpenClawPluginApi type is exported but uses different shapes
 * (e.g., AnyAgentTool vs our ToolDefinition, OpenClawConfig vs Record<string, unknown>).
 *
 * See tests/sdk-type-compatibility.test.ts for compile-time checks that verify
 * our local types remain compatible with the SDK's definitions.
 *
 * Reference: docs/knowledge/openclaw-hook-contract.md
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

/** Tool execution result (internal format used by handlers) */
export interface ToolResult {
  success: boolean
  data?: {
    content: string
    details?: Record<string, unknown>
  }
  error?: string
}

/**
 * AgentToolResult - The format OpenClaw Gateway expects from tool execute functions.
 * This is the standard return type for all tool executions.
 *
 * Note: The SDK's AgentToolResult (from @mariozechner/pi-agent-core) uses
 * `(TextContent | ImageContent)[]` which is a different shape. Our simplified
 * version uses `{ type: 'text'; text: string }[]` to avoid pulling in the
 * pi-agent-core dependency.
 */
export interface AgentToolResult {
  content: Array<{ type: 'text'; text: string }>
}

/**
 * Tool execute function signature as expected by OpenClaw Gateway.
 *
 * @param toolCallId - Unique identifier for this tool call
 * @param params - Tool parameters (validated against JSON Schema)
 * @param signal - Optional AbortSignal for cancellation
 * @param onUpdate - Optional callback for streaming partial results
 */
export type AgentToolExecute<T = Record<string, unknown>> = (
  toolCallId: string,
  params: T,
  signal?: AbortSignal,
  onUpdate?: (partial: unknown) => void
) => Promise<AgentToolResult>

/**
 * Tool definition for api.registerTool().
 *
 * Note: The SDK uses AnyAgentTool (from @mariozechner/pi-agent-core) which
 * extends Tool<TSchema> with TypeBox schemas. Our simplified version uses
 * plain JSON Schema objects to avoid the TypeBox/pi-agent-core dependency.
 */
export interface ToolDefinition {
  /** Tool name (snake_case) */
  name: string
  /** Human-readable description shown to agents */
  description: string
  /** JSON Schema for tool parameters */
  parameters: JSONSchema
  /** Tool execution function (OpenClaw Gateway signature) */
  execute: AgentToolExecute
}

// ── OpenClaw Hook Contract Types ─────────────────────────────────────────────
// These match the actual OpenClaw Gateway hook contract.
// The SDK defines these in plugins/types.d.ts but does not export them via
// the openclaw/plugin-sdk public API. They are defined locally here and
// verified against the SDK via tests/sdk-type-compatibility.test.ts.
// See: docs/knowledge/openclaw-hook-contract.md

/**
 * Hook names using the actual OpenClaw snake_case convention.
 * Preferred over legacy camelCase names.
 */
export type PluginHookName =
  | 'before_agent_start'
  | 'agent_end'
  | 'before_compaction'
  | 'after_compaction'
  | 'message_received'
  | 'message_sending'
  | 'message_sent'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'tool_result_persist'
  | 'session_start'
  | 'session_end'
  | 'gateway_start'
  | 'gateway_stop'

/** Event payload for before_agent_start hook */
export interface PluginHookBeforeAgentStartEvent {
  /** The user's actual prompt text */
  prompt: string
  /** Previous conversation messages (optional) */
  messages?: unknown[]
}

/** Context passed as second argument to hook handlers */
export interface PluginHookAgentContext {
  agentId?: string
  sessionKey?: string
  workspaceDir?: string
  messageProvider?: string
}

/** Return value from before_agent_start hook */
export interface PluginHookBeforeAgentStartResult {
  /** Append to the system prompt */
  systemPrompt?: string
  /** Prepend to conversation context */
  prependContext?: string
}

/** Event payload for agent_end hook */
export interface PluginHookAgentEndEvent {
  /** Full conversation messages */
  messages: unknown[]
  /** Whether the agent completed successfully */
  success: boolean
  /** Error message if the agent failed */
  error?: string
  /** Duration of the agent run in milliseconds */
  durationMs?: number
}

// ── Legacy Hook Types (kept for backwards compatibility) ─────────────────────

/** Legacy hook event types (camelCase) */
export type HookEvent =
  | 'beforeAgentStart'
  | 'afterAgentStart'
  | 'beforeAgentEnd'
  | 'agentEnd'
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'messageReceived'
  | 'messageSent'

/** Legacy hook handler function */
export type HookHandler<T = unknown> = (event: T) => Promise<T | null | undefined>

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
export interface OpenClawPluginApi {
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
   * Register a lifecycle hook using the modern api.on() method.
   * Preferred over registerHook(). Uses snake_case hook names.
   *
   * @example
   * api.on('before_agent_start', async (event, ctx) => {
   *   return { prependContext: 'some context' }
   * })
   */
  on?: <K extends PluginHookName>(
    hookName: K,
    handler: (...args: unknown[]) => unknown,
    opts?: { priority?: number }
  ) => void

  /**
   * Register a lifecycle hook (legacy method).
   * Hooks allow intercepting and modifying plugin/agent lifecycle events.
   *
   * @deprecated Use api.on() for modern hook registration with proper typing.
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
export type PluginInitializer = (api: OpenClawPluginApi) => void | Promise<void>

/** Object-based plugin definition (alternative to function export) */
export interface PluginDefinition {
  id: string
  name: string
  configSchema?: JSONSchema
  register: PluginInitializer
}

/**
 * @deprecated Use OpenClawPluginApi instead. This alias is for backwards compatibility only.
 */
export type OpenClawPluginAPI = OpenClawPluginApi
