# Namespace & Agent ID Omnibus Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the namespace resolution defect cluster (#1644, #1645, #1646) so the plugin resolves the correct agent ID, API GET-by-ID endpoints work across namespaces, and relationship_set finds contacts properly.

**Architecture:** The plugin's mutable `PluginState` is updated from hook context at `before_agent_start`. All closures that captured `user_id` as a string are refactored to read from state via getter functions. The API's `verifyNamespaceScope` is split into `verifyEntityExists` (READ) and `verifyWriteScope` (WRITE). Contact resolution gets namespace parameter for name lookups.

**Tech Stack:** TypeScript, Vitest, PostgreSQL migrations, Zod schemas

**Design doc:** `docs/plans/2026-02-24-namespace-agent-id-omnibus-design.md`

**Branch:** `omnibus/1644-1645-1646-namespace-agent-id`

**Worktree:** `/tmp/worktree-omnibus-1644-namespace`

---

## Pre-flight

```bash
cd /workspaces/openclaw-projects
git worktree add /tmp/worktree-omnibus-1644-namespace -b omnibus/1644-1645-1646-namespace-agent-id
cd /tmp/worktree-omnibus-1644-namespace
pnpm install --frozen-lockfile
pnpm run build  # verify clean baseline
```

---

### Task 1: Add `resolveAgentId()` and `agentId` config field

**Files:**
- Modify: `packages/openclaw-plugin/src/context.ts`
- Modify: `packages/openclaw-plugin/src/config.ts`
- Modify: `packages/openclaw-plugin/tests/context.test.ts`

**Step 1: Write failing tests for `resolveAgentId()`**

Add to `packages/openclaw-plugin/tests/context.test.ts`:

```typescript
import { resolveAgentId } from '../src/context.js';

describe('resolveAgentId', () => {
  it('should prefer explicit config agentId over everything', () => {
    const result = resolveAgentId(
      { agentId: 'from-hook', sessionKey: 'agent:from-session:telegram:123' },
      'from-config',
      'existing-state',
    );
    expect(result).toBe('from-config');
  });

  it('should use hook context agentId when no config', () => {
    const result = resolveAgentId(
      { agentId: 'from-hook' },
      undefined,
      'unknown',
    );
    expect(result).toBe('from-hook');
  });

  it('should parse from session key when agentId missing', () => {
    const result = resolveAgentId(
      { sessionKey: 'agent:my-agent:telegram:123' },
      undefined,
      'unknown',
    );
    expect(result).toBe('my-agent');
  });

  it('should keep existing state when hook provides nothing useful', () => {
    const result = resolveAgentId(
      {},
      undefined,
      'previously-resolved',
    );
    expect(result).toBe('previously-resolved');
  });

  it('should return "unknown" as last resort', () => {
    const result = resolveAgentId({}, undefined, 'unknown');
    expect(result).toBe('unknown');
  });

  it('should skip hook agentId if it is "unknown"', () => {
    const result = resolveAgentId(
      { agentId: 'unknown', sessionKey: 'agent:real-agent:web:1' },
      undefined,
      'unknown',
    );
    expect(result).toBe('real-agent');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm exec vitest run packages/openclaw-plugin/tests/context.test.ts
```

Expected: FAIL — `resolveAgentId` is not exported from context.ts.

**Step 3: Implement `resolveAgentId()` in context.ts**

Add to `packages/openclaw-plugin/src/context.ts` (after `getUserScopeKey`):

