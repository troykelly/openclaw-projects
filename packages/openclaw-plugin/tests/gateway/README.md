# Gateway Integration Tests (Level 3)

## Current Scope

These tests validate the openclaw-projects plugin at the Gateway integration level, focusing on what can be verified without a full Gateway runtime environment.

### What's Tested ✅

1. **Manifest Validation** (`manifest-validation.test.ts`)
   - Plugin manifest structure and validity
   - Config schema correctness
   - Required fields presence

2. **Plugin Exports** (`plugin-exports.test.ts`)
   - Default export function for OpenClaw 2026 API
   - Tool factory functions exported
   - Expected tool names documented

3. **Vitest Alias Setup** (`vitest.config.ts`)
   - Dynamic resolution of openclaw internal modules
   - Workaround for non-exported Gateway functions

### What's NOT Tested (Blocked) 🚫

Full loader integration tests are **blocked** pending openclaw Gateway config documentation:

- Plugin loading via `loadOpenClawPlugins()`
- Hook registration and invocation
- Tool registration verification
- Config validation through Gateway loader
- Service and CLI registration

**Blocker**: The Gateway loader (`loadOpenClawPlugins`) requires a complete OpenClaw config structure including channel configuration. The config schema is not publicly documented, making it impractical to construct valid test configs.

**Workaround attempted**: Vitest aliases successfully resolve openclaw internal functions, but the loader's config validation fails with "extra is not iterable" errors deep in channel options formatting.

## Follow-Up Work

See issue #[NEW_ISSUE] for full Gateway loader integration tests, pending:
1. OpenClaw Gateway config schema documentation
2. Minimal valid config examples from openclaw maintainers
3. Or, alternative testing approach that doesn't require full config

## Test Strategy

Until Gateway config is documented, **Level 2 E2E tests** (issue #960) provide integration coverage by running the plugin in an actual Gateway with real config.

This approach:
- ✅ Tests real integration behavior
- ✅ Uses production-like configuration
- ✅ Validates all 27 tools, hooks, and services
- ✅ Unblocks epic #956 completion

## Running Tests

```bash
# Run Gateway tests (current scope)
pnpm test tests/gateway

# Run full test suite (includes E2E when RUN_E2E=true)
pnpm test

# Run E2E tests (provides Gateway integration coverage)
RUN_E2E=true pnpm run test:e2e
```

## Vitest Alias Workaround

The `vitest.config.ts` implements a workaround to access openclaw internal functions:

```typescript
// Dynamically finds hashed bundle files containing:
'openclaw/dist/plugins/loader.js'  → loadOpenClawPlugins
'openclaw/dist/plugins/hooks.js'   → createHookRunner
'openclaw/dist/plugins/tools.js'   → resolvePluginTools
```

This works because openclaw uses hashed bundle names (e.g., `loader-CKycv-3K.js`). The config searches dist files for function names and creates aliases.

**Limitation**: Functions are accessible but require valid Gateway config to use.
