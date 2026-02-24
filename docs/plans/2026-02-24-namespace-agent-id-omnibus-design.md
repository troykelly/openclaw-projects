# Design: Omnibus Namespace & Agent ID Fixes (#1644, #1645, #1646)

**Date**: 2026-02-24
**Issues**: #1644, #1645, #1646
**Status**: Approved

## Problem Statement

Three related bugs form a single namespace resolution defect cluster:

1. **#1644 (Root cause)**: Plugin's `extractAgentContext()` reads `api.runtime.agent.id` which doesn't exist on `PluginRuntime`. The agentId defaults to `"unknown"`, causing all entities to be created with `namespace = "unknown"`.

2. **#1645**: API's `verifyNamespaceScope()` applies namespace filtering on UUID-based lookups. Entities in unrecognised namespaces return 404 even though UUIDs are globally unique.

3. **#1646**: `resolveContact()` in the relationship service queries contacts without namespace filtering. When contacts exist in a different namespace, `relationship_set` fails with 404.

## Root Cause Analysis

### #1644: Agent ID Resolution Chain Failure

The plugin extracts agent context at registration time:

```
register-openclaw.ts:3862  →  extractContext(api.runtime)
context.ts:69               →  extractAgentContext(runtime)
context.ts:80               →  runtime.agent.id  →  undefined  →  "unknown"
config.ts:342               →  NAMESPACE_PATTERN.test("unknown")  →  true
                             →  namespace = "unknown"
```

The SDK provides agent identity through **hook context** (`PluginHookAgentContext.agentId`), not through `api.runtime`. The plugin reads from the wrong source and bakes it in at registration time.

**Compounding factor**: Seven components capture `user_id` as a string in closures at creation time. Even if `state.user_id` were updated later, the captured values would remain stale:

| Component | File | Capture Point |
|-----------|------|---------------|
| Tool handlers (30 tools) | register-openclaw.ts:1614 | `const { user_id } = state` |
| Auto-recall hook | register-openclaw.ts:4424 | `user_id` in options object |
| Auto-capture hook | register-openclaw.ts:4475 | `user_id` in options object |
| Gateway RPC methods | register-openclaw.ts:4577 | `user_id` in options object |
| OAuth gateway methods | register-openclaw.ts:4585 | `user_id` in options object |
| Notification service | register-openclaw.ts:4612 | `user_id` in options object |
| message_received handler | register-openclaw.ts:4549 | `user_id` from outer scope |

### #1645: Namespace Scoping on UUID Lookups

`verifyNamespaceScope()` (server.ts:368) runs `SELECT 1 FROM "table" WHERE id = $1 AND namespace = ANY($2::text[])`. This is used by 86 endpoints — 33 READ and 53 WRITE. For READ operations on globally-unique UUIDs, the namespace filter is unnecessary and causes false 404s.

### #1646: Unscoped Contact Resolution

`resolveContact()` (relationships/service.ts:437) queries contacts by UUID or display name without any namespace parameter. Name-based lookups are ambiguous across namespaces.

## Design

### Fix #1644: Refactor Closure Captures + Hook-Based State Update

**Phase 1: Make state mutable and readable**

Refactor all seven components to read `user_id` from `state` via a getter function instead of capturing a static string:

```typescript
// Tool handlers: read from state on each call
function createToolHandlers(state: PluginState) {
  const reqOpts = () => ({
    user_id: state.user_id,
    user_email: state.user_email,
  });
  function getStoreNamespace(params: Record<string, unknown>): string {
    const ns = params.namespace;
    if (typeof ns === 'string' && ns.length > 0) return ns;
    return state.resolvedNamespace.default;
  }
  // ... handlers use reqOpts() and getStoreNamespace() which read state each time
}
```

For hook/service creators that accept `user_id` as an option, change the parameter type:

```typescript
// hooks.ts
interface RecallHookOptions {
  getUserId: () => string;  // was: user_id: string
  // ...
}
```

