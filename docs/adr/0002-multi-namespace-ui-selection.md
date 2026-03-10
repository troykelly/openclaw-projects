# ADR 0002: Multi-Namespace UI Selection

- Status: accepted
- Date: 2026-03-10
- Related:
  - Epic #2345: User Namespace Selection in UI
  - Issue #2349: Frontend core — namespace headers + query keys
  - Issue #2350: useNamespaceQueryKey hook
  - Issue #2351: Multi-namespace context
  - Issue #2353: Namespace management settings page
  - Issue #2360: Race prevention on namespace switch

## Context

Users can belong to multiple namespaces (workspaces). Before this epic, the UI had no mechanism for users to select which namespace(s) they wanted to view or operate within. The backend already supported namespace-scoped data via the `namespace_grant` table and `X-Namespace` header, but the frontend always used the server-determined default.

We needed to decide:

1. How the frontend communicates the active namespace to the backend
2. How to segment the client-side cache when namespaces change
3. How to persist the user's namespace selection across sessions
4. How to prevent stale data from a previous namespace leaking into the new one
5. How to lay groundwork for future multi-namespace reads

## Decision

### Global Header Injection (not per-request)

Namespace context is injected globally into all API requests via the `api-client.ts` module. A module-level resolver function (`getActiveNamespaces`) is registered by the `NamespaceProvider` React context. The `buildHeaders()` function in the API client calls this resolver on every request.

**Rationale:** Avoids threading namespace parameters through every query hook and mutation. The resolver pattern decouples the API client from React context (no circular dependency).

### Header Strategy: X-Namespace and X-Namespaces

The API client sends headers based on the active selection:

- **Single namespace selected:** `X-Namespace: my-workspace` header.
- **Multiple namespaces selected:** `X-Namespaces: ws-a,ws-b` header (comma-separated).

**Current backend behavior (important):**

- **User tokens:** The backend uses `extractRequestedNamespace()` (singular) for user tokens. It resolves to one `storeNamespace` and one `queryNamespace`. Multi-namespace via `X-Namespaces` is **not honored for user tokens today**.
- **M2M tokens:** The backend calls `extractRequestedNamespaces()` (plural) and supports multi-namespace queries. This is an M2M-only feature (Issue #1534).
- **No header sent:** For user tokens without a namespace header, the backend uses the home grant as `storeNamespace` and returns data from **all** granted namespaces in `queryNamespaces`.

The frontend context supports multi-namespace selection (`activeNamespaces` array, `toggleNamespace`) to prepare for future backend support, but the backend does not currently act on `X-Namespaces` for user tokens. The header is sent optimistically.

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

1. All inflight TanStack Query requests are cancelled via `queryClient.cancelQueries()`.
2. The entire query cache is reset via `queryClient.resetQueries()`.
3. New requests use the updated namespace headers from the resolver.

On 401 retry (token refresh), namespace headers are kept from the original request snapshot to prevent a mid-flight namespace change from mixing data.

The context also exposes a `namespaceVersion` counter that increments on each switch. This is available for components that may need to detect namespace transitions, though it is not currently consumed outside the context itself.

## Consequences

### Positive

- Zero changes needed to individual query/mutation hooks — header injection is automatic.
- Cache segmentation prevents cross-namespace data leaks without manual cache key management.
- Frontend context is pre-built for multi-namespace support when the backend adds it for user tokens.
- Backward compatible with existing M2M and single-namespace flows.

### Negative

- Full cache reset on namespace switch means brief loading states. Acceptable tradeoff for data correctness.
- Module-level resolver pattern is harder to test than explicit parameter passing. Mitigated by `setNamespaceResolver()` being callable in test setup.
- localStorage persistence means shared browser profiles could have namespace selection conflicts. Acceptable for current user base.
- The frontend sends `X-Namespaces` for user tokens but the backend ignores it. This is intentional forward-compatibility, not a bug.

## Implementation Notes

- `NamespaceProvider` wraps the app at the root level (inside `QueryClientProvider`).
- The namespace resolver is set via `setNamespaceResolver()` in an effect, cleaned up on unmount.
- Backend validation: namespace names must match `^[a-z0-9][a-z0-9._-]*$`, max 63 chars. Invalid names are silently filtered (not rejected with 400). Max 20 namespaces per multi-namespace request.
- Single-namespace users see a subtle passive indicator (not a dropdown).
- Multi-namespace users see an interactive dropdown in the header bar.
- The `NamespaceIndicator` component renders in both modes: passive label for single-namespace, dropdown for multi-namespace.
