# Gateway Integration Tests (Level 3)

## Overview

These tests validate the openclaw-projects plugin at the Gateway integration level, using the **real** Gateway `loadOpenClawPlugins()` function to verify our plugin loads, registers, and integrates correctly.

### What's Tested

1. **Manifest Validation** (`manifest-validation.test.ts`)
   - Plugin manifest structure and validity
   - Config schema correctness
   - Required fields presence

2. **Plugin Exports** (`plugin-exports.test.ts`)
   - Default export function for OpenClaw 2026 API
   - Tool factory functions exported
   - Expected tool count verification

3. **Plugin Loading** (`plugin-loading.test.ts`)
   - Plugin discovery via `loadOpenClawPlugins()` with `load.paths`
   - Status, origin, kind verification
   - Diagnostics with valid config
   - Error status for missing required fields
   - Disabled state when plugins disabled globally
   - Disabled state when memory slot assigned elsewhere

4. **Config Validation** (`config-validation.test.ts`)
   - Minimal valid config (apiUrl only)
   - Missing required fields rejected
   - Optional fields accepted
   - Invalid types rejected
   - Out-of-range values rejected
   - Validate-only mode

5. **Tool Registration** (`tool-registration.test.ts`)
   - All 27 tools registered on plugin record
   - Tool names match expected list
   - Tool factories produce callable results

6. **Tool Resolution** (`tool-resolution.test.ts`)
   - Factories produce tools with name and execute
   - Specific tool (memory_recall) has correct shape

7. **Hook Registration** (`hook-registration.test.ts`)
   - before_agent_start hook registered when autoRecall: true
   - agent_end hook registered when autoCapture: true
   - No hooks when both disabled

8. **Hook Invocation** (`hook-invocation.test.ts`)
   - before_agent_start hook invocable without throwing
   - agent_end hook invocable without throwing
   - Hook presence reported correctly
   - No hooks reported when disabled

9. **Service Registration** (`service-registration.test.ts`)
   - Notification service registered
   - Service has start/stop methods

10. **CLI Registration** (`cli-registration.test.ts`)
    - CLI commands registered
    - CLI registrar function available

## Architecture

Tests import the real Gateway loader directly from the gateway source at `.local/openclaw-gateway/`. The `vitest.config.ts` sets up path aliases:

```
openclaw-gateway/plugins/loader -> .local/openclaw-gateway/src/plugins/loader.ts
openclaw-gateway/plugins/hooks  -> .local/openclaw-gateway/src/plugins/hooks.ts
openclaw/plugin-sdk              -> .local/openclaw-gateway/src/plugin-sdk/index.ts
```

This approach:
- Uses the **real** `loadOpenClawPlugins()` — no mocks
- Gets full TypeScript support via vitest's built-in transpilation
- Is resilient to bundle hash changes in the openclaw npm package
- Requires the gateway source (available in dev via `.local/openclaw-gateway`)

## Running Tests

```bash
# Run gateway tests
pnpm test tests/gateway

# Run full test suite
pnpm test

# Build first if dist/ doesn't exist (needed for plugin-exports tests)
pnpm run build
```

## Prerequisites

- Gateway source symlinked at `.local/openclaw-gateway/`
- Plugin built (`pnpm run build`) for export verification tests
- `node_modules` installed via `pnpm install`
