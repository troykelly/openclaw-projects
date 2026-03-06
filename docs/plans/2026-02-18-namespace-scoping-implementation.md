# Namespace Scoping Implementation Plan (Omnibus PR)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship all 24 issues in Epic #1418 as a single omnibus PR on branch `issue/1418-namespace-scoping`.

**Architecture:** Add `namespace` column to all entity tables, replacing `user_email` scoping. New `namespace_grant` table maps users to namespaces. Auth middleware resolves namespaces from grants. All API routes updated to scope by namespace.

**Tech Stack:** PostgreSQL (golang-migrate), Fastify (TypeScript), OpenClaw Plugin (TypeScript/Zod), Vite+React SPA

---

## Execution Strategy

**Omnibus branch:** `issue/1418-namespace-scoping` in a worktree at `/tmp/worktree-issue-1418-namespace-scoping`

**Phases:**
1. **Foundation (sequential, lead):** #1429 DB migration, #1473 Namespace API, #1474 User provisioning, #1475 Auth middleware
2. **Gateway (lead):** #1428 Plugin namespace config
3. **Entity Migration (parallel, agent team):** 13 entity issues — each agent handles 3-4 entities
4. **Cleanup (sequential, lead):** #1481 Drop user_email, #1482 Dashboard UX, #1483 Move endpoint, #1485 Roles, #1486 Grant restrictions

---

## Phase 1: Foundation

### Task 1: DB Migration (#1429)

**Files:**
- Create: `migrations/090_namespace_scoping.up.sql`
- Create: `migrations/090_namespace_scoping.down.sql`
- Modify: `tests/migrations.test.ts`

**What to do:**
1. Write migration SQL per design doc Section 9.1 (5 steps: namespace_grant table, bootstrap per-user namespaces, add namespace columns to 19 tables with CHECK constraints, backfill from user_email, create indexes)
2. Write down migration (reverse order: drop indexes, drop namespace columns, drop namespace_grant)
3. Write tests verifying: table exists, columns exist, CHECK constraints work, backfill correctness
4. Run: `pnpm run migrate:up` then `pnpm test`
5. Commit: `[#1429] Add namespace_grant table and namespace columns to all entity tables`

### Task 2: Namespace Management API (#1473)

**Files:**
- Modify: `src/api/server.ts` (add routes ~line 549 after health checks)
- Create: `tests/namespace_management.test.ts`
- Modify: `packages/openclaw-plugin/src/tools/index.ts` (register new tools)
- Create: `packages/openclaw-plugin/src/tools/namespaces.ts`

**Routes to add:**
```
GET    /api/namespaces
POST   /api/namespaces
GET    /api/namespaces/:ns
GET    /api/namespaces/:ns/grants
POST   /api/namespaces/:ns/grants
PATCH  /api/namespaces/:ns/grants/:id
DELETE /api/namespaces/:ns/grants/:id
```

**What to do:**
1. Write failing tests for each endpoint (M2M full access, user token restricted to grants, validation)
2. Implement routes in server.ts
3. Add plugin tools: `namespace_list`, `namespace_create`, `namespace_grant`
4. Run: `pnpm test` then `pnpm run lint`
5. Commit: `[#1473] Add namespace management API`

### Task 3: User Provisioning API (#1474)

**Files:**
- Modify: `src/api/server.ts` (add routes after namespace routes)
- Create: `tests/user_provisioning.test.ts`
- Modify: `packages/openclaw-plugin/src/tools/index.ts`
- Create: `packages/openclaw-plugin/src/tools/users.ts`

**Routes to add:**
```
POST   /api/users
GET    /api/users
GET    /api/users/:email
PATCH  /api/users/:email
DELETE /api/users/:email
```

**What to do:**
1. Write failing tests (M2M creates user + auto-provisions namespace, idempotent, user tokens self-service only)
2. Implement routes
3. Add plugin tools: `user_create`, `user_list`, `user_get`
4. Run: `pnpm test`
5. Commit: `[#1474] Add user provisioning API`

### Task 4: Auth Middleware — Namespace Resolution (#1475)

**Files:**
- Modify: `src/api/server.ts` (lines 509-547: keep old hook, add new one after it)
- Modify: `src/api/auth/middleware.ts` (add resolveNamespaces, getNamespaceGrants)
- Create: `tests/namespace_middleware.test.ts`

**What to do:**
1. Write `getNamespaceGrants(pool, email)` function in auth/middleware.ts
2. Write `resolveNamespaces(req)` function returning `{ storeNamespace, queryNamespaces, isM2M }`
3. Add new preHandler hook AFTER existing principal binding hook (both run during Phase 1-3)
4. Write `verifyNamespaceScope()` to replace `verifyUserEmailScope()`
5. Tests: user with grants → namespace injected; user with no grants → 403; M2M → pass through; no default grant → uses first alphabetically
6. Run: `pnpm test`
7. Commit: `[#1475] Add namespace resolution middleware`

