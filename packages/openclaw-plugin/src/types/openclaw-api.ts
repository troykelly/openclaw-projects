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

import type { Logger } from '../logger.js';

/** JSON Schema for tool parameters */
export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  description?: string;
  default?: unknown;
}

export interface JSONSchemaProperty {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  description?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: JSONSchema | JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  format?: string;
  additionalProperties?: JSONSchemaProperty | boolean;
}

/**
 * Tool execution context.
 *
 * Maps to the SDK's OpenClawPluginToolContext with our additional user_id
 * and requestId fields for internal use. (#2039)
 */
export interface ToolContext {
  /** OpenClaw config object (opaque to our plugin) */
  config?: Record<string, unknown>;
  /** Workspace directory for the current agent */
  workspaceDir?: string;
  /** Agent-specific directory */
  agentDir?: string;
  /** Agent identifier */
  agentId?: string;
  /** Session key */
  sessionKey?: string;
  /** Message channel (e.g., "telegram", "discord") */
  messageChannel?: string;
  /** Agent account identifier */
  agentAccountId?: string;
  /** Trusted sender id from inbound context (runtime-provided, not tool args). (#2039) */
  requesterSenderId?: string;
  /** Whether the trusted sender is an owner. (#2039) */
  senderIsOwner?: boolean;
  /** Whether the tool is running in a sandbox */
  sandboxed?: boolean;
  // ── Fields specific to our plugin (not in SDK's OpenClawPluginToolContext) ──
  /** Internal user identifier for scoping */
  user_id?: string;
  /** Session identifier */
  sessionId?: string;
  /** Request identifier */
  requestId?: string;
}

/** Tool execution result (internal format used by handlers) */
export interface ToolResult {
  success: boolean;
  data?: {
    content: string;
    details?: Record<string, unknown>;
  };
  error?: string;
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
  content: Array<{ type: 'text'; text: string }>;
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
  onUpdate?: (partial: unknown) => void,
) => Promise<AgentToolResult>;

/**
 * Tool definition for api.registerTool().
 *
 * Note: The SDK uses AnyAgentTool (from @mariozechner/pi-agent-core) which
 * extends Tool<TSchema> with TypeBox schemas. Our simplified version uses
 * plain JSON Schema objects to avoid the TypeBox/pi-agent-core dependency.
 */
