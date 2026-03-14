# Unified OpenClaw Logging — Design Spec

**Date:** 2026-03-14
**Scope:** `packages/openclaw-plugin/` only
**Goal:** Properly implement the OpenClaw `PluginLogger` interface throughout the plugin, replacing the custom logger with correct host integration.

---

## Problem

The openclaw-projects plugin has **541 logger calls across 49 files** using a custom `Logger` interface that diverges from the OpenClaw host's `PluginLogger` spec:

### Current Issues

1. **Wrong logger interface**: The plugin's `Logger` accepts `(message: string, data?: Record<string, unknown>)` but the OpenClaw host's `PluginLogger` accepts only `(message: string)`. Structured data objects passed as the second argument are silently ignored by the host logger.

2. **Inconsistent plugin identification**: Some messages manually prepend `[openclaw-projects]`, others don't. The host already adds `[plugins]` automatically, so messages appear as either `[plugins] [openclaw-projects] message` (doubled) or `[plugins] message` (unidentified).

3. **No startup information**: The plugin doesn't log its version, build info, or capability summary at startup. This makes debugging deployment issues difficult.

4. **10 raw `console.*` calls** (outside `logger.ts`): Some code bypasses the logger entirely with direct `console.warn`/`console.error` calls, which don't get the host's formatting or routing.

5. **Duplicate log formatting**: The custom logger adds its own `[timestamp] [LEVEL] [namespace]` prefix, which conflicts with the host's own formatting (the host already handles timestamps, levels, and colors).

### Sample of Current (Broken) Output

```
13:27:18 [plugins] Namespace config resolved
13:27:18 [plugins] Agent ID not available at registration time...
13:27:18 [plugins] OpenClaw Projects plugin registered
13:27:18 [plugins] [openclaw-projects] Agent sync: pushed 14 agents
```

Note: "Namespace config resolved" has no plugin identification. "Agent sync" has double-identification.

---

## OpenClaw PluginLogger Spec

The OpenClaw SDK defines this interface for plugin logging:

```typescript
type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};
```

**Host guarantees:**
- All plugin logger output is prefixed with `[plugins]` automatically
- Timestamps, colors, and log level formatting are handled by the host
- Log routing (console, files, structured output) is handled by the host
- Subsystem prefix deduplication is applied

**Plugin responsibilities:**
- Use `api.logger` from the registration context
- Pass only string messages
- Include plugin/component identification in the message text
- Handle sensitive data redaction before passing to logger

---

## Design

### 1. Logger Adapter (`logger.ts` rewrite)

Replace the current custom logger with an adapter that:
- Wraps the OpenClaw `PluginLogger` interface
- Accepts `(message: string, data?: Record<string, unknown>)` for backward compatibility
- Flattens structured data into the message string (redacting sensitive fields first)
- Prepends `[openclaw-projects]` to every message
- Supports **component scoping** via `child(component)` to produce `[openclaw-projects:component]`

```typescript
interface PluginLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  child(component: string): Logger;
}

function createPluginLogger(hostLogger: PluginLogger, component?: string): Logger {
  const prefix = component
    ? `[openclaw-projects:${component}]`
    : '[openclaw-projects]';

  function format(message: string, data?: Record<string, unknown>): string {
    if (data && Object.keys(data).length > 0) {
      return `${prefix} ${message} ${JSON.stringify(redactSensitive(data))}`;
    }
    return `${prefix} ${message}`;
  }

  return {
    info: (msg, data) => hostLogger.info(format(msg, data)),
    warn: (msg, data) => hostLogger.warn(format(msg, data)),
    error: (msg, data) => hostLogger.error(format(msg, data)),
    debug: (msg, data) => hostLogger.debug?.(format(msg, data)),
    child: (comp) => createPluginLogger(hostLogger, component ? `${component}:${comp}` : comp),
  };
}
```

**Fallback logger** (for tests/standalone when host logger unavailable):

```typescript
function createFallbackLogger(): PluginLogger {
  return {
    info: (msg) => console.info(msg),
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
    debug: (msg) => console.debug(msg),
  };
}
```

The fallback does NOT add timestamps or level prefixes — it mirrors what the host does (those are handled by the console output itself).

### 2. Startup Banner

On plugin registration, emit a structured startup log:

```
[openclaw-projects] Plugin v0.0.60 starting
[openclaw-projects] Agent: troy | Namespace: default | Recall: [default, shared]
[openclaw-projects] Capabilities: autoRecall=true autoCapture=true twilio=configured postmark=configured
[openclaw-projects] Tools registered: 52 | Hooks: 2 | CLI commands: 3
```

Information logged at startup:
- Plugin version (from `package.json`)
- Agent ID and namespace configuration
- Feature flags / capability summary (auto-recall, auto-capture, communication providers)
- Registration summary (tool count, hook count, CLI command count)

### 3. Component Scoping

Each subsystem gets a child logger with its component name:

