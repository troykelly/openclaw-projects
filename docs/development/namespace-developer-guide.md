# Namespace Selection Developer Guide

This guide covers the namespace selection system added in Epic #2345 for developers working on the openclaw-projects codebase.

## Architecture Overview

Namespace context flows through the system in this order:

```
UI (NamespaceProvider)
  -> api-client (header injection via resolver)
    -> HTTP header (X-Namespace)
      -> Backend middleware (resolveNamespaces)
        -> SQL queries (namespace filtering)
```

## Frontend Components

### NamespaceProvider (`src/ui/contexts/namespace-context.tsx`)

Root-level React context provider that manages namespace state. Must wrap the entire app inside `QueryClientProvider`.

**Exports:**

| Export | Type | Description |
|--------|------|-------------|
| `NamespaceProvider` | Component | Root context provider |
| `useNamespace()` | Hook | Full namespace context (throws if outside provider) |
| `useNamespaceSafe()` | Hook | Full context or null (safe for test environments) |
| `useActiveNamespace()` | Hook | Just the primary namespace string (returns `'default'` outside provider) |
| `useActiveNamespaces()` | Hook | All selected namespace strings (returns `['default']` outside provider) |

**Context value shape (`NamespaceContextValue`):**

| Field | Type | Description |
|-------|------|-------------|
| `grants` | `NamespaceGrant[]` | All grants for the current user |
| `activeNamespace` | `string` | Primary namespace (first of `activeNamespaces`) |
| `setActiveNamespace` | `(ns: string) => void` | Switch to a single namespace |
| `activeNamespaces` | `string[]` | All selected namespaces |
| `setActiveNamespaces` | `(ns: string[]) => void` | Set multiple active namespaces |
| `toggleNamespace` | `(ns: string) => void` | Toggle a namespace in/out of the active set |
| `hasMultipleNamespaces` | `boolean` | Whether user has >1 grant |
| `isMultiNamespaceMode` | `boolean` | Whether >1 namespace is currently selected |
| `isNamespaceReady` | `boolean` | Whether context is initialized |
| `namespaceVersion` | `number` | Monotonic counter, increments on switch |

