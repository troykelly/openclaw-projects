# Namespace Frontend Developer Guide

This guide covers the frontend architecture for namespace support, including context providers, hooks, components, and patterns.

## Architecture Overview

```
NamespaceProvider (context)
  |
  +-- NamespaceSelector (header component, PR 3)
  |
  +-- NamespaceTransitionOverlay (race prevention)
  |
  +-- apiClient (header injection via callback)
  |
  +-- useNamespaceQueryKey() (query key segmentation)
       |
       +-- All TanStack Query hooks (automatic cache separation)
```

## Context: NamespaceProvider

**File:** `src/ui/contexts/namespace-context.tsx`

The `NamespaceProvider` wraps the entire app and manages namespace state.

### Hooks

#### `useNamespace(): NamespaceContextValue`

Full context value. Use when you need access to all namespace state and actions.

```typescript
interface NamespaceContextValue {
  grants: NamespaceGrant[];          // All namespace grants for current user
  activeNamespace: string;            // Primary namespace for writes
  activeNamespaces: string[];         // All selected namespaces for reads
  hasMultipleNamespaces: boolean;     // User belongs to 2+ namespaces
  isMultiNamespaceMode: boolean;      // Multi-namespace selection active
  isNamespaceReady: boolean;          // Context has loaded grants
  namespaceVersion: number;           // Increments on namespace change
  setActiveNamespace: (ns: string) => void;
  setActiveNamespaces: (ns: string[]) => void;
  toggleNamespace: (ns: string) => void;
}
```

#### `useNamespaceSafe(): NamespaceContextValue | null`

Returns `null` if used outside a `NamespaceProvider`. Use in components that may render before the provider mounts (e.g., error boundaries).

#### `useActiveNamespace(): string`

Returns just the primary active namespace. Convenience hook for components that only need the current namespace name.

#### `useActiveNamespaces(): string[]`

Returns the array of all active namespaces. Use for read operations that support multi-namespace mode.

## Query Key Segmentation

**File:** `src/ui/hooks/use-namespace-query-key.ts`

#### `useNamespaceQueryKey<T>(baseKey: T): [{ namespaces: string[] }, ...T]`

Wraps any TanStack Query key with the current namespace selection. This ensures cached data is automatically separated by namespace.

```typescript
// Without namespace segmentation (WRONG - data leaks between namespaces):
const queryKey = ['work-items', 'list'];

// With namespace segmentation (CORRECT):
const queryKey = useNamespaceQueryKey(['work-items', 'list']);
// Result: [{ namespaces: ['acme'] }, 'work-items', 'list']
```

**Usage pattern for custom query hooks:**

```typescript
import { useQuery } from '@tanstack/react-query';
import { useNamespaceQueryKey } from '@/ui/hooks/use-namespace-query-key';
import { apiClient } from '@/ui/lib/api-client';

export function useMyData() {
  const queryKey = useNamespaceQueryKey(['my-data', 'list']);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiClient.get('/my-data', { signal }),
  });
}
```

## API Client Header Injection

**File:** `src/ui/lib/api-client.ts`

The API client automatically injects namespace headers on every request. No manual configuration is needed in individual hooks.

Headers injected:
- `x-namespace`: Primary active namespace (string)
- `x-namespace-multi`: All active namespaces (comma-separated string)

The injection is set up by `NamespaceProvider` registering a callback when it mounts.

## Namespace Management Hooks

### Query Hooks

**File:** `src/ui/hooks/queries/use-namespaces.ts`

```typescript
// List all namespaces the user has access to
useNamespaceList(): UseQueryResult<NamespaceListItem[]>

// Get namespace detail with members
useNamespaceDetail(ns: string): UseQueryResult<NamespaceDetail>
```

### Mutation Hooks

**File:** `src/ui/hooks/mutations/use-namespace-mutations.ts`

```typescript
// Create a new namespace
useCreateNamespace(): UseMutationResult

// Invite a member (upsert grant)
useInviteMember(): UseMutationResult

// Update a grant's access level
useUpdateGrant(): UseMutationResult

// Remove a grant (revoke access)
useRemoveGrant(): UseMutationResult
```

All mutation hooks automatically invalidate relevant query caches on success.

## UI Components

### NamespacePicker

**File:** `src/ui/components/namespace/namespace-picker.tsx`

A select-based picker for choosing a namespace. Used in forms where the user needs to target a specific namespace.

```tsx
<NamespacePicker
  value={selectedNs}
  onValueChange={setSelectedNs}
  label="Target Namespace"
/>
```

### NamespaceBadge

**File:** `src/ui/components/namespace/namespace-badge.tsx`

Displays a namespace name as a styled badge. Used in data views to show which namespace an item belongs to.

```tsx
<NamespaceBadge namespace="acme" />
```

### NamespaceIndicator

**File:** `src/ui/components/namespace/namespace-indicator.tsx`

Shows the current active namespace in compact form. Used in the header/toolbar area.

```tsx
<NamespaceIndicator />
```

### NamespaceSettingsPage

**File:** `src/ui/pages/NamespaceSettingsPage.tsx`

Full namespace management page at `/app/settings/namespaces`. Handles:
- Namespace list view
- Namespace detail view with member table
- Create, invite, update access, and remove dialogs

Routed via `src/ui/routes.tsx` at paths:
- `/settings/namespaces` (list view)
- `/settings/namespaces/:ns` (detail view)

## Known Limitations

1. **Mutation invalidation mismatch (#2363):** Mutation hooks invalidate bare keys like `['namespaces']` which do not match namespaced query keys `[{ namespaces: [...] }, 'namespaces', ...]`. This means cache invalidation after mutations may not work correctly in all cases. Tracked in issue #2363.

2. **No admin role distinction:** The current access model has only `read` and `readwrite` levels. There is no separate "admin" role — any user with `readwrite` can manage grants. A role-based model may be added later.
