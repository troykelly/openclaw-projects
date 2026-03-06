# API Path Prefix Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the redundant `/api` prefix from all API routes (since the API already lives on `api.{domain}` subdomain) and implement the missing `GET /chat/agents` endpoint.

**Architecture:** Mechanical find-replace of `/api/` path prefix across backend routes, frontend calls, OpenAPI specs, tests, and deployment config. One new endpoint (`GET /chat/agents`) implemented via TDD. No deprecation, no forwarding.

**Tech Stack:** Fastify (backend), React + TanStack Query (frontend), Vitest (tests), Traefik/nginx (deployment)

**Design doc:** `docs/plans/2026-03-01-api-path-prefix-removal-design.md`

---

### Task 1: Create GitHub Issue and Worktree

**Step 1: Create the GitHub issue**

```bash
gh issue create \
  --title "[Settings] API path prefix removal + missing GET /chat/agents endpoint" \
  --body "$(cat <<'EOF'
## Problem

All API routes are registered with a `/api` prefix (e.g., `/api/health`, `/api/chat/sessions`), but the API lives on `api.execdesk.ai`. This creates redundant URLs like `https://api.execdesk.ai/api/health`. No standard API follows this pattern.

Additionally, `GET /api/chat/agents` was specified in Epic #1940 design but never implemented — causing 404s on the settings page.

## Acceptance Criteria

- [ ] All backend routes drop `/api` prefix (e.g., `/health`, `/chat/sessions`, `/settings`)
- [ ] All frontend `apiClient` calls updated to match
- [ ] All OpenAPI path definitions updated
- [ ] All tests updated
- [ ] New `GET /chat/agents` endpoint implemented and tested
- [ ] Deployment config (nginx, Traefik, docker-compose) updated
- [ ] `AUTH_PATH_PREFIX` in api-client.ts updated
- [ ] `authSkipPaths` in server.ts updated
- [ ] OAuth callback URI comments updated
- [ ] Build passes, all tests pass

## Design

