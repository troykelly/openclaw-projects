# Namespace Selection Test Report (#2358)

## Test Suite Summary

Full test suite run on 2026-03-10 after all namespace PRs merged to main:
- **687 test files, 12322 tests, 0 failures**

## Namespace-Specific Test Coverage

### Frontend Unit Tests

| Test File | Issue | Tests | Status |
|-----------|-------|-------|--------|
| `tests/ui/api-client-namespace-headers.test.ts` | #2349 | X-Namespace single/multi header injection, 401 retry snapshot | PASS |
| `tests/ui/namespace-context-multi.test.tsx` | #2351 | Multi-select state, toggleNamespace, localStorage persistence/migration, race prevention | PASS |
| `tests/ui/use-namespace-query-key.test.tsx` | #2350 | Query key namespacing, key updates on switch, multi-namespace keys, stable references | PASS |
| `tests/ui/namespace-mutation-keys.test.ts` | #2363 | Predicate-based invalidation matching namespace-prefixed keys | PASS |
| `tests/ui/namespace-components.test.tsx` | #1482 | NamespaceBadge, NamespaceIndicator, NamespacePicker rendering and visibility logic | PASS |
| `tests/ui/namespace-enhanced-components.test.tsx` | #2352, #2355, #2357 | Enhanced badge/indicator, multi-namespace mode, NAMESPACE_STRINGS constants | PASS |
| `tests/ui/namespace-settings-page.test.tsx` | #2353 | Settings list/detail, create/invite/remove dialogs, validation, loading/error states | PASS |
| `tests/ui/mutation-hooks.test.ts` | #2363 | Mutation hooks use predicate-based invalidation (updated from bare key arrays) | PASS |

### Backend Integration Tests

| Test File | Issue | Tests | Status |
|-----------|-------|-------|--------|
| `tests/namespace_middleware.test.ts` | #1475 | User token resolution, M2M token resolution, X-Namespace header, query param, edge cases | PASS |
| `src/api/auth/middleware-user-namespace.test.ts` | #2359 | User token multi-namespace, active_namespaces persistence, PATCH validation | PASS |
| `tests/docker/traefik-entrypoint.test.ts` | #2369 | CORS allows X-Namespace, X-Namespaces headers | PASS |
| `tests/webhook_namespace_auth.test.ts` | - | Webhook namespace auth context | PASS |

## Peer Review Findings

### Security Checklist

| Check | Result | Notes |
|-------|--------|-------|
| No XSS vectors in namespace name rendering | PASS | React auto-escapes text content; no unsafe HTML injection patterns used |
| No header injection via namespace names | PASS | Server-side `validateNamespaceList` enforces `^[a-z0-9][a-z0-9._-]*$` pattern, 63-char max |
| No cache poisoning across namespaces | PASS | Query keys include `{ namespaces: [...] }` prefix for cache isolation |
| No data leaks between namespaces | PASS | `resolveNamespaces` validates requested namespaces against user grants; invalid returns null |
| No race conditions during namespace switch | PASS | `cancelQueries` + `resetQueries` on switch; header snapshot on 401 retry |
| No stale data displayed after switch | PASS | Query reset forces refetch with new namespace headers |
| Error handling for all API failures | PASS | Settings page shows error state; API client retries with snapshot |
| Loading states for all async operations | PASS | Settings page loading indicator |
| Keyboard accessibility | PASS | Uses Radix UI Select (keyboard accessible by default) |
| Screen reader support | PASS | `aria-label` on badges, combobox, indicators via `NAMESPACE_STRINGS` |

### Notes on Checklist Items Not Applicable

- **`PATCH /users/:email` with `active_namespaces`**: The backend exposes `PATCH /users/:email` which accepts `active_namespaces` with validation (array type, non-empty, max 20, pattern check, grant verification). This endpoint is tested in `src/api/auth/middleware-user-namespace.test.ts`. The original #2358 checklist referred to `PATCH /settings` which does not exist -- the actual endpoint is on the users route.
- **`NamespaceTransitionOverlay`**: Multi-namespace toggle mode is not currently wired in the UI. The `toggleNamespace` function exists but has no call sites. Overlay component is not implemented.
- **Standalone dialog tests**: `NamespaceCreateDialog` and `NamespaceInviteDialog` are tested as part of `namespace-settings-page.test.tsx` (tests 5-7), not as isolated components.

## E2E Test Plan

These scenarios document expected user flows. They can be automated when E2E test infrastructure (e.g., Playwright) is added to the project.

### Scenario 1: Single Namespace User
1. User with one namespace grant logs in
2. Verify: No namespace selector dropdown in header
3. Verify: Passive namespace label shows in header
4. Verify: No NamespaceBadge on list items
5. Verify: Data loads correctly for the single namespace

### Scenario 2: Switch Namespace
1. User with multiple grants logs in (home namespace active)
2. Verify: Dropdown selector shows in header
3. Select a different namespace from dropdown
4. Verify: Data refreshes with correct namespace
5. Verify: API calls include `X-Namespace: <selected>` header
6. Verify: No stale data from previous namespace visible

### Scenario 3: Page Refresh Persistence
1. Switch to a non-home namespace
2. Refresh the page
3. Verify: Same namespace is still active (localStorage persistence)
4. Verify: Data loads for the persisted namespace

### Scenario 4: Create Namespace
1. Navigate to Settings > Namespaces
2. Click "Create Namespace"
3. Enter invalid name (uppercase) -- verify validation error
4. Enter valid name -- verify no error
5. Submit -- verify POST /namespaces called
6. Verify: New namespace appears in list

### Scenario 5: Invite Member
1. Navigate to Settings > Namespaces > [namespace detail]
2. Click "Invite Member"
3. Enter email address
4. Submit -- verify POST /namespaces/:ns/grants called
5. Verify: New member appears in member list

### Scenario 6: Remove Member
1. Navigate to namespace detail view
2. Click remove button on a member
3. Verify: Confirmation dialog appears
4. Confirm removal -- verify DELETE /namespaces/:ns/grants/:id called

### Scenario 7: Namespace Revoked
1. User has namespace "team-a" active
2. Admin revokes user's grant to "team-a"
3. On next API call, backend sanitizes `active_namespaces` against current grants
4. Verify: User falls back to home namespace

### Scenario 8: Multi-Namespace Badge Display
1. User with multiple grants views entity list
2. Verify: NamespaceBadge visible on items showing source namespace
3. Verify: Badge includes correct `aria-label`
