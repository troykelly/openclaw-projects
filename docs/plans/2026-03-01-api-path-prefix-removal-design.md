# API Path Prefix Removal + Missing Chat Agents Endpoint

**Date:** 2026-03-01
**Status:** Approved

---

## Problem

All API routes are registered with a `/api` prefix (e.g., `/api/health`, `/api/chat/sessions`), but the API already lives on a dedicated subdomain (`api.execdesk.ai`). This creates redundant URLs like `https://api.execdesk.ai/api/health`. No standard API follows this pattern — Stripe uses `api.stripe.com/v1/charges`, GitHub uses `api.github.com/repos`, etc.

Additionally, `GET /api/chat/agents` was specified in the Epic #1940 design but never implemented on the backend. The frontend calls it, UI tests mock it, but the route doesn't exist — causing 404s on the settings page.

## Solution

Rip-and-replace: remove the `/api` prefix from all backend routes, frontend paths, tests, OpenAPI specs, and deployment config. No deprecation, no forwarding. Also implement the missing `GET /chat/agents` endpoint.

## Scope

### 1. Backend Routes (`src/api/server.ts`, `src/api/chat/routes.ts`, etc.)

Strip `/api` prefix from all route registrations:
- `/api/health` → `/health`
- `/api/chat/sessions` → `/chat/sessions`
- `/api/settings` → `/settings`
- `/api/geolocation/current` → `/geolocation/current`
- etc.

Non-API routes unchanged: `/static/*`, SPA fallback.

New route: `GET /chat/agents` — returns distinct agent_ids from `chat_session` table, shaped as `{ agents: ChatAgent[] }`.

### 2. Frontend (`src/ui/`)

All `apiClient` path arguments drop `/api`:
- `apiClient.get('/api/settings')` → `apiClient.get('/settings')`
- `AUTH_PATH_PREFIX` changes from `'/api/auth/'` to `'/auth/'`

`getApiBaseUrl()` unchanged — already returns `https://api.{domain}` for production.

### 3. OpenAPI Spec (`src/api/openapi/paths/`)

All 53 path definition modules drop the `/api` prefix. Add `GET /chat/agents` path.

### 4. Tests

Mechanical find-replace of `/api/` → `/` in all test path strings (~4,500 references). No logic changes.

### 5. Deployment

- **Traefik**: Update redirect rule from `{DOMAIN}/api/*` → `api.{DOMAIN}/*` (strip prefix in redirect).
- **Nginx**: Remove `/api/` proxy block — local dev uses same-origin direct access.
- **OAuth callback**: `https://api.${DOMAIN}/api/oauth/callback` → `https://api.${DOMAIN}/oauth/callback`.
- **docker-compose.traefik.yml**: Update comment referencing OAUTH_REDIRECT_URI.

### 6. CSP / CORS

No changes. CSP already allows `api.{hostname}`. CORS is origin-based, not path-based.

## Out of Scope

- API versioning (e.g., `/v1/` prefix) — future concern
- Geolocation 404 handling — already works correctly (UI handles 404 as empty state)