**Phase 2: Update state from hook context**

In `before_agent_start` hook, read `ctx.agentId` and update state:

```typescript
const beforeAgentStartHandler = async (
  event: PluginHookBeforeAgentStartEvent,
  ctx: PluginHookAgentContext,
): Promise<PluginHookBeforeAgentStartResult | undefined> => {
  // Update agent ID from hook context
  const agentId = resolveAgentId(ctx, config);
  if (agentId !== state.user_id) {
    state.user_id = agentId;
    state.resolvedNamespace = resolveNamespaceConfig(config.namespace, agentId);
    logger.info('Agent ID resolved from hook context', {
      agentId,
      namespace: state.resolvedNamespace.default,
    });
  }
  // ... existing auto-recall logic
};
```

**Agent ID resolution priority**:

```typescript
function resolveAgentId(ctx: PluginHookAgentContext, config: PluginConfig): string {
  // 1. Explicit config (always wins)
  if (config.agentId) return config.agentId;
  // 2. Hook context agentId
  if (ctx.agentId && ctx.agentId !== 'unknown') return ctx.agentId;
  // 3. Parse from session key
  const fromSession = parseAgentIdFromSessionKey(ctx.sessionKey);
  if (fromSession !== 'unknown') return fromSession;
  // 4. Existing state (may already be resolved from a previous hook call)
  if (state.user_id !== 'unknown') return state.user_id;
  // 5. Last resort
  logger.warn('Agent ID could not be resolved — using "unknown"');
  return 'unknown';
}
```

**Phase 3: Optional config field**

Add optional `agentId` field to `RawPluginConfigSchema` for explicit override:

```typescript
agentId: z.string().min(1).max(63).regex(NAMESPACE_PATTERN).optional()
  .describe('Explicit agent ID override — used as namespace fallback'),
```

### Fix #1645: Split verifyNamespaceScope for READ vs WRITE

**New functions** replacing `verifyNamespaceScope()`:

```typescript
// For READ: entity must exist, no namespace filter
async function verifyEntityExists(
  pool: Pool, table: string, id: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM "${table}" WHERE id = $1`,
    [id],
  );
  return result.rows.length > 0;
}

// For WRITE: entity must exist AND be in caller's writable namespace
async function verifyWriteScope(
  pool: Pool, table: string, id: string, req: FastifyRequest,
): Promise<boolean> {
  const queryNamespaces = req.namespaceContext?.queryNamespaces ?? ['default'];
  const result = await pool.query(
    `SELECT 1 FROM "${table}" WHERE id = $1 AND namespace = ANY($2::text[])`,
    [id, queryNamespaces],
  );
  return result.rows.length > 0;
}
```

**Migration strategy for 86 call sites**:

- 33 READ endpoints (GET by ID): Replace `verifyNamespaceScope` → `verifyEntityExists`
- 53 WRITE endpoints (PATCH/PUT/DELETE): Replace `verifyNamespaceScope` → `verifyWriteScope` (same behavior, renamed for clarity)

### Fix #1646: Namespace-Scoped Contact Resolution

Add `queryNamespaces` parameter to `resolveContact()`:

```typescript
async function resolveContact(
  pool: Pool,
  identifier: string,
  queryNamespaces?: string[],
): Promise<{ id: string; display_name: string } | null> {
  // UUID lookup: no namespace filter (UUIDs are globally unique)
  if (uuidPattern.test(identifier)) {
    const result = await pool.query(
      `SELECT id::text as id, display_name FROM contact WHERE id = $1`,
      [identifier],
    );
    if (result.rows.length > 0) return result.rows[0];
  }

  // Name lookup: namespace-scoped (names aren't globally unique)
  const nameQuery = queryNamespaces?.length
    ? `SELECT id::text as id, display_name FROM contact
       WHERE lower(display_name) = lower($1) AND namespace = ANY($2::text[])
       ORDER BY created_at ASC LIMIT 1`
    : `SELECT id::text as id, display_name FROM contact
       WHERE lower(display_name) = lower($1)
       ORDER BY created_at ASC LIMIT 1`;

  const nameParams = queryNamespaces?.length
    ? [identifier, queryNamespaces]
    : [identifier];

  const nameResult = await pool.query(nameQuery, nameParams);
  if (nameResult.rows.length > 0) return nameResult.rows[0];
  return null;
}
```

Update `relationshipSet()` to pass namespaces:

```typescript
const contact_a = await resolveContact(pool, input.contact_a, input.queryNamespaces);
const contact_b = await resolveContact(pool, input.contact_b, input.queryNamespaces);
```

Also add namespace filter to the existing-relationship check:

```sql
WHERE contact_a_id = $1 AND contact_b_id = $2
  AND relationship_type_id = $3
  AND namespace = ANY($4::text[])
