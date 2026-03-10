# ADR 0002: Multi-Namespace UI Selection

- Status: accepted
- Date: 2026-03-10
- Related:
  - Epic #2345: User Namespace Selection in UI
  - Issue #2349: Frontend core — namespace headers + query keys
  - Issue #2350: useNamespaceQueryKey hook
  - Issue #2351: Multi-namespace context
  - Issue #2353: Namespace management settings page
  - Issue #2354: Backend — Settings API active_namespaces field
  - Issue #2360: Race prevention on namespace switch

## Context

Users can belong to multiple namespaces (workspaces). Before this epic, the UI had no mechanism for users to select which namespace(s) they wanted to view or operate within. The backend already supported namespace-scoped data via the `namespace_grant` table and `X-Namespace` header, but the frontend always used the server-determined default.

We needed to decide:

1. How the frontend communicates the active namespace to the backend
2. How to handle multi-namespace reads vs single-namespace writes
3. How to segment the client-side cache when namespaces change
4. How to persist the user's namespace selection across sessions
5. How to prevent stale data from a previous namespace leaking into the new one

## Decision

### Global Header Injection (not per-request)

Namespace context is injected globally into all API requests via the `api-client.ts` module. A module-level resolver function (`getActiveNamespaces`) is registered by the `NamespaceProvider` React context. The `buildHeaders()` function in the API client calls this resolver on every request.

**Rationale:** Avoids threading namespace parameters through every query hook and mutation. The resolver pattern decouples the API client from React context (no circular dependency).

### Dual Header Strategy: X-Namespace vs X-Namespaces

- **Single namespace selected:** `X-Namespace: my-workspace` header (backward compatible).
- **Multiple namespaces selected:** `X-Namespaces: ws-a,ws-b` header (comma-separated).

The backend `extractRequestedNamespaces()` in `middleware.ts` checks `X-Namespaces` first, then falls back to `X-Namespace`. This maintains backward compatibility with M2M tokens and existing API consumers.

### Write-Namespace vs Read-Namespaces Split

- **Writes** always target the primary namespace (first element of `activeNamespaces`). The backend resolves `storeNamespace` from the first requested namespace.
- **Reads** can span multiple namespaces. The backend populates `queryNamespaces` with all requested namespaces and uses `ANY(queryNamespaces)` filters in SQL queries.

This split is enforced in the `NamespaceContext`: `activeNamespace` (singular) is always `activeNamespaces[0]`, used for write operations. The full `activeNamespaces` array is used for read queries.

### Query Key Segmentation via useNamespaceQueryKey

TanStack Query keys are segmented by namespace using `useNamespaceQueryKey()`. This prepends a `{ namespaces: string[] }` descriptor to every query key:

```ts
const key = useNamespaceQueryKey(['projects', 'list']);
// → [{ namespaces: ['troy'] }, 'projects', 'list']
```

When the user switches namespaces, all query keys change, which means TanStack Query treats them as new queries. This avoids serving cached data from a different namespace.

### Persistence via localStorage

Active namespaces are persisted to `localStorage` under the key `openclaw-active-namespaces` (JSON array). A migration path exists from the legacy single-namespace key `openclaw-active-namespace`.

On initialization, the context:
1. Reads from `openclaw-active-namespaces` (new format)
2. Falls back to `openclaw-active-namespace` (legacy migration)
3. Falls back to the home namespace grant
4. Falls back to the first alphabetical grant
5. Falls back to `'default'`

### Race Prevention on Namespace Switch (#2360)

When the user switches namespaces:

1. `namespaceVersion` counter increments (monotonic).
2. All inflight TanStack Query requests are cancelled via `queryClient.cancelQueries()`.
3. The entire query cache is reset via `queryClient.resetQueries()`.
4. New requests use the updated namespace headers from the resolver.

On 401 retry (token refresh), namespace headers are kept from the original request snapshot to prevent a mid-flight namespace change from mixing data.

## Consequences

### Positive

- Zero changes needed to individual query/mutation hooks — header injection is automatic.
- Cache segmentation prevents cross-namespace data leaks without manual cache key management.
- Multi-namespace reads enable combined views (e.g., seeing tasks from all workspaces).
- Backward compatible with existing M2M and single-namespace flows.

### Negative

- Full cache reset on namespace switch means brief loading states. Acceptable tradeoff for data correctness.
- Module-level resolver pattern is harder to test than explicit parameter passing. Mitigated by `setNamespaceResolver()` being callable in test setup.
- localStorage persistence means shared browser profiles could have namespace selection conflicts. Acceptable for current user base.

## Implementation Notes

- `NamespaceProvider` wraps the app at the root level (inside `QueryClientProvider`).
- The namespace resolver is set via `setNamespaceResolver()` in an effect, cleaned up on unmount.
- Backend validation: namespace names must match `^[a-z0-9][a-z0-9._-]*$`, max 63 chars, max 20 per request.
- Single-namespace users see no selector UI (hidden via `hasMultipleNamespaces` flag).
