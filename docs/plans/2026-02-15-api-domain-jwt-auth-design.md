# Design: Standardize API Domain Routing + JWT Authentication

**Date:** 2026-02-15
**Epic:** #1322 — API Domain Standardization & JWT Auth Migration
**Status:** Draft (post-Codex review v2)

---

## Problem

The dashboard login flow is broken due to a domain split:

1. User visits `https://dashboard.example.invalid/app` (root domain)
2. Frontend sends `POST /api/auth/request-link` to same origin
3. Server generates magic link as `https://api.example.invalid/api/auth/consume?token=...` (because `PUBLIC_BASE_URL=https://api.example.invalid`)
4. User clicks link, lands on `api.example.invalid`, session cookie scoped to `api.example.invalid`
5. Server does relative redirect to `/app/work-items` — user lands on `https://api.example.invalid/app/work-items` — no SPA there
6. Even if redirect worked, the cookie from `api.` wouldn't be sent for subsequent calls from the root domain

Root cause: mixed use of `api.` subdomain and `/api` path routing, session cookies scoped to a single origin, and `PUBLIC_BASE_URL` pointing to the API subdomain instead of the app domain.

**Current state: nothing works.** This is a greenfield rebuild of the auth and routing layer with no backward compatibility constraints.

## Decisions

1. **All API traffic goes to `api.{DOMAIN}` subdomain** — frontend makes cross-origin requests
2. **JWT authentication only** — `Authorization: Bearer` header, no session cookies
3. **Refresh tokens in HttpOnly cookie** on `api.{DOMAIN}` (scoped to auth endpoints only)
4. **Magic links point to the app domain** — SPA handles token consumption
5. **`PUBLIC_BASE_URL` means the app/root domain** (not the API subdomain)
6. **`/api/*` path on root domain returns 307 redirect** to `api.{DOMAIN}` as a safety net
7. **All auth (user + M2M) unified on JWT** — `OPENCLAW_API_TOKEN` replaces `OPENCLAW_PROJECTS_AUTH_SECRET`
8. **No legacy support** — session cookies, static secrets, and `/api` path routing are removed entirely

## Target Architecture

```
Browser (https://example.invalid/app)
  │
  ├─ SPA static assets ← Traefik → nginx (root domain)
  │
  ├─ API calls (Authorization: Bearer <jwt>)
  │   └─ https://api.example.invalid/api/* ← Traefik → ModSecurity → API
  │
  ├─ WebSocket (token via first message after upgrade)
  │   └─ wss://api.example.invalid/api/ws
  │
  └─ Token refresh (HttpOnly cookie auto-sent with credentials: 'include')
      └─ POST https://api.example.invalid/api/auth/refresh

OpenClaw Agents / Plugins (machine-to-machine):
  └─ Authorization: Bearer <OPENCLAW_API_TOKEN> (long-lived JWT with type: m2m)
```

### Auth Flow: Magic Link Login

```
1. User enters email on https://example.invalid/app/login
2. Frontend: POST https://api.example.invalid/api/auth/request-link { email }
3. API: generates token, emails link to https://example.invalid/app/auth/consume?token=<token>
4. User clicks link → SPA loads at /app/auth/consume
5. Frontend: POST https://api.example.invalid/api/auth/consume { token }
   (with credentials: 'include' so the response can set the refresh cookie)
6. API: validates token, returns { accessToken } + sets HttpOnly refresh cookie
7. Frontend: stores accessToken in memory, redirects to preserved deep link or /app/work-items
```

### Auth Flow: Token Refresh

```
1. Access token expires (15 min) or API returns 401
2. Frontend: POST https://api.example.invalid/api/auth/refresh
   (with credentials: 'include' — browser sends refresh cookie)
3. API: validates refresh token (SELECT ... FOR UPDATE), rotates it,
   returns { accessToken } + new refresh cookie
4. Frontend: updates in-memory accessToken, retries failed request
5. On page load: frontend always calls /api/auth/refresh first to bootstrap session
```

### Auth Flow: Logout

```
1. Frontend: POST https://api.example.invalid/api/auth/revoke
   (with credentials: 'include' — sends refresh cookie)
2. API: revokes refresh token family, clears refresh cookie
3. Frontend: clears in-memory accessToken, redirects to /app/login
```

## JWT Design

### Access Token (short-lived, stateless)