See `docs/plans/2026-03-01-api-path-prefix-removal-design.md`
EOF
)"
```

**Step 2: Note the issue number (e.g., #1981) and create worktree**

```bash
ISSUE_NUM=<number>
git worktree add /tmp/worktree-issue-${ISSUE_NUM}-api-path-cleanup -b issue/${ISSUE_NUM}-api-path-cleanup
cd /tmp/worktree-issue-${ISSUE_NUM}-api-path-cleanup
pnpm install --frozen-lockfile
```

**Step 3: Verify clean build before changes**

```bash
pnpm run build
```

---

### Task 2: Backend — Strip `/api` from server.ts route registrations

This is the largest file. All route registrations use string literals like `'/api/health'`.

**Files:**
- Modify: `src/api/server.ts`

**Step 1: Bulk replace `/api/` prefix in route registrations**

Use a targeted replacement: in every `app.get('/api/`, `app.post('/api/`, `app.put('/api/`, `app.patch('/api/`, `app.delete('/api/` call, strip the `/api` prefix. Also update string literals in path references (redirects, comments, etc.).

The pattern to replace across server.ts:
- `'/api/` → `'/` in route registration strings
- `"/api/` → `"/` in any double-quoted path strings
- `` `/api/` `` → `` `/` `` in template literal paths

**Important exceptions to NOT change:**
- `'/static/'` prefix — stays as-is
- `'/app/'`, `'/app'`, `'/'`, `'/auth'`, `'/dashboard'` — stays as-is
- `'/ws/conversation'` — already no `/api` prefix, stays as-is
- Import paths like `'./api-sources/routes.ts'` — these are file imports, not URL paths

**Step 2: Update `authSkipPaths` set** (currently at ~line 718)

Replace:
```typescript
const authSkipPaths = new Set([
  '/health',
  '/api/health',
  '/api/health/live',
  '/api/health/ready',
  '/api/auth/request-link',
  '/api/auth/consume',
  '/api/auth/refresh',
  '/api/auth/revoke',
  '/api/auth/exchange',
  '/api/capabilities',
  '/api/openapi.json',
  '/api/twilio/sms',
  '/api/twilio/sms/status',
  '/api/postmark/inbound',
  '/api/postmark/email/status',
  '/api/cloudflare/email',
  '/api/ws',
  '/ws/conversation',
  '/api/oauth/callback',
  '/api/chat/ws',
]);
```

With:
```typescript
const authSkipPaths = new Set([
  '/health',
  '/health/live',
  '/health/ready',
  '/auth/request-link',
  '/auth/consume',
  '/auth/refresh',
  '/auth/revoke',
  '/auth/exchange',
  '/capabilities',
  '/openapi.json',
  '/twilio/sms',
  '/twilio/sms/status',
  '/postmark/inbound',
  '/postmark/email/status',
  '/cloudflare/email',
  '/ws',
  '/ws/conversation',
  '/oauth/callback',
  '/chat/ws',
]);
```

**Step 3: Update dynamic prefix checks** in the auth hook (~line 750-780)

Replace:
```typescript
if (url.startsWith('/api/files/shared/') || url.startsWith('/api/shared/')) {
```
With:
```typescript
if (url.startsWith('/files/shared/') || url.startsWith('/shared/')) {
```

Replace:
```typescript
if (url.startsWith('/api/terminal/sessions/') && url.endsWith('/attach')) {
```
With:
```typescript
if (url.startsWith('/terminal/sessions/') && url.endsWith('/attach')) {
```

**Step 4: Commit**

```bash
git add src/api/server.ts
git commit -m "[#ISSUE] Strip /api prefix from all route registrations in server.ts"
```

---

### Task 3: Backend — Strip `/api` from plugin route files

**Files:**
- Modify: `src/api/chat/routes.ts`
- Modify: `src/api/voice/routes.ts`
- Modify: `src/api/terminal/routes.ts`
- Modify: `src/api/ha-routes.ts`
- Modify: `src/api/api-sources/routes.ts`

**Step 1: Bulk replace in each plugin file**

Same pattern as server.ts: replace `'/api/` with `'/` in all route registration strings.

For `src/api/chat/routes.ts`, routes like:
- `'/api/chat/sessions'` → `'/chat/sessions'`
- `'/api/chat/ws/ticket'` → `'/chat/ws/ticket'`
- `'/api/chat/ws'` → `'/chat/ws'`
- `'/api/push/subscribe'` → `'/push/subscribe'`
- `'/api/notifications/agent'` → `'/notifications/agent'`

**Step 2: Commit**

```bash
git add src/api/chat/routes.ts src/api/voice/routes.ts src/api/terminal/routes.ts src/api/ha-routes.ts src/api/api-sources/routes.ts
git commit -m "[#ISSUE] Strip /api prefix from plugin route files"
```

---

### Task 4: Backend — Implement GET /chat/agents endpoint (TDD)

**Files:**
- Create: test for the new endpoint (in chat routes test or a new integration test)
- Modify: `src/api/chat/routes.ts`

**Step 1: Write the failing test**

Add a test that verifies `GET /chat/agents` returns `{ agents: [...] }` with the expected shape. The test should use the same pattern as existing chat route tests.

The endpoint should return distinct `agent_id` values from the `chat_session` table for the authenticated user's namespace, shaped as:
```typescript
{
  agents: Array<{
    id: string;        // the agent_id from chat_session
    name: string;      // same as id (no separate name column)
    display_name: string | null;  // null (no display name stored)
    avatar_url: string | null;    // null (no avatar stored)
  }>
}
```

**Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run <test-file> -t "chat agents"
```

Expected: FAIL — route not found / 404.

**Step 3: Implement the endpoint in `src/api/chat/routes.ts`**

Add inside the `chatRoutesPlugin` function:

```typescript
// GET /chat/agents — List available agents (Issue #1957)
app.get('/chat/agents', async (req, reply) => {
  const email = getAuthIdentity(req)?.email;
  if (!email) return reply.code(401).send({ error: 'Unauthorized' });

  const namespace = (req.headers['x-namespace'] as string) || 'default';
  const pool = opts.pool;

  try {
    const result = await pool.query(
      `SELECT DISTINCT agent_id FROM chat_session
       WHERE namespace = $1 AND status != 'expired'
       ORDER BY agent_id`,
      [namespace],
    );

    const agents = result.rows.map((row: { agent_id: string }) => ({
      id: row.agent_id,
      name: row.agent_id,
      display_name: null,
      avatar_url: null,
    }));

    return reply.send({ agents });
  } catch (err) {
    req.log.error(err, 'Failed to list chat agents');
    return reply.code(500).send({ error: 'Failed to list agents' });
  }
});
```

**Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run <test-file> -t "chat agents"
```

**Step 5: Commit**

```bash
git add src/api/chat/routes.ts <test-file>
git commit -m "[#ISSUE] Implement GET /chat/agents endpoint"
```

---

### Task 5: OpenAPI — Strip `/api` prefix from all path definitions + add /chat/agents

**Files:**
- Modify: All files in `src/api/openapi/paths/*.ts` (53 files)
- Modify: `src/api/openapi/paths/chat.ts` (add agents endpoint)

**Step 1: Bulk replace in OpenAPI path definitions**

Every path key in every module starts with `'/api/`. Replace with `'/`.

Example in `src/api/openapi/paths/health.ts`:
- `'/api/health'` → `'/health'`
- `'/api/health/live'` → `'/health/live'`

**Step 2: Add GET /chat/agents to `src/api/openapi/paths/chat.ts`**

Add to the `paths` object:

```typescript
'/chat/agents': {
  get: {
    operationId: 'listChatAgents',
    summary: 'List available chat agents',
    description: 'Returns distinct agents from existing chat sessions in the namespace.',
    tags: ['Chat'],
    responses: {
      '200': jsonResponse('Available agents', {
        type: 'object',
        properties: {
          agents: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'name'],
              properties: {
                id: { type: 'string', description: 'Agent identifier' },
                name: { type: 'string', description: 'Agent name' },
                display_name: { type: 'string', nullable: true, description: 'Human-friendly name' },
                avatar_url: { type: 'string', nullable: true, description: 'Agent avatar URL' },
              },
            },
          },
        },
      }),
      ...errorResponses(401, 500),
    },
  },
},
```

**Step 3: Commit**

```bash
git add src/api/openapi/paths/
git commit -m "[#ISSUE] Strip /api prefix from OpenAPI path definitions, add GET /chat/agents"
```

---

### Task 6: Frontend — Strip `/api` from all apiClient calls

**Files:**
- Modify: `src/ui/lib/api-client.ts` (AUTH_PATH_PREFIX)
- Modify: ~97 files in `src/ui/` that contain `/api/` path strings

**Step 1: Update AUTH_PATH_PREFIX**

In `src/ui/lib/api-client.ts` line 69:

Replace:
```typescript
const AUTH_PATH_PREFIX = '/api/auth/';
```
With:
```typescript
const AUTH_PATH_PREFIX = '/auth/';
```

**Step 2: Bulk replace in all frontend files**

Replace all `'/api/` with `'/` and `"/api/` with `"/` and `` `/api/`` with `` `/`` in `src/ui/` files.

Target patterns in apiClient calls:
- `apiClient.get('/api/settings')` → `apiClient.get('/settings')`
- `apiClient.post('/api/chat/sessions', ...)` → `apiClient.post('/chat/sessions', ...)`
- Template literals: `` `/api/work-items/${id}` `` → `` `/work-items/${id}` ``

**Important: do NOT replace:**
- Import paths like `'@/ui/lib/api-client'`
- Comment text that describes the architecture (update wording, don't blindly replace)

**Step 3: Commit**

```bash
git add src/ui/
git commit -m "[#ISSUE] Strip /api prefix from all frontend API calls"
```

---

### Task 7: Tests — Bulk update path references

**Files:**
- Modify: All test files in `tests/` and `src/**/*.test.*` that reference `/api/` paths

**Step 1: Bulk replace in test files**

Same pattern: replace `/api/` path strings with `/` equivalents in assertions, mocks, and request URLs.

Examples:
- `mockGet('/api/settings')` → `mockGet('/settings')`
- `app.inject({ url: '/api/health' })` → `app.inject({ url: '/health' })`
- `expect(url).toBe('/api/chat/agents')` → `expect(url).toBe('/chat/agents')`

**Important: do NOT replace:**
- File path references like `src/api/server.ts`
- Import paths
- Comments describing file locations

**Step 2: Commit**

```bash
git add tests/ src/api/**/*.test.*
git commit -m "[#ISSUE] Update all test path references to remove /api prefix"
```

---

### Task 8: Deployment config — nginx, Traefik, docker-compose

**Files:**
- Modify: `docker/app/nginx.conf.template`
- Modify: `docker-compose.traefik.yml`
- Modify: `docker-compose.yml` (if it references `/api/`)

**Step 1: Update nginx.conf.template**

Remove the `/api/` proxy block entirely (lines 46-73). Local dev now uses same-origin direct access. The `location /` SPA fallback and other locations stay.

Replace the entire `/api/` location block with a comment:

```nginx
    # API requests go directly to api.{domain} subdomain in production.
    # For local Docker development, the UI dev server proxies to the API port.
    # No nginx API proxy is needed.
```

**Step 2: Update docker-compose.traefik.yml**

Update the OAuth callback URI comment (~line 450):
```yaml
# Set OAUTH_REDIRECT_URI=https://api.${DOMAIN}/oauth/callback
```

Update any other `/api/` path references in comments or labels.

**Step 3: Update docker-compose.yml**

If it references `/api/` in nginx proxy config or comments, update accordingly.

**Step 4: Commit**

```bash
git add docker/ docker-compose*.yml
git commit -m "[#ISSUE] Update deployment config for prefix-free API routes"
```

---

### Task 9: Build verification and full test run

**Step 1: Run TypeScript build**

```bash
pnpm run build
```

Fix any type errors. The most likely issues:
- String literal types that include `/api/`
- Type imports that reference path patterns

**Step 2: Run all unit tests**

```bash
pnpm exec vitest run
```

Fix any failures. Most will be path string mismatches from any references missed in earlier tasks.

**Step 3: Run integration tests if available**

```bash
pnpm run test:integration
```

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "[#ISSUE] Fix build and test issues from path prefix removal"
```

---

### Task 10: Create Pull Request

**Step 1: Push and create PR**

```bash
git push -u origin issue/${ISSUE_NUM}-api-path-cleanup
gh pr create \
  --title "[#ISSUE] Remove /api path prefix + implement GET /chat/agents" \
  --body "$(cat <<'EOF'
## Summary

- Strips the redundant `/api` prefix from all API routes — the API already lives on `api.{domain}` subdomain
- Implements the missing `GET /chat/agents` endpoint (specified in Epic #1940 design but never built)
- Updates frontend, tests, OpenAPI specs, and deployment config

Closes #ISSUE

## Test plan

- [ ] `pnpm run build` passes
- [ ] `pnpm exec vitest run` passes
- [ ] `GET /chat/agents` returns `{ agents: [...] }` shaped response
- [ ] `GET /health` returns 200 (not `/api/health`)
- [ ] Settings page loads without 4xx errors
- [ ] OAuth callback URI works at `/oauth/callback` (not `/api/oauth/callback`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