export interface ToolDefinition {
  /** Tool name (snake_case) */
  name: string;
  /** Human-readable description shown to agents */
  description: string;
  /** JSON Schema for tool parameters */
  parameters: JSONSchema;
  /** Tool execution function (OpenClaw Gateway signature) */
  execute: AgentToolExecute;
  /** When true, tool requires explicit opt-in and is not loaded by default */
  optional?: boolean;
  /** Logical group for tool discovery (e.g. "terminal_connections", "notes") */
  group?: string;
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
 *
 * All 24 hook names from the SDK 2026.3.1 contract. (#2030)
 */
export type PluginHookName =
  | 'before_model_resolve'
  | 'before_prompt_build'
  | 'before_agent_start'
  | 'llm_input'
  | 'llm_output'
  | 'agent_end'
  | 'before_compaction'
  | 'after_compaction'
  | 'before_reset'
  | 'message_received'
  | 'message_sending'
  | 'message_sent'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'tool_result_persist'
  | 'before_message_write'
  | 'session_start'
  | 'session_end'
  | 'subagent_spawning'
  | 'subagent_delivery_target'
  | 'subagent_spawned'
  | 'subagent_ended'
  | 'gateway_start'
  | 'gateway_stop';

/** Event payload for before_agent_start hook */
export interface PluginHookBeforeAgentStartEvent {
  /** The user's actual prompt text */
  prompt: string;
  /** Previous conversation messages (optional) */
  messages?: unknown[];
}

/** Context passed as second argument to hook handlers (#2035) */
export interface PluginHookAgentContext {
  agentId?: string;
  sessionKey?: string;
  /** Session identifier. Added in SDK 2026.3.1. (#2035) */
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
}

/**
 * Return value from before_agent_start hook.
 *
 * In the SDK this is defined as:
 *   PluginHookBeforePromptBuildResult & PluginHookBeforeModelResolveResult
 * which adds modelOverride and providerOverride. (#2033)
 */
export interface PluginHookBeforeAgentStartResult {
  /** Append to the system prompt */
  systemPrompt?: string;
  /** Prepend to conversation context */
  prependContext?: string;
  /** Override the model for this agent run. E.g. "llama3.3:8b" (#2033) */
  modelOverride?: string;
  /** Override the provider for this agent run. E.g. "ollama" (#2033) */
  providerOverride?: string;
}

/**
 * Event payload for message_received hook.
 *
 * Aligned with SDK 2026.3.1 PluginHookMessageReceivedEvent. (#2029)
 * The SDK shape uses `from` (sender identifier), `content`, `timestamp`,
 * and `metadata` — NOT the legacy thread_id/senderEmail/senderPhone fields.
 */
export interface PluginHookMessageReceivedEvent {
  /** Sender identifier (channel-scoped, e.g., phone number, email, user ID) */
  from: string;
  /** Message body content */
  content: string;
  /** Unix timestamp of the message (optional) */
  timestamp?: number;
  /** Additional metadata (may contain channel-specific fields like thread_id, email, phone) */
  metadata?: Record<string, unknown>;
}

/**
 * Context passed to message_received, message_sending, and message_sent hooks.
 *
 * Aligned with SDK 2026.3.1 PluginHookMessageContext. (#2029)
 * This is NOT the same as PluginHookAgentContext — message hooks receive
 * channel-specific context instead of agent session context.
 */
export interface PluginHookMessageContext {
  /** Channel identifier (e.g., "telegram", "discord", "sms") */
  channelId: string;
  /** Account identifier for multi-account channels */
  accountId?: string;
  /** Conversation/thread identifier */
  conversationId?: string;
}

/** Event payload for agent_end hook */
export interface PluginHookAgentEndEvent {
  /** Full conversation messages */
  messages: unknown[];
  /** Whether the agent completed successfully */
  success: boolean;
  /** Error message if the agent failed */
  error?: string;
  /** Duration of the agent run in milliseconds */
  durationMs?: number;
}

/** Event payload for before_prompt_build hook (#2050) */
export interface PluginHookBeforePromptBuildEvent {
  /** The user's prompt text */
  prompt: string;
  /** Full conversation messages available in this hook */
  messages?: unknown[];
}

/** Result from before_prompt_build hook (#2050) */
export interface PluginHookBeforePromptBuildResult {
  /** Append to the system prompt */
  systemPrompt?: string;
  /** Prepend to conversation context */
  prependContext?: string;
}

/** Event payload for llm_input hook (#2051) */
export interface PluginHookLlmInputEvent {
  /** Run identifier for this LLM invocation */
  runId?: string;
  /** Session identifier */
  sessionId?: string;
  /** LLM provider name (e.g. "openai", "anthropic") */
  provider?: string;
  /** Model identifier (e.g. "gpt-4", "claude-3") */
  model?: string;
  /** Number of messages being sent */
  messageCount?: number;
  /** Timestamp of the invocation */
  timestamp?: number;
}

/** Event payload for llm_output hook (#2051) */
export interface PluginHookLlmOutputEvent {
  /** Run identifier for this LLM invocation */
  runId?: string;
  /** Session identifier */
  sessionId?: string;
  /** LLM provider name */
  provider?: string;
  /** Model identifier */
  model?: string;
  /** Token usage from the LLM response */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** Duration of the LLM call in milliseconds */
  durationMs?: number;
  /** Timestamp of the response */
  timestamp?: number;
}

/** Event payload for before_reset hook (#2052) */
export interface PluginHookBeforeResetEvent {
  /** Session identifier */
  sessionId?: string;
  /** Path to the session transcript file, if available */
  sessionFile?: string;
  /** Full conversation messages at time of reset */
  messages?: unknown[];
}

/** Command definition for api.registerCommand() (#2054) */
export interface OpenClawPluginCommandDefinition {
  /** Command name (e.g. "remember", "forget", "recall") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Whether this command requires authentication */
  requireAuth?: boolean;
  /** Handler function returning a reply payload */
  handler: (args: { input: string; context?: Record<string, unknown> }) => Promise<CommandReplyPayload>;
}

/** Reply payload for command handlers (#2054) */
export interface CommandReplyPayload {
  /** Text content to return to the user */
  text: string;
  /** Whether the command executed successfully */
  success: boolean;
  /** Additional data to include in the response */
  data?: Record<string, unknown>;
}

/**
 * Options passed to a Gateway RPC method handler.
 *
 * Aligned with SDK 2026.3.1 GatewayRequestHandlerOptions. (#2031)
 * The SDK handler receives a single `opts` object with `req`, `params`,
 * `respond`, `client`, `isWebchatConnect`, and `context`. We define a
 * simplified version that uses our own types for the fields we actually access.
 */
export interface GatewayMethodHandlerOptions {
  /** The raw request frame */
  req: Record<string, unknown>;
  /** Parsed RPC parameters from the request */
  params: Record<string, unknown>;
  /** Function to send the response back to the client */
  respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: Record<string, unknown>) => void;
  /** The connected client (may be null for unauthenticated requests) */
  client: Record<string, unknown> | null;
  /** Check if the connect params indicate a webchat connection */
  isWebchatConnect: (params: unknown) => boolean;
  /** Gateway request context with deps, cron, broadcast, etc. */
  context: Record<string, unknown>;
}

/**
 * Gateway RPC method handler function.
 *
 * Aligned with SDK 2026.3.1 GatewayRequestHandler:
 *   `(opts: GatewayRequestHandlerOptions) => Promise<void> | void`
 *
 * The handler is responsible for calling `opts.respond()` to send the
 * response — it does NOT return a value. (#2031)
 */
export type GatewayMethodHandler = (opts: GatewayMethodHandlerOptions) => Promise<void> | void;

/**
 * Handler type map for plugin hooks.
 *
 * Maps each PluginHookName to the correct handler signature.
 * This is a simplified version of the SDK's PluginHookHandlerMap,
 * covering only the hooks we currently register. Hooks we don't use
 * fall through to a generic handler signature. (#2032)
 */
export interface PluginHookHandlerMap {
  before_agent_start: (event: PluginHookBeforeAgentStartEvent, ctx: PluginHookAgentContext) => Promise<PluginHookBeforeAgentStartResult | void> | PluginHookBeforeAgentStartResult | void;
  agent_end: (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
  message_received: (event: PluginHookMessageReceivedEvent, ctx: PluginHookMessageContext) => Promise<void> | void;
  // ── Hooks now registered by Phase 5 capability implementations ──
  before_prompt_build: (event: PluginHookBeforePromptBuildEvent, ctx: PluginHookAgentContext) => Promise<PluginHookBeforePromptBuildResult | void> | PluginHookBeforePromptBuildResult | void;
  llm_input: (event: PluginHookLlmInputEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
  llm_output: (event: PluginHookLlmOutputEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
  before_reset: (event: PluginHookBeforeResetEvent, ctx: PluginHookAgentContext) => Promise<void> | void;
  // ── Hooks we don't currently register but exist in the SDK ──
  before_model_resolve: (event: Record<string, unknown>, ctx: PluginHookAgentContext) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  before_compaction: (event: Record<string, unknown>, ctx: PluginHookAgentContext) => Promise<void> | void;
  after_compaction: (event: Record<string, unknown>, ctx: PluginHookAgentContext) => Promise<void> | void;
  message_sending: (event: Record<string, unknown>, ctx: PluginHookMessageContext) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  message_sent: (event: Record<string, unknown>, ctx: PluginHookMessageContext) => Promise<void> | void;
  before_tool_call: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  after_tool_call: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void> | void;
  tool_result_persist: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Record<string, unknown> | void;
  before_message_write: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Record<string, unknown> | void;
  session_start: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void> | void;
  session_end: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void> | void;
  subagent_spawning: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  subagent_delivery_target: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  subagent_spawned: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void> | void;
  subagent_ended: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void> | void;
  gateway_start: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void> | void;
  gateway_stop: (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<void> | void;
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
  | 'messageSent';

/** Legacy hook handler function */
export type HookHandler<T = unknown> = (event: T) => Promise<T | null | undefined>;

/**
 * CLI registration context.
 *
 * Aligned with the SDK's OpenClawPluginCliContext. (#2037)
 * The SDK uses `Commander.Command` for program and `OpenClawConfig` for config;
 * we use simplified types to avoid pulling in those dependencies.
 */
export interface CliRegistrationContext {
  /** Commander program instance */
  program: {
    command: (name: string) => {
      description: (desc: string) => {
        option: (flags: string, desc: string) => unknown;
        action: (handler: (...args: unknown[]) => void | Promise<void>) => unknown;
      };
    };
  };
  /** OpenClaw gateway configuration (opaque to our plugin) */
  config?: Record<string, unknown>;
  /** Workspace directory */
  workspaceDir?: string;
  /** Logger instance */
  logger?: {
    debug?: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

/**
 * CLI registration callback.
 *
 * Aligned with SDK's OpenClawPluginCliRegistrar: may return void or Promise<void>. (#2037)
 */
export type CliRegistrationCallback = (context: CliRegistrationContext) => void | Promise<void>;

/**
 * Service definition for background processes.
 *
 * Aligned with the SDK's OpenClawPluginService type. (#2036)
 * The SDK uses OpenClawPluginServiceContext for the ctx parameter;
 * we use Record<string, unknown> to avoid pulling in OpenClawConfig.
 */
export interface ServiceDefinition {
  /** Unique service ID */
  id: string;
  /** Called when plugin starts */
  start: (ctx?: Record<string, unknown>) => void | Promise<void>;
  /** Called when plugin stops (optional per SDK contract) (#2036) */
  stop?: (ctx?: Record<string, unknown>) => void | Promise<void>;
}

/**
 * OpenClaw Plugin API provided to plugins.
 *
 * Aligned with the SDK's OpenClawPluginApi type. (#2034)
 * Where the SDK uses concrete types (OpenClawConfig, AnyAgentTool, Commander.Command),
 * we use simplified equivalents to avoid pulling in those dependencies.
 */
export interface OpenClawPluginApi {
  // ── Identity fields (from SDK) (#2034) ────────────────────────────────────

  /** Plugin ID */
  id: string;

  /** Plugin display name */
  name: string;

  /** Plugin version (optional) */
  version?: string;

  /** Plugin description (optional) */
  description?: string;

  /** Plugin source/origin (e.g., "bundled", "global", "workspace") */
  source: string;

  // ── Configuration ─────────────────────────────────────────────────────────

  /** Full OpenClaw gateway configuration */
  config: Record<string, unknown>;

  /** Plugin-specific configuration from plugins.entries.<id>.config */
  pluginConfig?: Record<string, unknown>;

  // ── Runtime ───────────────────────────────────────────────────────────────

  /** Logger instance */
  logger: Logger;

  /**
   * Plugin runtime utilities.
   * The SDK exposes this as PluginRuntime with agent, tts, etc.
   * We use Record<string, unknown> to avoid the full dependency. (#2034)
   */
  runtime: Record<string, unknown>;

  // ── Legacy alias (retained for backward compat within our plugin) ─────────
  /**
   * @deprecated Use `id` instead. Kept for backward compatibility.
   */
  pluginId?: string;

  // ── Registration methods ──────────────────────────────────────────────────

  /**
   * Register a tool with the OpenClaw Gateway.
   * Tools are exposed to agents for execution.
   */
  registerTool: (tool: ToolDefinition) => void;

  /**
   * Register a lifecycle hook using the modern api.on() method.
   * Preferred over registerHook(). Uses snake_case hook names.
   *
   * The handler type is determined by the hook name via PluginHookHandlerMap.
   * This matches the SDK's `api.on()` signature. (#2032)
   *
   * @example
   * api.on('before_agent_start', async (event, ctx) => {
   *   return { prependContext: 'some context' }
   * })
   */
  on: <K extends PluginHookName>(hookName: K, handler: PluginHookHandlerMap[K], opts?: { priority?: number }) => void;

  /**
   * Register a lifecycle hook (legacy method).
   * Hooks allow intercepting and modifying plugin/agent lifecycle events.
   *
   * @deprecated Use api.on() for modern hook registration with proper typing.
   */
  registerHook: <T = unknown>(event: HookEvent | string | string[], handler: HookHandler<T>) => void;

  /**
   * Register an HTTP handler for custom request processing. (#2034)
   */
  registerHttpHandler: (handler: (req: unknown, res: unknown) => Promise<boolean> | boolean) => void;

  /**
   * Register an HTTP route handler at a specific path. (#2034)
   */
  registerHttpRoute: (params: { path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }) => void;

  /**
   * Register a messaging channel plugin. (#2034)
   */
  registerChannel: (registration: Record<string, unknown>) => void;

  /**
   * Register CLI commands.
   * Commands are available via `openclaw <plugin-id> <command>`.
   */
  registerCli: (callback: CliRegistrationCallback, opts?: { commands?: string[] }) => void;

  /**
   * Register a background service.
   * Services are started when the plugin loads and stopped when it unloads.
   */
  registerService: (service: ServiceDefinition) => void;

  /**
   * Register an RPC method for the Gateway.
   * Methods are exposed as `pluginId.methodName`.
   *
   * The handler receives GatewayRequestHandlerOptions (with req, params,
   * respond, client, context) — NOT just params. (#2031)
   */
  registerGatewayMethod: (methodName: string, handler: GatewayMethodHandler) => void;

  /**
   * Register a model provider plugin. (#2034)
   */
  registerProvider: (provider: Record<string, unknown>) => void;

  /**
   * Register a custom command that bypasses the LLM agent. (#2034)
   * Plugin commands are processed before built-in commands and before agent invocation.
   */
  registerCommand: (command: Record<string, unknown>) => void;

  /**
   * Resolve a relative path against the plugin's context. (#2034)
   */
  resolvePath: (input: string) => string;
}

/** Plugin initialization function signature */
export type PluginInitializer = (api: OpenClawPluginApi) => void | Promise<void>;

/** Object-based plugin definition (alternative to function export) */
export interface PluginDefinition {
  id: string;
  name: string;
  configSchema?: JSONSchema;
  register: PluginInitializer;
}

/**
 * @deprecated Use OpenClawPluginApi instead. This alias is for backwards compatibility only.
 */
export type OpenClawPluginAPI = OpenClawPluginApi;