- **Algorithm:** HS256 (single API server, symmetric key)
- **Secret:** New env var `JWT_SECRET` (required in production, min 32 bytes)
- **TTL:** 15 minutes
- **Claims:**
  - `sub`: user email (user tokens) or service ID (M2M tokens)
  - `type`: `user` or `m2m`
  - `iat`: issued at
  - `exp`: expiration
  - `jti`: unique token ID (UUID)
  - `kid`: key ID (for key rotation)
  - `scope`: (M2M only) array of allowed scopes
- **Clock skew:** Allow 30 seconds of clock skew tolerance in verification
- **Size budget:** Target < 500 bytes total (well within proxy/WAF header limits of 8KB+)

### Key Rotation Strategy

Include `kid` (key ID) in JWT headers from day one:
- New JWTs signed with the new key and a new `kid`
- Verification accepts both old and new `kid` during a transition window
- After transition (> max token TTL), remove old key
- Env var: `JWT_SECRET` for primary, `JWT_SECRET_PREVIOUS` for rotation transition

### M2M Tokens

M2M tokens (`OPENCLAW_API_TOKEN`) are long-lived JWTs for service-to-service auth:
- **TTL:** Effectively non-expiring (100 years)
- **Claims:** `{ sub: "openclaw-gateway", type: "m2m", scope: ["api:full"], iss: "openclaw-projects" }`
- **Revocation:** Via JWT secret rotation (same `kid` mechanism)
- **Generation:** CLI command or admin endpoint
- **Env var:** `OPENCLAW_API_TOKEN` (replaces `OPENCLAW_PROJECTS_AUTH_SECRET`)

### Refresh Token (long-lived, server-validated)

- **Format:** Random 32-byte base64url string (not a JWT)
- **Storage:** `auth_refresh_token` table (hashed with SHA-256)
- **TTL:** 7 days
- **Transport:** HttpOnly cookie on `api.{DOMAIN}`
  - `httpOnly: true`
  - `secure: true` (production)
  - `sameSite: 'strict'`
  - `path: '/api/auth'` (only sent to auth endpoints)
- **Rotation:** Every refresh issues a new token and invalidates the old one
- **Family tracking:** `family_id` column detects token reuse (compromise indicator)
- **Concurrency handling:** Use `SELECT ... FOR UPDATE` in a transaction; allow a 10-second grace window for the previous token after rotation to handle concurrent requests

### Database Schema

```sql
-- New table for refresh tokens
CREATE TABLE auth_refresh_token (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  token_sha256 text NOT NULL UNIQUE,
  email text NOT NULL,
  family_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid REFERENCES auth_refresh_token(id),
  grace_expires_at timestamptz
);

CREATE INDEX auth_refresh_token_email_idx ON auth_refresh_token(email);
CREATE INDEX auth_refresh_token_family_idx ON auth_refresh_token(family_id);
CREATE INDEX auth_refresh_token_expires_idx ON auth_refresh_token(expires_at);

-- Drop legacy session table (no longer needed)
DROP TABLE IF EXISTS auth_session;
```

## Auth Middleware: Unified JWT

Single code path for all auth — no session cookies, no static secrets:

```typescript
interface AuthIdentity {
  email: string;         // user email or service identifier
  type: 'user' | 'm2m'; // token type
  scopes?: string[];     // m2m: granted scopes
}

async function getAuthIdentity(req): Promise<AuthIdentity | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    const payload = await verifyAccessToken(token);
    return {
      email: payload.sub,
      type: payload.type || 'user',
      scopes: payload.scope,
    };
  } catch {
    return null;
  }
}

// Convenience wrapper for routes that just need the email
async function getSessionEmail(req): Promise<string | null> {
  const identity = await getAuthIdentity(req);
  return identity?.email ?? null;
}
```

### Authorization: User vs M2M Scoping

M2M tokens (agents/plugins) need access to ALL users' data — they operate on behalf of any user. User tokens (web UI) must only access their own data.

```typescript
/**
 * Resolve the effective user_email for a request.
 * - M2M tokens: use the user_email from the request (agent specifies which user)
 * - User tokens: always use identity.email (ignore any user_email param)
 */
function resolveUserEmail(identity: AuthIdentity, requestedEmail?: string): string {
  if (identity.type === 'm2m') {
    // Agents can operate on any user's data
    return requestedEmail || identity.email;
  }
  // Web UI users can only access their own data — ignore any param
  return identity.email;
}
```

Every endpoint that accepts a `user_email` parameter must use `resolveUserEmail()` to enforce this scoping. See #1353 for the full audit.

