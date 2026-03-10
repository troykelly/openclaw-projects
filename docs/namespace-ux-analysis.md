# Namespace Selection UX Analysis

**Issue:** #2347
**Epic:** #2345 — User Namespace Selection in UI
**Date:** 2026-03-10

## Overview

This document analyses all user-facing namespace selection flows and provides
ASCII wireframes for each interaction pattern. It gates UI implementation
work for the namespace epic.

---

## 1. Single Namespace User

Users with a single namespace grant see no selector. The UI is streamlined
and namespace badges are hidden.

```
+--------------------------------------------------+
| Logo   Dashboard  Projects  Notes     [user]     |
|                                                   |
| Welcome back                                      |
| +-----------+ +-----------+ +-----------+        |
| | 3 tasks   | | 2 notes   | | 1 contact |        |
| | due today | | updated   | | added     |        |
| +-----------+ +-----------+ +-----------+        |
|                                                   |
| Recent Work Items                                 |
| +-----------------------------------------------+|
| | Fix login bug           in_progress            ||
| | Update docs             todo                   ||
| | Deploy v2               done                   ||
| +-----------------------------------------------+|
+--------------------------------------------------+
```

**Behaviour:**
- `NamespaceIndicator` in header: shows subtle text label (non-interactive)
- `NamespaceBadge` on entities: hidden (returns null)
- `NamespacePicker` in create forms: hidden (returns null)
- No namespace column in list views

---

## 2. Multi-Namespace User — Single Active

Users with multiple namespace grants see a namespace selector in the header
and sidebar. Only one namespace is active at a time.

### Header Indicator (single-select mode)

```
+--------------------------------------------------+
| Logo   Dashboard  Projects  Notes  [personal v]  |
|                                      ^dropdown    |
+--------------------------------------------------+
```

Clicking the dropdown:

```
+--------------------------------------------------+
| Logo   Dashboard  Projects  Notes  [personal v]  |
|                                    +-------------+|
|                                    | personal  * ||
|                                    | team-alpha   ||
|                                    | shared       ||
|                                    +-------------+|
+--------------------------------------------------+
```

`*` = currently active (home namespace)

### Sidebar Selector

```
+------------------+
| Namespace        |
| [personal    v]  |
|------------------|
| Dashboard        |
| Projects         |
| Work Items       |
| Notes            |
| Contacts         |
| ...              |
+------------------+
```

### Entity List with Badges

When user has multiple namespaces, entities show which namespace they
belong to even in single-active mode:

```
+-----------------------------------------------+
| Projects                          [+ New]      |
|-----------------------------------------------|
| Home Renovation    [personal]     3 tasks      |
| API Redesign       [team-alpha]   12 tasks     |
| Shopping Lists     [personal]     2 tasks      |
+-----------------------------------------------+
```

**Behaviour:**
- Switching namespace: loading overlay, query cache reset, refetch
- `NamespaceBadge` shown on all entities when `hasMultipleNamespaces`
- Create forms default to active namespace but allow override via `NamespacePicker`

---

## 3. Multi-Namespace User — Multi Active (Stretch)

Users can select multiple namespaces simultaneously for combined read views.
Write operations always target the primary namespace (first in list).

### Multi-Select in Header

```
+--------------------------------------------------+
| Logo   Dashboard  Projects  Notes  [2 namespaces]|
|                                    +-------------+|
|                                    | [x] personal ||
|                                    | [x] team-a   ||
|                                    | [ ] shared   ||
|                                    +-------------+|
+--------------------------------------------------+
```

### Multi-Select in Sidebar

```
+------------------+
| Namespaces       |
| [x] personal (P) |
| [x] team-alpha    |
| [ ] shared        |
|------------------|
| (P) = primary    |
| (write target)   |
+------------------+
```

### Combined Entity List

```
+-----------------------------------------------+
| Projects                          [+ New]      |
|-----------------------------------------------|
| Home Renovation    [personal]     3 tasks      |
| API Redesign       [team-alpha]   12 tasks     |
| Sprint Planning    [team-alpha]   5 tasks      |
| Shopping Lists     [personal]     2 tasks      |
+-----------------------------------------------+
```

**Behaviour:**
- `NamespaceBadge` always visible in multi-namespace mode
- Primary namespace marked with star/pin icon
- Cannot uncheck primary namespace (must select another primary first)
- Count badge shows "N namespaces" when multiple active
- Create forms default to primary namespace

---

## 4. Namespace Switching

### Loading Transition

When switching namespace(s):

```
+--------------------------------------------------+
| Logo   Dashboard  Projects  Notes  [team-alpha v]|
|                                                   |
| +-----------------------------------------------+|
| |                                                ||
| |           Switching to team-alpha...           ||
| |           [=====>             ]                ||
| |                                                ||
| +-----------------------------------------------+|
+--------------------------------------------------+
```

**Sequence:**
1. User selects new namespace
2. `NamespaceContext.setActiveNamespace()` fires
3. `namespaceVersion` increments
4. All in-flight queries cancelled (`queryClient.cancelQueries()`)
5. Query cache reset (`queryClient.resetQueries()`)
6. API client header resolver updated
7. New queries refetch with updated `X-Namespace` header
8. Loading overlay dismisses when `useIsFetching() === 0`