**Note on multi-namespace:** The context supports multi-namespace selection (`activeNamespaces`, `toggleNamespace`, `isMultiNamespaceMode`), and the backend honors `X-Namespaces` for both user and M2M tokens (Issue #2359). However, the UI does not currently expose a multi-namespace toggle -- `toggleNamespace` has no call sites. The `PATCH /users/:email` endpoint accepts `active_namespaces` to persist the selection server-side.

### useNamespaceQueryKey (`src/ui/hooks/use-namespace-query-key.ts`)

Generates namespace-aware TanStack Query keys by prepending a namespace descriptor. **Every query hook should use this** to ensure cache segmentation.

```ts
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';

export function useProjects() {
  const queryKey = useNamespaceQueryKey(['projects', 'list']);
  // queryKey = [{ namespaces: ['troy'] }, 'projects', 'list']
  return useQuery({ queryKey, queryFn: ... });
}
```

### UI Components

| Component | File | Behavior |
|-----------|------|----------|
| `NamespaceIndicator` | `src/ui/components/namespace/namespace-indicator.tsx` | Header bar: **passive label** for single-namespace users, **interactive dropdown** for multi-namespace users. Always renders (shows namespace name). |
| `NamespaceBadge` | `src/ui/components/namespace/namespace-badge.tsx` | Small badge showing namespace name. **Hidden** when user has only one namespace. |
| `NamespacePicker` | `src/ui/components/namespace/namespace-picker.tsx` | Dropdown for creation forms. **Hidden** when user has only one namespace. |
| `NamespaceSettingsPage` | `src/ui/pages/NamespaceSettingsPage.tsx` | Settings page at `/settings/namespaces` -- list, detail, create, invite, remove. |

## Backend: Namespace Resolution

### middleware.ts (`src/api/auth/middleware.ts`)

The `resolveNamespaces()` function resolves a `NamespaceContext` for each request:

```ts
interface NamespaceContext {
  storeNamespace: string;      // For write operations
  queryNamespaces: string[];   // For read operations
  isM2M: boolean;              // Whether token is machine-to-machine
  roles: Record<string, NamespaceAccess>; // namespace -> 'read' | 'readwrite'
}
```

**Resolution logic by token type:**

| Token Type | Namespace Header Used | Store Namespace | Query Namespaces | Grant Check |
|------------|----------------------|----------------|-----------------|-------------|
| User (with X-Namespaces) | `extractRequestedNamespaces` (plural) | First valid | All valid (grant-checked) | Yes -- each validated |
| User (with X-Namespace) | `extractRequestedNamespace` (singular) | Requested | `[requested]` | Yes -- must have grant |
| User (no header) | N/A | From `active_namespaces` pref or home | From `active_namespaces` pref or `[home]` | Yes |
| M2M (with X-Namespaces) | `extractRequestedNamespaces` (plural) | First requested | All requested | No -- trusted |
| M2M (with X-Namespace) | `extractRequestedNamespace` (singular) | Requested | `[requested]` | No -- trusted |
| M2M (no header) | N/A | `'default'` | `['default']` | No |
| Auth disabled (with header) | `extractRequestedNamespace` (singular) | Requested | `[requested]` | No |
| Auth disabled (no header) | N/A | Returns `null` | N/A | No |

Both user and M2M tokens support multi-namespace queries via `X-Namespaces` (Issue #2359). The difference is that user tokens validate each namespace against grants and filter out unauthorized ones, while M2M tokens accept all requested namespaces without grant checks.

### Header Extraction Priority

For singular extraction (`extractRequestedNamespace`):
1. `X-Namespace` header
2. `?namespace=` query param
3. `body.namespace` string

For plural extraction (`extractRequestedNamespaces`, user and M2M tokens):
1. `X-Namespaces` header (comma-separated)
2. `X-Namespace` header (single)
3. `?namespaces=` query param (comma-separated)
4. `?namespace=` query param (single)
5. `body.namespaces` array
6. `body.namespace` string

### Namespace Validation

All namespace names are validated by `validateNamespaceList()`:

- Pattern: `^[a-z0-9][a-z0-9._-]*$`
- Max length: 63 characters per name
- Max namespaces per request: 20
- **Invalid names are silently filtered** (not rejected with 400)
- Duplicate names are **not** deduplicated

### Access Enforcement

Use `requireMinRole()` to enforce access levels in route handlers:

```ts
import { requireMinRole } from './auth/middleware.ts';

// In a route handler:
requireMinRole(req, namespace, 'readwrite'); // Throws RoleError if insufficient
```

- M2M tokens bypass all role checks.
- `'readwrite'` satisfies any requirement; `'read'` only satisfies `'read'`.
- No grant for the namespace = `RoleError`.

## API Client: Header Injection

The API client (`src/ui/lib/api-client.ts`) uses a module-level resolver pattern to inject namespace headers without creating circular dependencies with React context:

```ts
// Set by NamespaceProvider on mount:
setNamespaceResolver(() => activeNamespaces);

// Called on every request by buildHeaders():
const namespaces = getActiveNamespaces();
if (namespaces.length === 1) {
  headers['x-namespace'] = namespaces[0];
} else if (namespaces.length > 1) {
  headers['x-namespaces'] = namespaces.join(',');
}
```

On 401 retry (token refresh), namespace headers are preserved from the original request snapshot to prevent race conditions.

**Note:** The client sends `x-namespaces` when multiple are selected, and the backend honors this for both user tokens (grant-validated) and M2M tokens (trusted).

## OpenAPI Specification

Namespace-related endpoints are documented in:

- `src/api/openapi/paths/namespaces.ts` -- CRUD for namespaces and grants
- `src/api/openapi/paths/bootstrap.ts` -- Settings endpoints, bootstrap context
- `src/api/openapi/helpers.ts` -- `namespaceParam()` and `namespacesParam()` header helpers

The `namespaceParam()` helper should be included in any endpoint that accepts namespace-scoped requests.

## Adding a New Namespace-Aware Query

1. Import `useNamespaceQueryKey` in your query hook.
2. Wrap your base key with it.
3. That's it -- header injection is automatic.

```ts
import { useQuery } from '@tanstack/react-query';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';
import { apiClient } from '@/ui/lib/api-client';

export function useMyFeature() {
  const queryKey = useNamespaceQueryKey(['my-feature', 'list']);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get('/my-feature', { signal }),
  });
}
```

## Testing Considerations

- `useNamespaceQueryKey` has a safe fallback that returns `['default']` when called outside React context.
- `useNamespaceSafe()` returns `null` outside `NamespaceProvider` (no throw).
- `setNamespaceResolver()` can be called in test setup to control namespace headers.
- Backend: when `isAuthDisabled()` is true, namespace context is only created when explicitly requested via the singular `X-Namespace` header or `?namespace=` param. Plural `X-Namespaces` is not honored in auth-disabled mode.
- When no namespace header is sent for a user token, the backend uses the persisted `active_namespaces` preference from `user_setting`, falling back to the home namespace. The preference is sanitized against current grants on every request.