## CORS Configuration

```typescript
// Support multiple origins for www/root dual-host and staging environments
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.PUBLIC_BASE_URL || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim());

app.register(cors, {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  credentials: true,  // needed for refresh token cookie
  maxAge: 86400,
});
```

**Important:** Remove the existing SSE endpoint wildcard `Access-Control-Allow-Origin` (`src/api/server.ts:584`) — incompatible with `credentials: true`.

**`CORS_ALLOWED_ORIGINS`:** Comma-separated list for multi-origin support (e.g., `https://example.invalid,https://www.example.invalid`). Falls back to `PUBLIC_BASE_URL` if not set.

## Frontend API Base URL

Convention-based derivation from `window.location` with build-time override:

```typescript
function getApiBaseUrl(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  const { protocol, hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return '';

  const baseDomain = hostname.replace(/^www\./, '');
  return `${protocol}//api.${baseDomain}`;
}
```

### Frontend: `credentials: 'include'`

**Critical:** All cross-origin fetch calls must include `credentials: 'include'` for the refresh token cookie. All direct `fetch()` calls must be migrated to the centralized API client.

Known direct `fetch()` callers to migrate:
- `src/ui/components/settings/use-settings.ts`
- `src/ui/components/settings/connected-accounts-section.tsx`
- `src/ui/components/auth/login-form.tsx`

## Environment Variable Changes

| Variable | Value | Purpose |
|----------|-------|---------|
| `PUBLIC_BASE_URL` | `https://{DOMAIN}` | App/root domain for magic links, CORS origin |
| `JWT_SECRET` | (required, min 32 bytes) | HS256 signing key |
| `JWT_SECRET_PREVIOUS` | (optional) | Previous secret for key rotation |
| `CORS_ALLOWED_ORIGINS` | (optional) | Comma-separated allowed origins |
| `OPENCLAW_API_TOKEN` | (long-lived JWT) | M2M auth for agents/plugins |
| `COOKIE_SECRET` | (required) | Fastify cookie plugin for refresh token cookie |

**Removed:** `OPENCLAW_PROJECTS_AUTH_SECRET`, `APP_BASE_URL` (unified into `PUBLIC_BASE_URL`)

Docker-compose changes:
- `docker-compose.full.yml`: `PUBLIC_BASE_URL: https://${DOMAIN}` (was `https://api.${DOMAIN}`)
- `docker-compose.traefik.yml`: same change
- `docker-compose.yml`: `PUBLIC_BASE_URL: http://localhost:3000` (unchanged)
- All: add `JWT_SECRET`, replace `OPENCLAW_PROJECTS_AUTH_SECRET` with `OPENCLAW_API_TOKEN`

## Traefik Routing Changes

### Remove
- `api-path-router` (priority 100) — frontend calls `api.` directly

### Add
- `api-redirect-router` — 307 redirect `{DOMAIN}/api/*` → `api.{DOMAIN}/api/*` as safety net
- **Must use 307** (not 301/302) to preserve HTTP method and body

### Keep
- `api-router` — routes `api.{DOMAIN}` to ModSecurity → API
- `root-redirect-router` — redirects `/` to `/app`
- `app-router` — routes root domain to nginx
- All other routers unchanged

## Nginx Changes

- Keep `/api/` proxy block for local development only (non-Traefik, basic compose)

## WebSocket Auth

JWT passed as **first message after WebSocket upgrade** (not in query string).

```typescript
// Frontend: after connection opens, send auth message
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'auth', token: accessToken }));
};
```

**Why not query parameter?** JWTs in query strings leak via server logs, proxy logs, Referer headers, and browser history.

Server flow:
1. Accept WebSocket upgrade without auth
2. Start a 5-second auth timeout
3. First message must be `{ type: 'auth', token: '<jwt>' }`
4. Verify JWT, associate connection with user email
5. If no auth message within timeout, close connection with 4401

## OAuth Post-Callback

After OAuth provider callback to `api.{DOMAIN}/api/oauth/callback`:
1. API generates a one-time authorization code (random, 60s TTL, stored in DB)
2. Redirects to `${PUBLIC_BASE_URL}/app/auth/consume?code=<auth-code>&source=oauth`
3. SPA detects `code` param (vs `token` for magic links)
4. Frontend: `POST /api/auth/exchange { code }` → receives `{ accessToken }` + refresh cookie

