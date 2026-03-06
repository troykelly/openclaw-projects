# Omnibus PR: HA Integration Fixes + Dev Session Plugin Tools

**Date:** 2026-02-27
**Issues:** #1895, #1896 + 16 additional HA bugs found during deep review
**PR Strategy:** Single omnibus PR, agent team for parallel work

---

## Problem Statement

The Home Assistant geolocation integration has accumulated bugs across multiple incremental PRs. A deep review (Claude Code + Codex CLI) found 18 issues ranging from critical data-loss bugs to code quality improvements. Additionally, dev session plugin tools (#1896) need to be exposed.

---

## Issues to Fix

### Critical (production broken)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| C1 | `auto-inject.ts:42` | Wrong column: `user_email` → should be `email` | Fix column name in query |
| C2 | `server.ts:19463,19821` | `FOR UPDATE` with `COUNT(*)` (PG error) | Remove `FOR UPDATE` from count queries; use advisory lock or constraint |
| C3 | `run.ts:64-68` | `GeoIngestorProcessor` callback only logs; `ingestLocationUpdate()` never called | Wire the ingestion pipeline: pass pool to processor, call `ingestLocationUpdate()` |
| C4 | `service.ts:407-420` | `getCurrentLocation()` missing `gl.user_email` filter — cross-user leak on shared providers | Add `gl.user_email = $1` to WHERE clause |

### High (functionality broken under conditions)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| H1 | `home-assistant.ts:460` | Reconnect gated on `ctx.attempt > 0`; initial close never reconnects | Remove the `ctx.attempt > 0` gate; always reconnect unless disconnecting |
| H2 | `lifecycle.ts:112-129` | `reconcile()` only adds/removes, ignores config/credential changes | Diff config/credentials/status for existing providers; reconnect if changed |
| H3 | `run.ts:90` | `ha_service_call` NOTIFY not routed to `ServiceCallHandler` | Wire ServiceCallHandler; differentiate channels in onNotification |
| H4 | `home-assistant.ts:576` | OAuth refresh uses HA origin as clientId instead of PUBLIC_BASE_URL | Use PUBLIC_BASE_URL consistently for clientId |

### Medium (error handling, security)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| M1 | `ha-event-router.ts:195` | Swallowed batch errors — no logging | Add `console.error` in catch block |
| M2 | `home-assistant.ts:355` | WebSocket error handler silent | Log error message |
| M3 | `auto-inject.ts:38-62` | No error handling — crashes request | Wrap in try-catch, return silently on failure |
| M4 | `service.ts:294-327` | `canDeleteProvider()` uses `FOR UPDATE` on read-only path | Remove `FOR UPDATE` |
| M5 | `server.ts:19795` | HA OAuth authorize is GET with side effects | Change to POST (coordinate with frontend) |
| M6 | `workers.ts:37-45` | No timeout on Nominatim API calls | Add AbortSignal timeout |

### Low (code quality)

| ID | File | Issue | Fix |
|----|------|-------|-----|
| L1 | `service.ts:68` | `rowToProvider` uses `any` | Type the row parameter |
| L2 | `workers.ts:22,83` | Geocode/embedding workers race-prone | Add `FOR UPDATE SKIP LOCKED` to worker claim queries |

### Feature

| ID | Issue | Description |
|----|-------|-------------|
| F1 | #1896 | Dev session plugin tools: create, list, get, update, complete |

---

## Architecture Decisions

### C3 Fix: Wiring the Ingestion Pipeline

The `GeoIngestorProcessor` in `run.ts` currently receives a callback that only logs. The fix:
1. Pass the DB pool into `GeoIngestorProcessor` constructor
2. In the callback, call `ingestLocationUpdate(pool, providerId, update)`
3. The providerId needs to come from the lifecycle manager context — add it to the event dispatch namespace or processor config

**Key insight:** The `lifecycle.ts` `connectProvider()` method already dispatches events through the router with `row.owner_email` as namespace. The `GeoIngestorProcessor` receives this namespace in `onStateChange()`. But we also need the `provider_id` to call `ingestLocationUpdate()`. Solution: pass `provider_id` as part of the namespace (e.g., `providerId:ownerEmail`) or attach it to the processor context.

### C4 Fix: Cross-User Location Leak

The `getCurrentLocation()` query joins through `geo_provider_user` (which has `user_email` filter) but selects `gl.*` without filtering `gl.user_email`. On shared providers where multiple users have subscriptions, a user could get another user's location. Fix: add `AND gl.user_email = $1` to the WHERE clause.

### H1 Fix: WebSocket Reconnect

The issue is in the initial connection's `close` handler (line 457-462):
```typescript
ws.on('close', () => {
  if (!ctx.disconnecting && ctx.attempt > 0) {
    scheduleReconnect();
  }
});
```
After successful auth, `ctx.attempt` is reset to 0 (line 419), so the close handler won't reconnect. Fix: always schedule reconnect unless `ctx.disconnecting`.

### H2 Fix: Lifecycle Reconcile

Current reconcile only checks set membership (new IDs, removed IDs). Need to also check:
- Config changes (URL, etc.)
- Credential updates (token refresh)
- Status changes
Compare row hashes or timestamps; reconnect if different.

### H3 Fix: Service Call Routing

The `NotifyListener` callback currently ignores which channel fired. Need to:
1. Accept channel/payload in callback signature
2. Route `ha_service_call` payloads to `ServiceCallHandler`
3. Route `geo_provider_config_changed` to lifecycle reconcile

### M5 Fix: GET→POST for OAuth Authorize

This requires coordinating with the frontend. The current flow:
- Frontend opens `GET /api/geolocation/providers/ha/authorize?instance_url=...&label=...`
- Server creates provider, generates OAuth URL, returns it

Change to POST and update frontend component.

### F1: Dev Session Plugin Tools

Follow existing tool factory pattern in `packages/openclaw-plugin/src/tools/`:
- `dev-sessions.ts`: 5 tools with Zod schemas
- Export from `index.ts`
- Register in `register-openclaw.ts`

---

## Agent Team Structure

### Team: `omnibus-1895-1896`

| Teammate | Worktree | Scope |
|----------|----------|-------|
| **ha-critical** | `/tmp/worktree-omnibus-ha-critical` | C1-C4: Critical HA fixes (auto-inject, FOR UPDATE, ingestion pipeline, cross-user leak) |
| **ha-high** | `/tmp/worktree-omnibus-ha-high` | H1-H4: High-priority HA fixes (reconnect, reconcile, service calls, OAuth clientId) |
| **ha-medium-low** | `/tmp/worktree-omnibus-ha-medium-low` | M1-M6, L1-L2: Medium and Low priority fixes |
| **dev-session-tools** | `/tmp/worktree-omnibus-dev-session-tools` | F1: Dev session plugin tools (#1896) |

### Phasing

**Phase 1** (parallel): All 4 teammates work simultaneously
**Phase 2** (sequential): Lead merges all branches into omnibus branch, resolves conflicts
**Phase 3**: Lead runs full test suite, fixes any integration issues
**Phase 4**: Lead creates omnibus PR

### Branch Strategy

- Each teammate works on a feature branch from `main`
- Lead creates `omnibus/1895-1896-ha-fixes-dev-session-tools` branch
- Lead merges all feature branches into omnibus branch
- PR targets `main`

---

## Testing Strategy

Each teammate writes tests for their fixes:
- **C1**: Test auto-inject with correct column name
- **C2**: Test provider creation succeeds (regression)
- **C3**: Integration test that location updates reach `geo_location` table
- **C4**: Test that shared provider returns only requesting user's location
- **H1**: Test WebSocket reconnection after clean close
- **H2**: Test reconcile detects config changes
- **H3**: Test service call routing
- **F1**: Unit tests for each tool (create, list, get, update, complete)

---

## Risk Assessment

- **Merge conflicts**: Low — each teammate works on different files
- **Integration issues**: Medium — C3 (ingestion wiring) touches the core data pipeline
- **Frontend breakage**: M5 (GET→POST) needs frontend coordination
- **Token cost**: High — 4 teammates × full sessions, but justified by scope