```

### Data Migration

Add migration to move `namespace = 'unknown'` rows to `'default'`:

```sql
-- Migration: cleanup_unknown_namespace
-- Move entities with namespace='unknown' (created by buggy plugin) to 'default'

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

## Test Plan

### #1644 Tests
- Unit: `resolveAgentId()` priority chain (config > hook ctx > session key > existing state > unknown)
- Unit: State getter pattern — mutate `state.user_id`, verify `reqOpts()` returns new value
- Unit: Hook/service creators accept getter function, call it on each invocation
- Integration: Plugin registration with "unknown", hook fires with agentId, tool calls use correct namespace

### #1645 Tests
- Unit: `verifyEntityExists()` returns true for any existing entity regardless of namespace
- Unit: `verifyWriteScope()` returns false when entity namespace not in caller's queryNamespaces
- Integration: Create entity in namespace A, GET-by-ID from namespace B succeeds
- Integration: Create entity in namespace A, PATCH from namespace B fails (403/404)

### #1646 Tests
- Unit: `resolveContact()` with UUID — finds contact regardless of namespace
- Unit: `resolveContact()` with name + queryNamespaces — only finds contacts in given namespaces
- Unit: `resolveContact()` with name, no namespace — finds across all namespaces (backward compat)
- Integration: `relationship_set` with contacts in caller's namespace succeeds
- Integration: `relationship_set` with contacts in different namespace by UUID succeeds

### Data Migration Tests
- Verify no rows remain with `namespace = 'unknown'` after migration
- Verify migrated rows are visible via standard namespace-scoped queries

## Files to Modify

### Plugin Package (`packages/openclaw-plugin/`)
| File | Changes |
|------|---------|
| `src/config.ts` | Add optional `agentId` field to config schema |
| `src/context.ts` | Add `resolveAgentId()` function |
| `src/register-openclaw.ts` | Refactor closures to use state getters; update `before_agent_start` hook |
| `src/hooks.ts` | Change `user_id: string` → `getUserId: () => string` in hook option types |
| `src/gateway/rpc-methods.ts` | Change `user_id` → getter function |
| `src/gateway/oauth-rpc-methods.ts` | Change `user_id` → getter function |
| `src/services/notification-service.ts` | Change `user_id` → getter function |
| `src/utils/auto-linker.ts` | Change `user_id` → getter function |
| `tests/context.test.ts` | Add tests for `resolveAgentId()` |
| `tests/hooks.test.ts` | Update tests for getter-based hooks |

### API (`src/api/`)
| File | Changes |
|------|---------|
| `server.ts` | Split `verifyNamespaceScope` into `verifyEntityExists` + `verifyWriteScope`; update 86 call sites |
| `relationships/service.ts` | Add `queryNamespaces` to `resolveContact()` and `relationshipSet()` |

### Migrations
| File | Changes |
|------|---------|
| `migrations/115_cleanup_unknown_namespace.up.sql` | Move `namespace = 'unknown'` rows to `'default'` |
| `migrations/115_cleanup_unknown_namespace.down.sql` | No-op (irreversible data fix) |