### Stale Data Prevention

- `namespaceVersion` counter prevents race conditions
- Queries use namespace-aware keys: `[{ namespaces: ['ns1'] }, 'projects', ...]`
- Old namespace data never overwrites new namespace data

---

## 5. First-Time Multi-Namespace User

When a user gains their second namespace grant (e.g., invited to a team
namespace), the UI adapts on next load:

### Before (Single)

```
+--------------------------------------------------+
| Logo   Dashboard  Projects  Notes      [user]    |
|                                    no selector    |
+--------------------------------------------------+
```

### After (Multi - appears on bootstrap reload)

```
+--------------------------------------------------+
| Logo   Dashboard  Projects  Notes  [personal v]  |
|                                    ^new selector  |
+--------------------------------------------------+
```

**Behaviour:**
- Bootstrap data includes updated `namespace_grants`
- `NamespaceProvider` detects `grants.length > 1`
- `hasMultipleNamespaces` flips to `true`
- All namespace components become visible
- No toast/notification needed -- UI adapts naturally
- Existing selection preserved (home namespace remains active)

---

## 6. Create Entity in Non-Active Namespace

When creating an entity, users can override the target namespace:

```
+-----------------------------------------------+
| Create Work Item                         [X]   |
|-----------------------------------------------|
|                                                |
| Title: [________________________]              |
|                                                |
| Namespace: [personal      v]                   |
|            +------------------+                |
|            | personal       * |                |
|            | team-alpha       |                |
|            | shared           |                |
|            +------------------+                |
|                                                |
| Kind: [task v]   Priority: [medium v]          |
|                                                |
| Description:                                   |
| [__________________________________________]   |
|                                                |
|              [Cancel]  [Create]                |
+-----------------------------------------------+
```

**Behaviour:**
- `NamespacePicker` defaults to `activeNamespace`
- Only visible when `hasMultipleNamespaces`
- After creation, entity appears in the target namespace's list
- If target != active, a toast may inform user: "Created in team-alpha"

---

## 7. Namespace Management (Settings)

A settings page for viewing and managing namespace access:

```
+-----------------------------------------------+
| Settings > Namespaces                          |
|-----------------------------------------------|
|                                                |
| Your Namespaces                                |
| +---------------------------------------------+
| | Namespace    | Access     | Home | Actions  |
| |--------------|------------|------|----------|
| | personal     | read/write | [*]  |          |
| | team-alpha   | read/write | [ ]  | [Leave]  |
| | shared       | read-only  | [ ]  | [Leave]  |
| +---------------------------------------------+
|                                                |
| [+ Create Namespace]                           |
|                                                |
+-----------------------------------------------+
```

**Note:** Namespace management settings page is tracked in Issue #2353
(separate PR). This section documents the UX flow for reference.

---

## Component Inventory

### Existing (to update)

| Component | File | Update |
|-----------|------|--------|
| `NamespaceIndicator` | `namespace-indicator.tsx` | Add multi-select mode, count badge |
| `NamespaceBadge` | `namespace-badge.tsx` | Show in `isMultiNamespaceMode` |
| `NamespacePicker` | `namespace-picker.tsx` | No change (write = single target) |

### New

| Component | Purpose |
|-----------|---------|
| `NamespaceSelector` | Unified selector for sidebar/header (single + multi) |
| `NamespaceTransitionOverlay` | Loading overlay during namespace switch |

---

## Interaction Patterns

### Hover States
- Namespace badges: show tooltip with namespace description (future)
- Selector items: highlight background on hover
- Count badge: show tooltip listing active namespaces

### Loading States
- Namespace switch: content area shows skeleton/fade overlay
- Initial load: NamespaceProvider reads synchronously from bootstrap (no loading)

### Error States
- Grant revoked while active: redirect to remaining namespace, show toast
- All grants revoked: show "No namespace access" error page
- API error during switch: keep previous namespace active, show error toast

---

## Accessibility

### Keyboard Navigation
- `NamespaceIndicator` dropdown: standard Select keyboard nav (Arrow keys, Enter, Escape)
- Multi-select mode: Space to toggle checkbox, Tab between items
- `NamespaceBadge`: decorative element, no focus target

### Screen Reader Labels
- `NamespaceIndicator`: `aria-label="Switch namespace"`
- Multi-select: `aria-label="Select active namespaces"`
- `NamespaceBadge`: text content readable as "Namespace: {name}"
- Count badge: `aria-label="N namespaces selected"`

### Focus Management
- After namespace switch: focus returns to trigger element
- After create in non-active namespace: focus on created entity or toast

---

## Edge Cases

1. **0 grants**: Show error page "No namespace access. Contact your administrator."
2. **Grant revoked while active**: Auto-switch to another grant. If none remain, error page.
3. **Namespace deleted server-side**: Next API call returns 403. Clear from grants, switch.
4. **localStorage has stale namespace**: Validated against grants on load. Falls back to home.
5. **Multiple tabs**: Each tab can have different active namespace. localStorage sync via `storage` event (future enhancement).
6. **Slow network on switch**: Transition overlay stays visible until queries settle. Timeout after 10s with error message.
7. **Primary namespace unchecked in multi-mode**: Rejected -- must select new primary first.
