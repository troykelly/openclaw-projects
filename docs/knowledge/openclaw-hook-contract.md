# OpenClaw Hook Contract Reference

**Source**: OpenClaw gateway `src/plugins/types.ts` (validated 2026-02-04)
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

**Key insight**: The event contains `prompt` — the user's actual message. Our current code ignores this and uses a hardcoded query.

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

## Differences Between Our Types and Actual OpenClaw

| Aspect | Our Code (`types/openclaw-api.ts`) | Actual OpenClaw |
|--------|-----------------------------------|-----------------|
| API type name | `OpenClawPluginAPI` | `OpenClawPluginApi` |
| Hook registration | `api.registerHook('beforeAgentStart', ...)` | `api.on('before_agent_start', ...)` |
| Hook event names | camelCase: `beforeAgentStart` | snake_case: `before_agent_start` |
| Hook handler | `(event: T) => Promise<T \| null \| void>` | `(event, ctx) => Result \| void` (typed per hook) |
| Hook return | Generic `T` (we return `{ injectedContext }`) | Specific result types (`{ prependContext }`) |
| Tool registration | `api.registerTool(ToolDefinition)` | `api.registerTool(AnyAgentTool \| Factory, opts?)` |
| Plugin config | `api.config: Record<string, unknown>` | `api.config: OpenClawConfig` (full gateway config) |
| Logger | Custom `Logger` interface | `PluginLogger` with `debug?`, `info`, `warn`, `error` |
| Plugin kind | Not supported | `kind?: "memory"` for memory plugins |

## Memory Plugin Slot

OpenClaw supports `kind: "memory"` plugins. This is a plugin slot specifically for memory management. The `register-openclaw.ts` code does NOT use this — it registers tools directly. Consider using the memory plugin slot for tighter integration.

## Required Changes for Our Plugin

1. **Fix hook registration**: Change `api.registerHook('beforeAgentStart', ...)` to `api.on('before_agent_start', ...)`
2. **Use event.prompt**: Replace hardcoded `'relevant context for this conversation'` with `event.prompt`
3. **Fix return format**: Return `{ prependContext: '...' }` instead of `{ injectedContext: '...' }`
4. **Add context parameter**: Handler receives `(event, ctx)` — use `ctx.sessionKey` for user identification
5. **Type the event**: Use `PluginHookBeforeAgentStartEvent` instead of `unknown`
6. **Fix agent_end hook**: Use `api.on('agent_end', ...)` and properly handle `event.messages`

## Tool Registration

OpenClaw uses `AnyAgentTool` from `@mariozechner/pi-agent-core`, not our custom `ToolDefinition`. The actual tool type uses TypeBox schemas rather than plain JSON Schema objects. Our current approach of passing objects with `{ name, description, parameters, execute }` may work if the gateway's `registerTool` normalizes, but this should be validated.

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