| Component | Logger Prefix | Used By |
|-----------|---------------|---------|
| `memory` | `[openclaw-projects:memory]` | memory-store, memory-recall, memory-forget, memory-list, memory-update, memory-digest, memory-promote, memory-reap |
| `hooks` | `[openclaw-projects:hooks]` | auto-recall, auto-capture, graph-aware recall |
| `api` | `[openclaw-projects:api]` | API client (requests, retries, rate limits) |
| `contacts` | `[openclaw-projects:contacts]` | contact search, create, get |
| `projects` | `[openclaw-projects:projects]` | project list, create, search |
| `todos` | `[openclaw-projects:todos]` | todo list, create, complete, search |
| `comms` | `[openclaw-projects:comms]` | email-send, sms-send, threads, message-search |
| `terminal` | `[openclaw-projects:terminal]` | terminal connections, sessions, tunnels, search |
| `dev` | `[openclaw-projects:dev]` | dev sessions, dev prompts |
| `notes` | `[openclaw-projects:notes]` | notes, notebooks |
| `skills` | `[openclaw-projects:skills]` | skill-store operations |
| `links` | `[openclaw-projects:links]` | entity links, relationships |
| `files` | `[openclaw-projects:files]` | file-share |
| `namespace` | `[openclaw-projects:namespace]` | namespace resolution, refresh |
| `oauth` | `[openclaw-projects:oauth]` | OAuth gateway RPC methods |
| `gate` | `[openclaw-projects:gate]` | inbound-gate (spam, rate limiting) |
| `autolinker` | `[openclaw-projects:autolinker]` | auto-linker utility |
| `cli` | `[openclaw-projects:cli]` | CLI commands |

### 4. Migration Strategy

All 541 logger calls and 10 raw console.* calls must be migrated:

**Phase 1 — Logger adapter + startup banner + type alignment:**
- Rewrite `logger.ts` with the new adapter
- Update `types/openclaw-api.ts`: change `logger: Logger` to `logger: PluginLogger` on `OpenClawPluginApi` and remove the `import type { Logger }` from `../logger.js`
- Update `register-openclaw.ts` to use `createPluginLogger(api.logger)` and emit startup banner
- Update `index.ts` to use `createPluginLogger(createFallbackLogger())`

**Phase 2 — Component child loggers:**
- In `register-openclaw.ts`, create child loggers at the top of `registerOpenClaw` (e.g., `const memoryLogger = logger.child('memory')`) and use them in the inline tool handlers. Note: `register-openclaw.ts` uses inline tool handlers with a closure-captured logger, not factory injection — child loggers are created at scope top and referenced by the relevant handlers.
- For tool factory files (used via `index.ts`), pass child loggers: `createMemoryStoreTool({ ..., logger: logger.child('memory') })`

**Phase 3 — Message cleanup:**
- Remove manual `[openclaw-projects]` prefixes from all message strings (the adapter handles it)
- Ensure all structured data is included in the message string
- Replace raw `console.*` calls with logger calls (in `secrets.ts`, `register-openclaw.ts`, `utils/nominatim.ts`)
- Remove the `namespace` field from the Logger interface (breaking change — update all code that accesses `logger.namespace`)

**Phase 4 — Testing:**
- Unit tests for the logger adapter (formatting, redaction, child scoping)
- Unit tests for startup banner content
- Integration test verifying log output through the full plugin registration flow
- Verify no raw console.* calls remain (lint rule or grep check)

### 5. Sensitive Data Handling

The existing `redactSensitive()` function is retained and applied when flattening data objects into message strings. No change to the redaction logic itself.

### 6. Lint / CI Enforcement

Add an ESLint rule or CI check to prevent:
- Direct `console.log/info/warn/error/debug` calls in plugin source (excluding logger.ts fallback)
- Logger calls that manually include `[openclaw-projects]` or `[plugins]` in the message

---

## Files Changed

### Modified
- `packages/openclaw-plugin/src/logger.ts` — Complete rewrite
- `packages/openclaw-plugin/src/types/openclaw-api.ts` — Change `logger: Logger` to `logger: PluginLogger`, remove `import type { Logger }` from `../logger.js`
- `packages/openclaw-plugin/src/register-openclaw.ts` — Use new logger, add startup banner, create child loggers for each component
- `packages/openclaw-plugin/src/index.ts` — Use new logger
- `packages/openclaw-plugin/src/api-client.ts` — Use child logger
- `packages/openclaw-plugin/src/hooks.ts` — Use child logger
- `packages/openclaw-plugin/src/cli.ts` — Use child logger
- `packages/openclaw-plugin/src/secrets.ts` — Replace console.error calls with logger
- `packages/openclaw-plugin/src/utils/nominatim.ts` — Replace console.error calls with logger
- `packages/openclaw-plugin/src/utils/auto-linker.ts` — Use child logger
- `packages/openclaw-plugin/src/utils/inbound-gate.ts` — Use child logger
- `packages/openclaw-plugin/src/gateway/rpc-methods.ts` — Use child logger
- `packages/openclaw-plugin/src/gateway/oauth-rpc-methods.ts` — Use child logger
- All tool files in `packages/openclaw-plugin/src/tools/` (~41 files) — Use child loggers, clean up messages
- `packages/openclaw-plugin/tests/logger.test.ts` — Update existing tests for new Logger interface (namespace removal is breaking)

### New
- `packages/openclaw-plugin/src/startup.ts` — Startup banner logic
- `packages/openclaw-plugin/tests/startup.test.ts` — Startup banner tests

---

## What This Does NOT Change

- Backend API server logging (`src/api/`) — out of scope
- Sentry integration — unchanged
- Log levels or verbosity defaults — unchanged
- The `redactSensitive()` function logic — unchanged (only where it's called changes)

---

## Success Criteria

1. All plugin log output is prefixed with `[openclaw-projects]` or `[openclaw-projects:component]`
2. No raw `console.*` calls remain in plugin source
3. No manual `[plugins]` prefixes in messages
4. Startup banner logs version, agent, namespace, capabilities, and registration summary
5. All structured data is flattened into message strings with sensitive fields redacted
6. Host logger (`api.logger`) is used as primary; fallback logger used only when host is unavailable
7. Existing tests continue to pass
8. New tests cover logger adapter, child scoping, redaction, and startup banner
