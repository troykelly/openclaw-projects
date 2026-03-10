# ADR 0002: Multi-namespace UI selection design

- Status: accepted
- Date: 2026-03-10
- Related:
  - Epic #2345: User Namespace Selection in UI
  - Issue #2348: Backend schema + API
  - Issue #2349: NamespaceContext + state management
  - Issue #2350: API client header injection
  - Issue #2351: TanStack Query key segmentation
  - Issue #2360: Race condition prevention

## Context

Users can belong to multiple namespaces with different access levels. The UI needs a way to:

1. Let users select which namespace(s) to view data from
2. Propagate that selection to all API calls
3. Ensure cached data is segmented by namespace selection
4. Persist the selection across sessions
5. Handle race conditions during namespace transitions

Previously, the API used a single `x-namespace` header. Users could only view one namespace at a time.

## Decisions

### 1. Single vs Multi-Namespace Selection

**Decision:** Support both single-namespace and multi-namespace modes.

**Rationale:** Single-namespace mode is the default for simplicity. Multi-namespace mode lets power users (e.g., team leads overseeing multiple projects) view aggregated data. The `NamespaceContext` tracks both `activeNamespace` (single, used for writes) and `activeNamespaces` (array, used for reads).

**Trade-off:** Multi-namespace mode requires the backend to accept an array of namespaces in query/header parameters. The `x-namespace-multi` header carries a comma-separated list. Write operations always target `activeNamespace` (the single primary).

### 2. State Storage: `user_setting` Table

**Decision:** Persist `active_namespaces` as a `JSONB` column in the `user_setting` table.

**Rationale:** Alternatives considered:
- **localStorage only:** Lost on device switch, no server-side awareness for M2M agents
- **Dedicated table:** Over-engineering for a simple array preference
- **Cookie:** Size limits, sent on every request regardless of need

`user_setting` already stores per-user preferences (theme, sidebar state, etc.). Adding `active_namespaces` there keeps the schema flat and allows the bootstrap endpoint to return the selection alongside other settings.

The server also returns `active_namespaces_sanitized` which filters the stored array against the user's actual grants. This prevents stale namespace references from causing errors when grants are revoked.

### 3. API Client Header Injection

**Decision:** Use a global request interceptor on the API client to inject namespace headers into every request.

**Rationale:** Alternatives considered:
- **Per-hook parameter passing:** Requires every query/mutation to explicitly pass namespaces. Fragile, easy to forget.
- **URL query parameter:** Works but pollutes URLs and requires server-side parsing changes.
- **Global header injection:** Single point of configuration, no changes needed in individual hooks.

The `apiClient` reads from `NamespaceContext` via a callback registered at mount time. It injects:
- `x-namespace`: The primary active namespace (for write operations)
- `x-namespace-multi`: Comma-separated list of all active namespaces (for read operations that support multi-namespace)

### 4. TanStack Query Key Segmentation

**Decision:** Prefix all query keys with a namespace descriptor object: `[{ namespaces: ['acme'] }, ...baseKey]`.

**Rationale:** When the user switches namespaces, all cached data must be invalidated or segmented. Options:
- **Manual invalidation on switch:** Error-prone, requires tracking every query
- **Key prefix segmentation:** Automatic cache separation, no stale data shown during transitions

The `useNamespaceQueryKey(baseKey)` hook wraps any base key with the current namespace selection. TanStack Query treats different namespace arrays as different cache entries. When the user switches back to a previously-viewed namespace, the cached data is still available (instant switch).

**Trade-off:** This increases cache memory usage (one cache entry per namespace combination). In practice, users rarely have more than 3-5 namespaces, making this negligible.

### 5. Race Condition Prevention

**Decision:** Use a transition overlay and synchronous state flushing during namespace switches.

**Rationale:** Without protection, switching namespaces can cause:
- In-flight queries returning data for the old namespace displayed in a new-namespace context
- Mutations targeting the wrong namespace
- Flash of stale data before new queries resolve

The `NamespaceTransitionOverlay` component:
1. Shows a brief overlay when `activeNamespace` changes
2. Blocks user interaction during the transition
3. Waits for the API client's namespace header callback to update
4. Clears once new queries begin fetching

This is a lightweight approach compared to alternatives like cancelling all in-flight queries (which would cause loading flicker) or maintaining parallel query clients (which would double memory usage).

### 6. M2M `api:full` Trust Model

**Decision:** M2M tokens with `api:full` scope bypass per-user namespace access checks on read operations.

**Rationale:** OpenClaw agents are the primary API consumers and need cross-namespace visibility for orchestration. The `api:full` scope is only granted to trusted infrastructure (the OpenClaw gateway). Write/admin operations (invite, update grant, remove grant) still require an explicit `readwrite` grant even for M2M tokens.

**Security boundary:** M2M tokens require a server-side JWT secret. If the secret is compromised, all API operations are exposed, not just namespace access. The `api:full` scope is an explicit opt-in for full visibility.

## Consequences

### Positive
- Users can switch namespaces without page reload
- Cached data is automatically segmented, preventing cross-namespace data leaks
- The design scales to multi-namespace mode without architectural changes
- M2M agents can orchestrate across all namespaces

### Negative
- Query key segmentation increases cache memory proportional to namespace count
- The transition overlay adds a brief visual interruption on namespace switch
- The `active_namespaces_sanitized` server computation adds a small overhead to settings reads

### Risks
- If a user has many namespaces and frequently switches, cache memory could grow. Mitigated by TanStack Query's `gcTime` eviction.
- The mutation invalidation pattern (invalidating by `namespaceKeys.all`) does not match namespaced query keys (prefixed with `{ namespaces: [...] }`). This is tracked in issue #2363 and will be addressed separately.