## Rate Limiting on Auth Endpoints

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| `POST /api/auth/request-link` | 5 requests | 15 min | IP + email |
| `POST /api/auth/consume` | 10 requests | 15 min | IP |
| `POST /api/auth/refresh` | 30 requests | 1 min | IP |
| `POST /api/auth/revoke` | 10 requests | 1 min | IP |
| `POST /api/auth/exchange` | 10 requests | 1 min | IP |

Auth events logged to audit system (`migrations/034_audit_log.up.sql`): `auth.magic_link_requested`, `auth.token_consumed`, `auth.token_refresh`, `auth.token_revoked`, `auth.refresh_reuse_detected`.

## Phases

### Phase 1: JWT Backend Infrastructure
- `jose` package, JWT signing/verification with `kid` and key rotation
- `auth_refresh_token` table migration, drop `auth_session`
- Auth endpoints: `POST /api/auth/consume`, `/refresh`, `/revoke`, `/exchange`
- Unified JWT auth middleware (replaces session cookies and static secrets)
- CORS registration
- Auth rate limiting and audit logging
- M2M JWT generation, `OPENCLAW_API_TOKEN` env var

### Phase 2: Domain Routing & Config
- `PUBLIC_BASE_URL` → app domain in all docker-compose files
- Traefik: remove `api-path-router`, add 307 redirect
- Replace `OPENCLAW_PROJECTS_AUTH_SECRET` with `OPENCLAW_API_TOKEN` everywhere

### Phase 3: Frontend Migration
- API base URL derivation from hostname
- Centralize all direct `fetch()` calls through API client
- Auth token manager (in-memory, auto-refresh, request queuing, `credentials: 'include'`)
- Magic link consumption SPA route (`/app/auth/consume`)
- WebSocket auth via first-message pattern

### Phase 4: Polish
- OAuth post-callback redirect to app domain
- E2E test updates
- Fix SSE wildcard CORS

## Affected Code Paths

| File | Action |
|------|--------|
| `src/api/server.ts:156-174` | Replace `getSessionEmail()` with JWT-only `getAuthIdentity()` |
| `src/api/server.ts:283-293` | Replace `requireDashboardSession()` — return 401 JSON, no login page |
| `src/api/server.ts:399` | Remove session cookie bearer hook, replace with JWT verification |
| `src/api/server.ts:508-518` | Replace WebSocket cookie auth with first-message JWT |
| `src/api/server.ts:573-584` | Remove wildcard CORS on SSE endpoint |
| `src/api/server.ts:1620-1651` | Update magic link URL to use app domain |
| `src/api/server.ts:1654-1718` | Replace GET consume with POST returning JWT |
| `src/api/auth/secret.ts` | Remove entirely (replaced by JWT M2M) |
| `packages/openclaw-plugin/src/api-client.ts` | Use `OPENCLAW_API_TOKEN` |
| `src/ui/lib/api-client.ts` | Add base URL, Authorization header, credentials |
| `src/ui/components/settings/use-settings.ts` | Migrate to API client |
| `src/ui/components/settings/connected-accounts-section.tsx` | Migrate to API client |
| `src/ui/components/auth/login-form.tsx` | Cross-origin POST to api.{domain} |
| `migrations/008_magic_link_auth.up.sql` | Drop `auth_session` table |
| `migrations/034_audit_log.up.sql` | Add auth event types |

## Security Considerations

- **Access tokens are stateless** — cannot be revoked before expiry (15 min window acceptable)
- **Refresh token rotation** detects compromise (reuse revokes entire family)
- **Refresh cookie scoped to `/api/auth`** — not sent with regular API requests
- **No cookie domain expansion** — refresh cookie defaults to `api.{DOMAIN}` only
- **CORS multi-origin allowlist** — no wildcard, explicit origin matching with `Vary: Origin`
- **JWT key rotation** — `kid` header from day one enables zero-downtime rotation
- **XSS risk**: access token in memory is extractable via XSS; enforce strict CSP headers
- **WebSocket**: token sent as first message, not in URL (prevents log/proxy leakage)
- **Redirect safety**: 307 preserves HTTP method and body
- **Unified auth**: single JWT verification path for user and M2M tokens
- **Rate limiting**: per-endpoint rate limits on all auth endpoints
- **Audit logging**: all auth events logged
- **Concurrent refresh**: 10s grace window prevents false compromise detection
- **Clock skew**: 30s tolerance on JWT verification
