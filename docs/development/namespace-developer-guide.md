# Namespace Selection Developer Guide

This guide covers the namespace selection system added in Epic #2345 for developers working on the openclaw-projects codebase.

## Architecture Overview

Namespace context flows through the system in this order:

```
UI (NamespaceProvider)
  → api-client (header injection via resolver)
    → HTTP headers (X-Namespace / X-Namespaces)
      → Backend middleware (resolveNamespaces)
        → SQL queries (namespace filtering)
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
| `useActiveNamespace()` | Hook | Just the primary namespace string |
| `useActiveNamespaces()` | Hook | All selected namespace strings |

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

| Component | File | Purpose |
|-----------|------|---------|
| `NamespaceIndicator` | `src/ui/components/namespace/namespace-indicator.tsx` | Header bar indicator/dropdown for switching namespaces |
| `NamespaceBadge` | `src/ui/components/namespace/namespace-badge.tsx` | Small badge showing which namespace an entity belongs to |
| `NamespacePicker` | `src/ui/components/namespace/namespace-picker.tsx` | Dropdown for selecting target namespace in creation forms |
| `NamespaceSettingsPage` | `src/ui/pages/NamespaceSettingsPage.tsx` | Settings page for namespace management (create, invite, remove) |

All components use `useNamespaceSafe()` and render nothing when the user has only one namespace (single-namespace optimization).

## Backend: Namespace Resolution

### middleware.ts (`src/api/auth/middleware.ts`)

The `resolveNamespaces()` function resolves a `NamespaceContext` for each request:

```ts
interface NamespaceContext {
  storeNamespace: string;      // For write operations
  queryNamespaces: string[];   // For read operations
  isM2M: boolean;              // Whether token is machine-to-machine
  roles: Record<string, NamespaceAccess>; // namespace → 'read' | 'readwrite'
}
```

**Resolution logic by token type:**

| Token Type | Store Namespace | Query Namespaces | Grant Check |
|------------|----------------|-----------------|-------------|
| User | Requested or home | Requested or all grants | Yes — verified against `namespace_grant` |
| M2M | First requested or 'default' | All requested | No — trusted |
| Auth disabled | Requested | Requested | No |

### Header Extraction Priority

`extractRequestedNamespaces()` checks in this order:

1. `X-Namespaces` header (comma-separated) — multi-namespace queries
2. `X-Namespace` header (single)
3. `?namespaces=` query param (comma-separated)
4. `?namespace=` query param (single)
5. `body.namespaces` array
6. `body.namespace` string

### Namespace Validation

All namespace names are validated against:

- Pattern: `^[a-z0-9][a-z0-9._-]*$`
- Max length: 63 characters
- Max namespaces per request: 20

### Access Enforcement

Use `requireMinRole()` to enforce access levels in route handlers:

```ts
import { requireMinRole } from './auth/middleware.ts';

// In a route handler:
requireMinRole(req, namespace, 'readwrite'); // Throws RoleError if insufficient
```

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

## OpenAPI Specification

Namespace-related endpoints are documented in:

- `src/api/openapi/paths/namespaces.ts` — CRUD for namespaces and grants
- `src/api/openapi/paths/bootstrap.ts` — Settings endpoints, bootstrap context
- `src/api/openapi/helpers.ts` — `namespaceParam()` helper for X-Namespace header docs

The `namespaceParam()` helper should be included in any endpoint that accepts namespace-scoped requests.

## Adding a New Namespace-Aware Query

1. Import `useNamespaceQueryKey` in your query hook.
2. Wrap your base key with it.
3. That's it — header injection is automatic.

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
- Backend: when `isAuthDisabled()` is true, namespace context is only created when explicitly requested via headers/params. This preserves test isolation.