```typescript
/**
 * Resolve the effective agent ID from all available sources.
 *
 * Priority:
 * 1. Explicit config agentId (always wins)
 * 2. Hook context agentId (per-session, from gateway)
 * 3. Parsed from session key (fallback parsing)
 * 4. Existing state value (may be resolved from a previous hook call)
 * 5. "unknown" (last resort)
 *
 * Issue #1644: Agent ID must be resolved per-session from hook context,
 * not at plugin registration time from api.runtime.
 */
export function resolveAgentId(
  hookCtx: { agentId?: string; sessionKey?: string },
  configAgentId: string | undefined,
  currentStateValue: string,
): string {
  // 1. Explicit config (always wins)
  if (configAgentId) return configAgentId;

  // 2. Hook context agentId (skip if "unknown")
  if (hookCtx.agentId && hookCtx.agentId !== 'unknown') return hookCtx.agentId;

  // 3. Parse from session key
  const fromSession = parseAgentIdFromSessionKey(hookCtx.sessionKey);
  if (fromSession !== 'unknown') return fromSession;

  // 4. Existing state (may already be resolved from a previous hook call)
  if (currentStateValue !== 'unknown') return currentStateValue;

  // 5. Last resort
  return 'unknown';
}
```

**Step 4: Add `agentId` to config schemas**

In `packages/openclaw-plugin/src/config.ts`, add to `RawPluginConfigSchema` (after the `namespace` field, before `.strip()`):

```typescript
/** Explicit agent ID override. Used as namespace fallback when hook context is unavailable. */
agentId: z.string().min(1).max(63).regex(NAMESPACE_PATTERN, {
  message: 'agentId must be lowercase alphanumeric with dots, hyphens, underscores',
}).optional().describe('Explicit agent ID override'),
```

Add the same field to `PluginConfigSchema`:

```typescript
/** Explicit agent ID override */
agentId: z.string().min(1).max(63).optional(),
```

Add `agentId: rawConfig.agentId` to both `resolveConfigSecrets` and `resolveConfigSecretsSync` return objects.

**Step 5: Run tests to verify they pass**

```bash
pnpm exec vitest run packages/openclaw-plugin/tests/context.test.ts
pnpm run build  # verify types
```

Expected: All PASS.

**Step 6: Commit**

```bash
git add packages/openclaw-plugin/src/context.ts packages/openclaw-plugin/src/config.ts packages/openclaw-plugin/tests/context.test.ts
git commit -m "[#1644] Add resolveAgentId() and agentId config field"
```

---

### Task 2: Refactor hook option types to use getter functions

**Files:**
- Modify: `packages/openclaw-plugin/src/hooks.ts`
- Modify: `packages/openclaw-plugin/tests/hooks.test.ts` (if exists, check first)

**Step 1: Update `AutoRecallHookOptions` and `AutoCaptureHookOptions`**

In `packages/openclaw-plugin/src/hooks.ts`:

Change `AutoRecallHookOptions` (line 46-52):
```typescript
export interface AutoRecallHookOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  getUserId: () => string;  // was: user_id: string
  timeoutMs?: number;
}
```

Change `AutoCaptureHookOptions` (line 55-60):
```typescript
export interface AutoCaptureHookOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  getUserId: () => string;  // was: user_id: string
  timeoutMs?: number;
}
```

Change `GraphAwareRecallHookOptions` (line 322-329):
```typescript
export interface GraphAwareRecallHookOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  getUserId: () => string;  // was: user_id: string
  timeoutMs?: number;
}
```

**Step 2: Update all implementations in hooks.ts to call `getUserId()` instead of using `user_id`**

In `createAutoCaptureHook` (line 239): Change destructuring from `user_id` to `getUserId`:
```typescript
const { client, logger, config, getUserId, timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS } = options;
```

Then replace every `user_id` usage in that function with `getUserId()`. There are ~10 occurrences in logging and API calls. The key ones:
- Line 245: `logger.debug('auto-capture skipped: disabled in config', { user_id: getUserId() });`
- Line 264: `captureContext(client, getUserId(), event.messages, logger)`
- And all other logging lines.

Do the same for `createGraphAwareRecallHook` (line 368):
```typescript
const { client, logger, config, getUserId, timeoutMs = DEFAULT_RECALL_TIMEOUT_MS } = options;
```

Replace `user_id` → `getUserId()` in all logging and API calls within that function.

