# OpenClaw Hook Contract Reference

**Source**: OpenClaw gateway `src/plugins/types.ts` (validated 2026-02-05)
**Epic**: #486 — Relationship-Aware Preferences and Memory Auto-Surfacing

## Plugin Registration API

Plugins register via `OpenClawPluginApi` (note: `Api` not `API`):

```typescript
export type OpenClawPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: PluginKind;  // "memory" for memory plugins
  configSchema?: OpenClawPluginConfigSchema;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
  activate?: (api: OpenClawPluginApi) => void | Promise<void>;
};
```

## Hook Registration

Hooks are registered via `api.on()` — NOT `api.registerHook()`:

```typescript
api.on<K extends PluginHookName>(
  hookName: K,
  handler: PluginHookHandlerMap[K],
  opts?: { priority?: number }
) => void;
```

## Available Hook Names

```typescript
type PluginHookName =
  | "before_agent_start"    // Context injection
  | "agent_end"             // Auto-capture
  | "before_compaction"     // Before context window compaction
  | "after_compaction"      // After context window compaction
  | "message_received"      // Inbound message from channel
  | "message_sending"       // Before outbound message (can modify/cancel)
  | "message_sent"          // After outbound message sent
  | "before_tool_call"      // Before agent calls a tool (can block)
  | "after_tool_call"       // After tool call completes
  | "tool_result_persist"   // Before tool result is written to transcript
  | "session_start"         // New session begins
  | "session_end"           // Session ends
  | "gateway_start"         // Gateway started
  | "gateway_stop";         // Gateway stopping
```

## Hook Contracts

### before_agent_start (Context Injection)

**This is the hook we use for auto-recall / preference surfacing.**

```typescript
// Handler signature
(
  event: PluginHookBeforeAgentStartEvent,
  ctx: PluginHookAgentContext
) => Promise<PluginHookBeforeAgentStartResult | void> | PluginHookBeforeAgentStartResult | void;

// Event payload
type PluginHookBeforeAgentStartEvent = {
  prompt: string;        // THE USER'S ACTUAL PROMPT
  messages?: unknown[];  // Previous conversation messages
};

// Context (second argument)
type PluginHookAgentContext = {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  messageProvider?: string;  // e.g., "whatsapp", "telegram"
};

// Return value (how to inject context)
type PluginHookBeforeAgentStartResult = {
  systemPrompt?: string;     // Append to system prompt
  prependContext?: string;   // Prepend to conversation context
};
```

### agent_end (Auto-Capture)

```typescript
// Handler signature
(event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext) => Promise<void> | void;

// Event payload
type PluginHookAgentEndEvent = {
  messages: unknown[];   // Full conversation messages
  success: boolean;      // Whether the agent completed successfully
  error?: string;        // Error message if failed
  durationMs?: number;   // How long the agent ran
};
```

### message_received

```typescript
type PluginHookMessageReceivedEvent = {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

type PluginHookMessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};
```

### before_tool_call (Can block tools)

```typescript
type PluginHookBeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
};

type PluginHookBeforeToolCallResult = {
  params?: Record<string, unknown>;  // Modified params
  block?: boolean;                   // Block the tool call
  blockReason?: string;
};
```

## Tool Registration

### Tool Execute Signature

OpenClaw Gateway expects tools to have this execute signature:

```typescript
type AgentToolExecute<T = Record<string, unknown>> = (
  toolCallId: string,
  params: T,
  signal?: AbortSignal,
  onUpdate?: (partial: unknown) => void
) => Promise<AgentToolResult>;

// Return format
type AgentToolResult = {
  content: Array<{ type: 'text'; text: string }>;
};
```

**Important**: The first argument is `toolCallId`, NOT the params object. The params are the second argument.

### Tool Definition

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: AgentToolExecute;
}
```

## Plugin API Fields

```typescript
type OpenClawPluginApi = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: OpenClawConfig;          // Full gateway config, not plugin-specific
  pluginConfig?: Record<string, unknown>;  // Plugin-specific config
  runtime: PluginRuntime;
  logger: PluginLogger;
  registerTool: (...) => void;
  registerHook: (...) => void;     // Legacy - prefer api.on()
  registerHttpHandler: (...) => void;
  registerHttpRoute: (...) => void;
  registerChannel: (...) => void;
  registerGatewayMethod: (...) => void;
  registerCli: (...) => void;
  registerService: (...) => void;
  registerProvider: (...) => void;
  registerCommand: (...) => void;
  resolvePath: (input: string) => string;
  on: (...) => void;               // Modern hook registration
};
```

## Memory Plugin Slot

OpenClaw supports `kind: "memory"` plugins. This is a plugin slot specifically for memory management. The `register-openclaw.ts` code does NOT use this — it registers tools directly. Consider using the memory plugin slot for tighter integration.

## Implementation Status

Our plugin implementation (`packages/openclaw-plugin/src/register-openclaw.ts`) correctly implements:

- [x] Hook registration via `api.on()` with snake_case names
- [x] Uses `event.prompt` for semantic memory search
- [x] Returns `{ prependContext }` format from hooks
- [x] Tool execute signature: `(toolCallId, params, signal?, onUpdate?) => AgentToolResult`
- [x] Returns `{ content: [{ type: "text", text: "..." }] }` from tool execution
- [x] Type name `OpenClawPluginApi` (not `API`)
- [x] Fallback to legacy `registerHook` for older gateways