---

## Phase 2: Gateway + Plugin

### Task 5: Gateway Config (#1428)

**Files:**
- Modify: `packages/openclaw-plugin/openclaw.plugin.json` (add namespace config schema)
- Modify: `packages/openclaw-plugin/src/config.ts` (read namespace config)
- Modify: `packages/openclaw-plugin/src/api-client.ts` (pass namespace params)
- Remove: `userScoping` config from plugin

**What to do:**
1. Add `namespace.default` and `namespace.recall` to plugin config schema
2. Update API client to pass `namespace` in body and `namespaces` in query
3. Add fallback: if no namespace config, use agent ID as default (if valid pattern)
4. Remove `userScoping` config
5. Run: plugin tests
6. Commit: `[#1428] Add namespace config to gateway plugin`

---

## Phase 3: Entity Migration (Parallelizable)

**Pattern for each entity:**
1. Update route SQL queries: add `namespace` to WHERE clauses (alongside existing `user_email` during transition)
2. Update INSERT: accept `namespace` from request body
3. Update SELECT/LIST: accept `namespaces` query param (comma-separated), filter by namespace IN ($namespaces)
4. Update responses: include `namespace` field
5. Update plugin tool: add `namespace`/`namespaces` params to schema, pass to API
6. Write tests: namespace scoping works, cross-namespace queries work, responses include namespace
7. Commit per entity group

### Agent Batch A: Work Items (#1422 Projects, #1423 Todos)
- Routes: `/api/work-items/*`, `/api/projects/*`, `/api/backlog`
- Plugin: `projects.ts`, `todos.ts`, `project-search.ts`, `todo-search.ts`
- Table: `work_item` (shared)

### Agent Batch B: Memory (#1419), Relationships (#1421)
- Routes: `/api/memories/*`, `/api/relationships/*`
- Plugin: `memory-store.ts`, `memory-recall.ts`, `memory-forget.ts`, `relationships.ts`
- Tables: `memory`, `relationship`

### Agent Batch C: Contacts (#1420), Threads/Messages (#1426)
- Routes: `/api/contacts/*`, `/api/threads/*`, `/api/messages/*`
- Plugin: `contacts.ts`, `threads.ts`, `message-search.ts`
- Tables: `contact`, `contact_endpoint`, `external_thread`, `external_message`

### Agent Batch D: Lists (#1424), Meals/Recipes/Pantry (#1425), Notebooks (#1471)
- Routes: `/api/lists/*`, `/api/recipes/*`, `/api/meal-log/*`, `/api/pantry/*`, `/api/notebooks/*`, `/api/notes/*`
- Plugin: `notebooks.ts`, `notes.ts` (lists/meals/pantry via skill-store or direct)
- Tables: `list`, `recipe`, `meal_log`, `pantry_item`, `notebook`, `note`

### Agent Batch E: Skill Store (#1427), Entity Links (#1472), Files (#1479), Notifications (#1480)
- Routes: `/api/skill-store/*`, `/api/entity-links/*`, `/api/contexts/*`, `/api/files/*`, `/api/notifications/*`
- Plugin: `skill-store.ts`, `entity-links.ts`, `context-search.ts`, `file-share.ts`
- Tables: `skill_store_item`, `entity_link`, `context`, `file_attachment`, `file_share`, `notification`

---

## Phase 4: Cleanup + Hardening

### Task 6: Drop user_email Columns (#1481)

**Files:**
- Create: `migrations/091_drop_user_email_scoping.up.sql`
- Create: `migrations/091_drop_user_email_scoping.down.sql`
- Modify: `src/api/server.ts` (remove old principal binding hook lines 509-547, remove all `verifyUserEmailScope` calls, remove `user_email` from query/body parsing)

### Task 7: Dashboard UX (#1482)

**Files:**
- Modify: `src/api/server.ts` (add namespace grants to bootstrap data in `renderAppFrontendHtml`)
- Modify: `src/ui/app/` (namespace switcher, badges, create-in-namespace)

### Task 8: Namespace Move Endpoint (#1483)

**Files:**
- Modify: `src/api/server.ts` (add PATCH routes)

### Task 9: Role Enforcement (#1485, #1486)

**Files:**
- Modify: `src/api/auth/middleware.ts` (add role checking)
- Modify: `src/api/server.ts` (namespace grant routes check role)

---

## Verification

After all phases:
1. `pnpm test` — all unit + integration tests pass
2. `pnpm run lint` — no lint errors
3. `pnpm run typecheck` — no type errors
4. `pnpm run app:build` — frontend builds
5. `pnpm run test:e2e` — E2E tests pass (if available)
6. Code review via Codex MCP
7. Create omnibus PR: `[#1418] Namespace scoping for all entities`