Also update `captureContext` (line 284) — this receives `user_id` as a parameter which is fine (it's already resolved by the caller). No change needed.

Also update `fetchGraphAwareContext` — find its signature and if it takes `user_id: string` as param, that's fine (resolved by caller). Same for `fetchBasicMemories`.

**Step 3: Run tests and typecheck**

```bash
pnpm exec vitest run packages/openclaw-plugin/tests/hooks.test.ts
pnpm run build
```

Fix any type errors. The callers in `register-openclaw.ts` will break (expected — we fix those in Task 5).

**Step 4: Commit**

```bash
git add packages/openclaw-plugin/src/hooks.ts packages/openclaw-plugin/tests/hooks.test.ts
git commit -m "[#1644] Refactor hook option types: user_id string → getUserId getter"
```

---

### Task 3: Refactor gateway methods and services to use getter functions

**Files:**
- Modify: `packages/openclaw-plugin/src/gateway/rpc-methods.ts`
- Modify: `packages/openclaw-plugin/src/gateway/oauth-rpc-methods.ts`
- Modify: `packages/openclaw-plugin/src/services/notification-service.ts`
- Modify: `packages/openclaw-plugin/src/utils/auto-linker.ts`

**Step 1: Update `GatewayMethodsOptions` in `rpc-methods.ts`**

Change interface (line 69-77):
```typescript
export interface GatewayMethodsOptions {
  logger: Logger;
  apiClient: ApiClient;
  getUserId: () => string;  // was: user_id: string
}
```

In `createGatewayMethods` (line 107-108):
```typescript
const { logger, apiClient, getUserId } = options;
```

Replace all `user_id` with `getUserId()` in logging and API calls within the function.

**Step 2: Update `OAuthGatewayMethodsOptions` in `oauth-rpc-methods.ts`**

Change interface (line 34-38):
```typescript
export interface OAuthGatewayMethodsOptions {
  logger: Logger;
  apiClient: ApiClient;
  getUserId: () => string;  // was: user_id: string
}
```

In `createOAuthGatewayMethods` (line 279-280):
```typescript
const { logger, apiClient, getUserId } = options;
```

Replace all `user_id` with `getUserId()` throughout all methods in the returned object. There are many occurrences — every `logger.debug(...)` call and every `apiClient.get/post(...)` call.

**Step 3: Update `NotificationServiceOptions` in `notification-service.ts`**

Change interface (line 36-44):
```typescript
export interface NotificationServiceOptions {
  logger: Logger;
  apiClient: ApiClient;
  getUserId: () => string;  // was: user_id: string
  events: NotificationServiceEvents;
  config?: Partial<NotificationConfig>;
}
```

In `createNotificationService` (line 82-83):
```typescript
const { logger, apiClient, getUserId, events, config: userConfig } = options;
```

Replace all `user_id` with `getUserId()`.

**Step 4: Update `AutoLinkOptions` in `auto-linker.ts`**

Change interface (line 55-63):
```typescript
export interface AutoLinkOptions {
  client: ApiClient;
  logger: Logger;
  getUserId: () => string;  // was: user_id: string
  message: AutoLinkMessage;
  similarityThreshold?: number;
}
```

In `autoLinkInboundMessage` (line 473-480):
```typescript
const { client, logger, getUserId, message, similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD } = options;
```

Replace all `user_id` with `getUserId()`. Also update `matchSenderToContacts` and `matchContentToWorkItems` calls — if they take `user_id: string` as a parameter, pass `getUserId()` at call site.

**Step 5: Typecheck (will fail on register-openclaw.ts callers — expected)**

```bash
pnpm run build 2>&1 | head -50
```

The only errors should be in `register-openclaw.ts` where it still passes `user_id` string. We fix that in Task 5.

**Step 6: Commit**

```bash
git add packages/openclaw-plugin/src/gateway/ packages/openclaw-plugin/src/services/ packages/openclaw-plugin/src/utils/auto-linker.ts
git commit -m "[#1644] Refactor gateway methods, services, auto-linker: user_id → getUserId getter"
```

---

### Task 4: Refactor register-openclaw.ts — tool handlers and hook wiring

This is the central task. All closures change to read from `state` instead of capturing strings.

**Files:**
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts`

**Step 1: Refactor `createToolHandlers` (line 1613-1617)**

Change from:
```typescript
function createToolHandlers(state: PluginState) {
  const { config, logger, apiClient, user_id, user_email, resolvedNamespace } = state;

  const reqOpts = (): { user_id: string; user_email?: string } => ({ user_id, user_email });

  function getStoreNamespace(params: Record<string, unknown>): string {
    const ns = params.namespace;
    if (typeof ns === 'string' && ns.length > 0) return ns;
    return resolvedNamespace.default;
  }

  function getRecallNamespaces(params: Record<string, unknown>): string[] {
    const ns = params.namespaces;
    if (Array.isArray(ns) && ns.length > 0) return ns as string[];
    const interval = config.namespaceRefreshIntervalMs ?? 300_000;
    if (interval > 0 && !state.hasStaticRecall && Date.now() - state.lastNamespaceRefreshMs > interval) {
      refreshNamespacesAsync(state);
    }
    return resolvedNamespace.recall;
  }
```

To:
```typescript
function createToolHandlers(state: PluginState) {
  const { config, logger, apiClient } = state;

  /** Read user_id from mutable state on every call (Issue #1644) */
  const reqOpts = (): { user_id: string; user_email?: string } => ({
    user_id: state.user_id,
    user_email: state.user_email,
  });

  /** Read namespace from mutable state on every call (Issue #1644) */
  function getStoreNamespace(params: Record<string, unknown>): string {
    const ns = params.namespace;
    if (typeof ns === 'string' && ns.length > 0) return ns;
    return state.resolvedNamespace.default;
  }

  function getRecallNamespaces(params: Record<string, unknown>): string[] {
    const ns = params.namespaces;
    if (Array.isArray(ns) && ns.length > 0) return ns as string[];
    const interval = config.namespaceRefreshIntervalMs ?? 300_000;
    if (interval > 0 && !state.hasStaticRecall && Date.now() - state.lastNamespaceRefreshMs > interval) {
      refreshNamespacesAsync(state);
    }
    return state.resolvedNamespace.recall;
  }
```

Also search for any remaining direct references to `user_id` or `user_email` in tool handlers that don't go through `reqOpts()`. Look for patterns like `user_email: user_id` — change to `user_email: state.user_id`.

**Step 2: Update hook creation calls (lines 4420-4613)**

Change auto-recall hook creation (line 4420-4426):
```typescript
const autoRecallHook = createGraphAwareRecallHook({
  client: apiClient,
  logger,
  config,
  getUserId: () => state.user_id,  // was: user_id
  timeoutMs: HOOK_TIMEOUT_MS,
});
```

Change auto-capture hook creation (line 4471-4477):
```typescript
const autoCaptureHook = createAutoCaptureHook({
  client: apiClient,
  logger,
  config,
  getUserId: () => state.user_id,  // was: user_id
  timeoutMs: HOOK_TIMEOUT_MS * 2,
});
```

Change gateway methods (line 4573-4577):
```typescript
const gatewayMethods = createGatewayMethods({
  logger,
  apiClient,
  getUserId: () => state.user_id,  // was: user_id
});
```

Change OAuth gateway methods (line 4581-4585):
```typescript
const oauthGatewayMethods = createOAuthGatewayMethods({
  logger,
  apiClient,
  getUserId: () => state.user_id,  // was: user_id
});
```

Change notification service (line 4604-4613):
```typescript
const notificationService = createNotificationService({
  logger,
  apiClient,
  getUserId: () => state.user_id,  // was: user_id
  events: eventEmitter,
  config: { ... },
});
```

Change message_received handler (line 4546-4549):
```typescript
await autoLinkInboundMessage({
  client: apiClient,
  logger,
  getUserId: () => state.user_id,  // was: user_id
  message: { ... },
});
```

**Step 3: Update `before_agent_start` hook to resolve agentId from context**

The existing handler (line 4433-4456) receives `_ctx: PluginHookAgentContext` but ignores it. Change `_ctx` to `ctx` and add state update at the top:

```typescript
const beforeAgentStartHandler = async (
  event: PluginHookBeforeAgentStartEvent,
  ctx: PluginHookAgentContext,
): Promise<PluginHookBeforeAgentStartResult | undefined> => {
  // Issue #1644: resolve agent ID from hook context and update state
  const resolvedId = resolveAgentId(ctx, config.agentId, state.user_id);
  if (resolvedId !== state.user_id) {
    const previousId = state.user_id;
    state.user_id = resolvedId;
    state.resolvedNamespace = resolveNamespaceConfig(config.namespace, resolvedId);
    logger.info('Agent ID resolved from hook context', {
      previousId,
      resolvedId,
      defaultNamespace: state.resolvedNamespace.default,
      recallNamespaces: state.resolvedNamespace.recall,
    });
  }

  // ... existing auto-recall logic below (unchanged)
```

Add the import at top of file:
```typescript
import { resolveAgentId } from './context.js';
```

**Step 4: Also update `agent_end` handler**

Change `_ctx` to `ctx` in the agent_end handler (line 4483) and add the same state update logic (in case before_agent_start didn't fire):

```typescript
const agentEndHandler = async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext): Promise<void> => {
  // Issue #1644: ensure agent ID is resolved even if before_agent_start didn't fire
  const resolvedId = resolveAgentId(ctx, config.agentId, state.user_id);
  if (resolvedId !== state.user_id) {
    state.user_id = resolvedId;
    state.resolvedNamespace = resolveNamespaceConfig(config.namespace, resolvedId);
    logger.info('Agent ID resolved from agent_end context', {
      resolvedId,
      defaultNamespace: state.resolvedNamespace.default,
    });
  }
  // ... existing auto-capture logic
```

**Step 5: Add warning at registration time if agentId is "unknown"**

After line 3873 (where resolvedNamespace is logged), add:

```typescript
if (context.agent.agentId === 'unknown' && !config.agentId) {
  logger.warn(
    'Agent ID not available at registration time — will resolve from hook context. ' +
    'Set config.agentId for explicit override. (Issue #1644)',
  );
}
```

**Step 6: Typecheck and run tests**

```bash
pnpm run build
pnpm exec vitest run packages/openclaw-plugin/tests/
```

Expected: All PASS. The closure refactor is purely structural — behavior is identical until a hook fires with real context.

**Step 7: Commit**

```bash
git add packages/openclaw-plugin/src/register-openclaw.ts
git commit -m "[#1644] Refactor closures to read from mutable state; resolve agentId from hook context"
```

---

### Task 5: Split `verifyNamespaceScope` for READ vs WRITE (#1645)

**Files:**
- Modify: `src/api/server.ts`

**Step 1: Add new functions alongside existing `verifyNamespaceScope`**

After `verifyNamespaceScope` (line 372), add:

```typescript
/**
 * Verify that an entity exists (any namespace). For READ-only endpoints.
 * Issue #1645: UUID lookups should not be namespace-scoped.
 */
async function verifyEntityExists(
  pool: ReturnType<typeof createPool>,
  table: string,
  id: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM "${table}" WHERE id = $1`,
    [id],
  );
  return result.rows.length > 0;
}

/**
 * Verify that an entity exists AND is in a namespace the caller can access.
 * For WRITE endpoints (PATCH/PUT/DELETE). Preserves security boundary.
 * Renamed from verifyNamespaceScope for clarity (Issue #1645).
 */
async function verifyWriteScope(
  pool: ReturnType<typeof createPool>,
  table: string,
  id: string,
  req: FastifyRequest,
): Promise<boolean> {
  const queryNamespaces = req.namespaceContext?.queryNamespaces ?? ['default'];
  const result = await pool.query(
    `SELECT 1 FROM "${table}" WHERE id = $1 AND namespace = ANY($2::text[])`,
    [id, queryNamespaces],
  );
  return result.rows.length > 0;
}
```

**Step 2: Replace all 33 READ endpoint calls**

Use find-and-replace for each READ endpoint. The pattern is:
```
verifyNamespaceScope(pool, 'TABLE', params.id, req)
```
Replace with (for GET endpoints only):
```
verifyEntityExists(pool, 'TABLE', params.id)
```

The 33 READ endpoints (approximate line numbers from the exploration):
- Lines: 1748, 3128, 4131, 5042, 5107, 5253, 5479, 5793, 5867, 6034, 6079, 6146, 6948, 7359, 7394, 7551, 7681, 7781, 7866, 9823, 10116, 10395, 10518, 10630, 10721, 10778, 12619, 13065, 13332, 17504, 17638, 17657, 17676

For each one: verify it's a GET handler, then replace `verifyNamespaceScope(pool, ...)` with `verifyEntityExists(pool, ...)` (dropping the `req` parameter).

**Step 3: Rename all 53 WRITE endpoint calls**

For PATCH/PUT/DELETE/POST endpoints, rename:
```
verifyNamespaceScope(pool, 'TABLE', params.id, req)
```
to:
```
verifyWriteScope(pool, 'TABLE', params.id, req)
```

This is a rename only — same behavior, better intent signaling.

**Step 4: Remove the old `verifyNamespaceScope` function**

Once all callers are migrated, delete lines 368-372.

**Step 5: Typecheck**

```bash
pnpm run build
```

Expected: PASS — all callers migrated.

**Step 6: Commit**

```bash
git add src/api/server.ts
git commit -m "[#1645] Split verifyNamespaceScope: verifyEntityExists (READ) + verifyWriteScope (WRITE)"
```

---

### Task 6: Add namespace scoping to `resolveContact()` (#1646)

**Files:**
- Modify: `src/api/relationships/service.ts`
- Modify: `src/api/relationships/types.ts`

**Step 1: Add `queryNamespaces` to `RelationshipSetInput`**

In `src/api/relationships/types.ts` (after line 156):

```typescript
/** Namespaces to search when resolving contact names (Epic #1418) */
queryNamespaces?: string[];
```

**Step 2: Update `resolveContact()` signature and implementation**

In `src/api/relationships/service.ts` (line 437):

```typescript
async function resolveContact(
  pool: Pool,
  identifier: string,
  queryNamespaces?: string[],
): Promise<{ id: string; display_name: string } | null> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // UUID lookup: no namespace filter (UUIDs are globally unique, Issue #1645)
  if (uuidPattern.test(identifier)) {
    const result = await pool.query(
      `SELECT id::text as id, display_name FROM contact WHERE id = $1`,
      [identifier],
    );
    if (result.rows.length > 0) {
      const row = result.rows[0] as { id: string; display_name: string };
      return { id: row.id, display_name: row.display_name };
    }
  }

  // Name lookup: namespace-scoped when namespaces provided (names aren't globally unique)
  if (queryNamespaces && queryNamespaces.length > 0) {
    const nameResult = await pool.query(
      `SELECT id::text as id, display_name FROM contact
       WHERE lower(display_name) = lower($1) AND namespace = ANY($2::text[])
       ORDER BY created_at ASC
       LIMIT 1`,
      [identifier, queryNamespaces],
    );
    if (nameResult.rows.length > 0) {
      const row = nameResult.rows[0] as { id: string; display_name: string };
      return { id: row.id, display_name: row.display_name };
    }
  } else {
    // No namespace filter (backward compat for callers without namespace context)
    const nameResult = await pool.query(
      `SELECT id::text as id, display_name FROM contact
       WHERE lower(display_name) = lower($1)
       ORDER BY created_at ASC
       LIMIT 1`,
      [identifier],
    );
    if (nameResult.rows.length > 0) {
      const row = nameResult.rows[0] as { id: string; display_name: string };
      return { id: row.id, display_name: row.display_name };
    }
  }

  return null;
}
```

**Step 3: Update `relationshipSet()` to pass namespaces**

In `src/api/relationships/service.ts` (line 508-518):

```typescript
export async function relationshipSet(pool: Pool, input: RelationshipSetInput): Promise<RelationshipSetResult> {
  // Step 1 & 2: Resolve contacts (with namespace scoping for name lookups, Issue #1646)
  const contact_a = await resolveContact(pool, input.contact_a, input.queryNamespaces);
  if (!contact_a) {
    throw new Error(`Contact "${input.contact_a}" cannot be resolved. No matching contact found.`);
  }

  const contact_b = await resolveContact(pool, input.contact_b, input.queryNamespaces);
  if (!contact_b) {
    throw new Error(`Contact "${input.contact_b}" cannot be resolved. No matching contact found.`);
  }
```

**Step 4: Add namespace to existing-relationship check**

In `relationshipSet()` (line 527-536), update the existing relationship query:

```typescript
// Step 4: Check for existing relationship (with namespace scoping, Issue #1646)
const existingQuery = input.queryNamespaces?.length
  ? `SELECT id::text as id, contact_a_id::text as contact_a_id,
          contact_b_id::text as contact_b_id,
          relationship_type_id::text as relationship_type_id,
          notes, created_by_agent, embedding_status,
          created_at, updated_at
     FROM relationship
     WHERE contact_a_id = $1 AND contact_b_id = $2 AND relationship_type_id = $3
       AND namespace = ANY($4::text[])`
  : `SELECT id::text as id, contact_a_id::text as contact_a_id,
          contact_b_id::text as contact_b_id,
          relationship_type_id::text as relationship_type_id,
          notes, created_by_agent, embedding_status,
          created_at, updated_at
     FROM relationship
     WHERE contact_a_id = $1 AND contact_b_id = $2 AND relationship_type_id = $3`;

const existingParams = input.queryNamespaces?.length
  ? [contact_a.id, contact_b.id, relType.id, input.queryNamespaces]
  : [contact_a.id, contact_b.id, relType.id];

const existingResult = await pool.query(existingQuery, existingParams);
```

**Step 5: Update the API endpoint to pass queryNamespaces**

Find the `/api/relationships/set` handler in `src/api/server.ts` (around line 17449). It should already extract namespace from the request. Add `queryNamespaces`:

```typescript
const queryNamespaces = req.namespaceContext?.queryNamespaces ?? ['default'];
// ... in the call to relationshipSet:
const result = await relationshipSet(pool, {
  contact_a: body.contact_a,
  contact_b: body.contact_b,
  relationship_type: body.relationship_type,
  notes: body.notes,
  created_by_agent: body.user_email ?? body.created_by_agent,
  namespace: getStoreNamespace(req),
  queryNamespaces,  // Issue #1646
});
```

**Step 6: Typecheck**

```bash
pnpm run build
```

**Step 7: Commit**

```bash
git add src/api/relationships/ src/api/server.ts
git commit -m "[#1646] Add namespace scoping to resolveContact() and relationshipSet()"
```

---

### Task 7: Data migration for `namespace = 'unknown'`

**Files:**
- Create: `migrations/115_cleanup_unknown_namespace.up.sql`
- Create: `migrations/115_cleanup_unknown_namespace.down.sql`

**Step 1: Write the up migration**

```sql
-- Issue #1644: Migrate entities created with namespace='unknown'
-- (caused by plugin bug where agent ID defaulted to 'unknown')
-- Moves all 'unknown' namespace rows to 'default'.

DO $$
DECLARE
  tbl text;
  cnt int;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'work_item', 'contact', 'contact_endpoint', 'memory',
      'relationship', 'external_thread', 'external_message',
      'notebook', 'note', 'notification', 'list', 'recipe',
      'meal_log', 'pantry_item', 'entity_link', 'context',
      'file_attachment', 'file_share', 'skill_store_item', 'dev_session'
    ])
  LOOP
    EXECUTE format(
      'UPDATE %I SET namespace = $1, updated_at = now() WHERE namespace = $2',
      tbl
    ) USING 'default', 'unknown';
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN
      RAISE NOTICE 'Migrated % rows in % from unknown to default', cnt, tbl;
    END IF;
  END LOOP;
END $$;
```

**Step 2: Write the down migration (no-op)**

```sql
-- No-op: namespace='unknown' data migration is irreversible (data was buggy).
-- Original namespace was always intended to be the agent's real namespace,
-- not 'unknown'. There is no meaningful rollback.
SELECT 1;
```

**Step 3: Commit**

```bash
git add migrations/115_cleanup_unknown_namespace.up.sql migrations/115_cleanup_unknown_namespace.down.sql
git commit -m "[#1644] Add migration to move namespace='unknown' rows to 'default'"
```

---

### Task 8: Full verification

**Step 1: Typecheck**

```bash
pnpm run build
```

Expected: Clean — no type errors.

**Step 2: Run plugin unit tests**

```bash
pnpm exec vitest run packages/openclaw-plugin/tests/
```

Expected: All PASS.

**Step 3: Run full test suite**

```bash
pnpm exec vitest run
```

Expected: All PASS (or only pre-existing failures unrelated to this change).

**Step 4: Final commit if any fixups needed**

```bash
# Only if test fixes were needed
git add -A && git commit -m "[#1644][#1645][#1646] Fix test failures from omnibus refactor"
```

---

### Task 9: Push and create omnibus PR

**Step 1: Push branch**

```bash
git push -u origin omnibus/1644-1645-1646-namespace-agent-id
```

**Step 2: Create PR**

```bash
gh pr create \
  --title "[#1644][#1645][#1646] Omnibus: Fix namespace resolution — agent ID, UUID lookups, relationship_set" \
  --body "$(cat <<'EOF'
## Summary

Fixes three related namespace resolution bugs:

- **#1644**: Plugin agent ID not resolved from OpenClaw runtime — defaults to 'unknown'. Refactored all 7 closure-captured `user_id` references to read from mutable `PluginState` via getter functions. Agent ID is now resolved per-session from hook context (`before_agent_start`) with priority: config > hook ctx > session key > existing state.
- **#1645**: API GET-by-ID endpoints returned 404 for valid UUIDs in unrecognised namespaces. Split `verifyNamespaceScope` into `verifyEntityExists` (READ, no namespace filter) and `verifyWriteScope` (WRITE, keeps namespace security).
- **#1646**: `relationship_set` failed with 404 when contacts existed in a different namespace. Added `queryNamespaces` parameter to `resolveContact()` for namespace-scoped name lookups (UUID lookups remain unscoped).

Includes data migration (115) to move existing `namespace='unknown'` rows to `'default'`.

Closes #1644
Closes #1645
Closes #1646

## Test plan

- [ ] `pnpm run build` passes (typecheck)
- [ ] `pnpm exec vitest run packages/openclaw-plugin/tests/context.test.ts` — resolveAgentId priority chain
- [ ] `pnpm exec vitest run packages/openclaw-plugin/tests/` — all plugin tests pass
- [ ] `pnpm exec vitest run` — full test suite passes
- [ ] Manual: Register plugin with gateway, verify agentId resolves from hook context
- [ ] Manual: Create entity via plugin, verify correct namespace
- [ ] Manual: GET entity by UUID from different namespace context — should return entity
- [ ] Manual: PATCH entity from wrong namespace — should return 404

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: Return PR URL**
