# Design: Namespace Scoping for All Entities

**Date:** 2026-02-18
**Epic:** #1418 — Namespace scoping for all entities
**Status:** Draft v2 — namespace replaces user_email
**Related:** #1172 (original scoping gap), #1417 (memory-specific namespace, closed)

---

## 1. Problem Statement

The openclaw-projects backend has **inconsistent data isolation**. Some tables use `user_email` for scoping, some use `skill_id`, and many have no scoping at all. The `user_email` mechanism is fundamentally flawed:

- It conflates user identity with data partitioning
- It can't model shared data (a household shopping list, a team project)
- M2M agents (OpenClaw) have full access regardless — `user_email` provides no real security boundary
- The principal binding hook that enforces it is incomplete (only overrides existing fields)

**Decision: Replace `user_email` scoping with `namespace` scoping entirely.**

Namespaces are the sole data partition key. Users access data through namespace grants, not by identity matching. OpenClaw agents access data through their configured namespaces.

---

## 2. Current State: Complete Entity Scoping Audit

### 2.1 Scoping Mechanisms Today

| Mechanism | Where Used | How Enforced |
|-----------|-----------|--------------|
| `user_email` (nullable) | work_item, contact, contact_endpoint, relationship, external_thread, external_message, entity_link, pantry_item | Optional WHERE clause — appended only when param present |
| `user_email` (NOT NULL) | notebook, note, notification, notification_preference, recipe, meal_log, dev_session, oauth_connection, calendar_event, geo_* | Always in WHERE clause — required |
| `skill_id` + `collection` | skill_store_item, skill_store_schedule, skill_store_activity | Always in WHERE clause — primary partition key |
| **None** | list, list_item, context, context_link, agent_identity, file_attachment, file_share, activity feed, audit_log, search, backlog, trash | No data isolation whatsoever |

### 2.2 Complete Table Classification

#### TIER 1: Core entity tables — MIGRATE TO NAMESPACE

These tables currently use `user_email` for scoping. Namespace replaces it.

| Table | Current Scoping | Nullable? | Indexed? | Query Enforcement | Notes |
|-------|----------------|-----------|----------|-------------------|-------|
| `work_item` | `user_email` | YES | YES | Conditional (optional filter) | Projects, epics, issues, todos — all in one table |
| `memory` | `user_email`, `created_by_agent` | YES, YES | YES, NO | Conditional | `created_by_agent` stays as attribution |
| `contact` | `user_email` | YES | YES | Conditional | |
| `contact_endpoint` | `user_email` | YES | YES | Inherits from contact | |
| `relationship` | `user_email`, `created_by_agent` | YES, YES | YES, NO | Conditional | `created_by_agent` stays as attribution |
| `external_thread` | `user_email` | YES | YES | Conditional | |
| `external_message` | `user_email` | YES | YES | Conditional | |
| `notebook` | `user_email` | NOT NULL | YES | Always enforced | |
| `note` | `user_email` | NOT NULL | YES | Always enforced | Has `hide_from_agents` boolean |
| `recipe` | `user_email` | NOT NULL | YES | Always enforced | |
| `meal_log` | `user_email` | NOT NULL | YES | Always enforced | |
| `pantry_item` | `user_email` | YES (FK) | NO | Inconsistent | |
| `entity_link` | `user_email` | YES | YES | INSERT only — GET/DELETE don't filter |
| `list` | **NONE** | N/A | N/A | **No scoping at all** | |
| `list_item` | **NONE** | N/A | N/A | Inherits from list (none) | |
| `context` | **NONE** | N/A | N/A | **No scoping at all** | |
| `context_link` | **NONE** | N/A | N/A | **No scoping at all** | |

#### TIER 2: Already namespaced differently — KEEP + ADD NAMESPACE

| Table | Current Scoping | Notes |
|-------|----------------|-------|
| `skill_store_item` | `skill_id` + `collection` + optional `user_email` | `skill_id` maps to namespace. See Section 6.4. |
| `skill_store_schedule` | `skill_id` + `collection` | |
| `skill_store_activity` | `skill_id` + `collection` | |

#### TIER 3: Global/shared reference data — NO NAMESPACE

| Table | Rationale |
|-------|-----------|
| `relationship_type` | Pre-seeded reference data (parent_of, sibling_of, etc.) |
| `label` | Shared tag definitions |
| `embedding_config` | System singleton |
| `embedding_settings` | System singleton |
| `embedding_usage` | Aggregate metrics |

#### TIER 4: User identity / auth — NO NAMESPACE (keep user identity)

These tables track **who a person is**, not entity data. `user_email`/`email` stays as identity, not scoping.

| Table | Identity Column | Rationale |
|-------|----------------|-----------|
| `user_setting` | `email` (PK) | User identity and preferences |
| `auth_magic_link` | `email` | Auth flow — targets a person |
| `auth_refresh_token` | `email` | Auth token — belongs to a person |
| `auth_one_time_code` | `email` | Auth flow — targets a person |
| `oauth_connection` | `user_email` | OAuth token — a person's Google/Microsoft credentials |
| `oauth_state` | `user_email` | Short-lived PKCE state |
| `calendar_event` | `user_email` | Synced from a person's calendar account |
| `geo_provider` | `owner_email` | A person's location sharing provider |
| `geo_provider_user` | `user_email` | A person's subscription to a provider |
| `geo_location` | `user_email` | A person's physical location (TimescaleDB) |
| `dev_session` | `user_email` | A person's dev session |

#### TIER 5: Agent identity — NO NAMESPACE (intentionally global)

| Table | Notes |
|-------|-------|
| `agent_identity` | `name` globally UNIQUE — agent personas shared across system |
| `agent_identity_history` | Audit trail |

#### TIER 6: Notification — ADD NAMESPACE (delivery changes)

| Table | Current | New Model |
|-------|---------|-----------|
| `notification` | `user_email NOT NULL` — per-user delivery | Add `namespace` — notifications go to all users with grants to that namespace |
| `notification_preference` | `user_email NOT NULL` | Keep as-is — per-user notification preferences |

#### TIER 7: Junction/child tables — INHERIT from parent

| Table | Parent | Own user_email? | Action |
|-------|--------|----------------|--------|
| `work_item_participant` | work_item | None | Inherits namespace from parent |
| `work_item_dependency` | work_item | None | Inherits |
| `work_item_external_link` | work_item | None | Inherits |
| `work_item_activity` | work_item | `actor_email` (attribution) | Keep `actor_email` as attribution, inherits namespace |
| `work_item_todo` | work_item | None | Inherits |
| `work_item_contact` | work_item + contact | None | Inherits |
| `work_item_label` | work_item + label | None | Inherits |
| `work_item_attachment` | work_item + file | `attached_by` (attribution) | Keep as attribution |
| `work_item_comment` | work_item | `user_email` NOT NULL | **Keep as attribution** ("who wrote this comment") — not scoping |
| `work_item_comment_reaction` | work_item_comment | `user_email` NOT NULL | **Keep as attribution** ("who reacted") |
| `user_presence` | work_item | `user_email` NOT NULL | **Keep as identity** ("who is here now") |
| `note_share` | note | `created_by_email`, `shared_with_email` | **Replaced by namespace grants** — sharing = granting namespace access |
| `note_version` | note | `changed_by_email` | **Keep as attribution** ("who changed this") |
| `note_collaborator` | note | `user_email` | **Replaced by namespace grants** |
| `notebook_share` | notebook | `created_by_email`, `shared_with_email` | **Replaced by namespace grants** |
| `recipe_ingredient` | recipe | None | Inherits |
| `recipe_step` | recipe | None | Inherits |
| `recipe_image` | recipe | None | Inherits |

#### TIER 8: File storage — ADD NAMESPACE

| Table | Current Scoping | Action |
|-------|----------------|--------|
| `file_attachment` | `uploaded_by` (nullable, attribution) | Add `namespace`. Keep `uploaded_by` as attribution. |
| `file_share` | `created_by` (nullable, attribution) | Add `namespace`. Keep `created_by` as attribution. |

#### TIER 9: Infrastructure — NO NAMESPACE

| Table | Notes |
|-------|-------|
| `internal_job` | System job queue |
| `webhook_outbox` | System outbox |

---

## 3. The Namespace Model

### 3.1 Core Principles

1. **Namespace is the sole data partition key** — replaces `user_email` for all entity data access
2. **Users access namespaces via grants** — a `namespace_grant` table maps users to their namespaces
3. **Agents access namespaces via config** — gateway config specifies default and recall namespaces per agent
4. **M2M tokens can access any namespace** — OpenClaw has full access, no ACLs needed
5. **Dashboard users are restricted to granted namespaces** — enforced by middleware
6. **Every entity record includes its namespace** — returned in all API responses
7. **`user_email` remains for identity and attribution** — who wrote a comment, who owns an OAuth token — but NOT for data access scoping

### 3.2 Namespace Naming

- Pattern: `^[a-z0-9][a-z0-9._-]*$`
- Max length: 63 characters
- Examples: `troy`, `matty`, `household`, `prodcity`, `openclaw.arthouse`
- Reserved: `default` (used for migrated data), `system` (reserved for future use)

### 3.3 How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                     Data Access Flow                         │
│                                                              │
│  Dashboard User (JWT type=user)                              │
│    → JWT contains email                                      │
│    → Middleware resolves email → namespace_grant rows         │
│    → Request can only access granted namespaces              │
│    → Default namespace from grant where is_default=true      │
│                                                              │
│  OpenClaw Agent (JWT type=m2m)                               │
│    → Gateway config provides default + recall namespaces     │
│    → Plugin passes namespace in request body/query           │
│    → No restriction — agent can access any namespace         │
│                                                              │
│  Store: targets ONE namespace (default if omitted)           │
│  Query: spans MULTIPLE namespaces (recall set if omitted)    │
│  Update/Delete: targets the record's existing namespace      │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. New Table: `namespace_grant`

### 4.1 Schema

```sql
CREATE TABLE namespace_grant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  namespace   text NOT NULL,
  role        text NOT NULL DEFAULT 'member',
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email, namespace)
);

CREATE INDEX idx_namespace_grant_email ON namespace_grant(email);
CREATE INDEX idx_namespace_grant_namespace ON namespace_grant(namespace);

-- Ensure at most one default per user
CREATE UNIQUE INDEX idx_namespace_grant_default
  ON namespace_grant(email) WHERE is_default = true;
```

### 4.2 Roles

| Role | Access |
|------|--------|
| `owner` | Full CRUD + can grant/revoke access to others |
| `admin` | Full CRUD |
| `member` | Full CRUD (default) |
| `observer` | Read-only |

Role enforcement is **future work** — initially all roles grant full access. The column exists for forward compatibility.

### 4.3 Bootstrap

On first login (or user creation), a user gets a grant to the `default` namespace with `is_default = true`. Additional grants are configured by an admin or by OpenClaw agents.

```sql
-- Example: Troy has his own namespace + shared household
INSERT INTO namespace_grant (email, namespace, role, is_default) VALUES
  ('troy@example.com', 'troy', 'owner', true),
  ('troy@example.com', 'household', 'member', false),
  ('troy@example.com', 'openclaw.arthouse', 'observer', false);

-- Matty has her own + shared household
INSERT INTO namespace_grant (email, namespace, role, is_default) VALUES
  ('matty@example.com', 'matty', 'owner', true),
  ('matty@example.com', 'household', 'member', false);
```

### 4.4 Namespace Management API

```
GET    /api/namespaces                  — list namespaces accessible to current user (or all, for M2M)
POST   /api/namespaces                  — create a new namespace
GET    /api/namespaces/:ns              — get namespace details + member list
GET    /api/namespaces/:ns/grants       — list grants for a namespace
POST   /api/namespaces/:ns/grants       — grant access to a user
PATCH  /api/namespaces/:ns/grants/:id   — update role or default flag
DELETE /api/namespaces/:ns/grants/:id   — revoke access
```

**M2M agents are the primary consumers of these endpoints.** OpenClaw agents need to:
- Create namespaces for new users, households, teams
- Grant/revoke namespace access as users are added/removed
- Set a user's default namespace
- Query what namespaces exist and who has access

For dashboard (user token) requests, restrict to namespaces the user has `owner` or `admin` role on (future — initially all roles can manage).

### 4.5 User Provisioning by Agents

OpenClaw agents need to create dashboard users AND set up their namespace access. This requires:

```
POST   /api/users                       — create a user (M2M only)
GET    /api/users                       — list users (M2M only)
GET    /api/users/:email                — get user details + their namespace grants
PATCH  /api/users/:email                — update user settings
DELETE /api/users/:email                — deactivate user (M2M only)
```

**Flow: Agent onboards a new user**
1. Agent creates user: `POST /api/users { email, display_name }`
   - Creates `user_setting` row
   - Creates personal namespace (e.g., `troy`)
   - Creates `namespace_grant` with `role: owner, is_default: true`
2. Agent adds user to shared namespaces: `POST /api/namespaces/household/grants { email, role: "member" }`
3. Agent sends magic link: `POST /api/auth/request-link { email }`
4. User clicks link, logs in, sees data in their granted namespaces

**Flow: Agent manages a household**
1. Agent creates household namespace: `POST /api/namespaces { name: "household" }`
2. Agent grants access: `POST /api/namespaces/household/grants { email: "troy@...", role: "member" }`
3. Agent grants access: `POST /api/namespaces/household/grants { email: "matty@...", role: "member" }`
4. Agent stores shared data: `POST /api/work-items { ..., namespace: "household" }`
5. Both users see the data when they log in

---

## 5. Auth Middleware Changes

### 5.1 Current Flow (to be replaced)

```
Request → JWT verification → principal binding (force user_email) → route handler
```

### 5.2 New Flow

```
Request → JWT verification → namespace resolution → route handler

Namespace resolution:
  If M2M token:
    → Read namespace/namespaces from request body/query
    → No restriction — pass through as-is
    → Default to agent's configured default namespace if omitted

  If user token:
    → Load user's namespace_grant rows (cache per request)
    → Read namespace/namespaces from request body/query
    → INTERSECT requested namespaces with granted namespaces
    → Reject if requested namespace not in grants
    → Default to user's is_default=true namespace if omitted
```

### 5.3 Principal Binding Replacement

The current preHandler hook that forces `user_email` (server.ts:509-547) is **replaced** with a namespace binding hook:

```typescript
app.addHook('preHandler', async (req, reply) => {
  const identity = await getAuthIdentity(req);
  if (!identity || identity.type !== 'user') return; // M2M: no restrictions

  // Load this user's granted namespaces
  const grants = await getNamespaceGrants(pool, identity.email);
  const grantedNamespaces = new Set(grants.map(g => g.namespace));
  const defaultNamespace = grants.find(g => g.is_default)?.namespace ?? 'default';

  // Bind namespace on body/query — intersect with grants
  const q = req.query as Record<string, unknown>;
  const b = req.body as Record<string, unknown> | undefined;

  // For store/create: single namespace
  if (b && 'namespace' in b) {
    if (!grantedNamespaces.has(b.namespace as string)) {
      return reply.code(403).send({ error: 'No access to namespace' });
    }
  } else if (b && typeof b === 'object') {
    b.namespace = defaultNamespace; // inject default
  }

  // For list/search: namespaces array
  if (q.namespaces) {
    const requested = (q.namespaces as string).split(',');
    const allowed = requested.filter(ns => grantedNamespaces.has(ns));
    if (allowed.length === 0) {
      return reply.code(403).send({ error: 'No access to any requested namespace' });
    }
    q.namespaces = allowed.join(',');
  } else {
    // Default: all granted namespaces
    q.namespaces = Array.from(grantedNamespaces).join(',');
  }

  // Remove user_email from scoping params (no longer used for access control)
  // Keep it only as attribution on write operations if needed
});
```

### 5.4 `resolveUserEmail()` → `resolveNamespaces()`

Replace the unused `resolveUserEmail()` function with:

```typescript
interface NamespaceContext {
  storeNamespace: string;         // single namespace for writes
  queryNamespaces: string[];      // namespace list for reads
  isM2M: boolean;
}

async function resolveNamespaces(req): Promise<NamespaceContext> {
  // ... resolve from JWT + grants + request params
}
```

---

## 6. Migration Plan: Column by Column

### 6.1 Tables Getting `namespace` Column (replaces user_email for scoping)

| Table | Add `namespace` | Drop `user_email`? | Notes |
|-------|----------------|-------------------|-------|
| `work_item` | YES | YES — nullable, used only for scoping | |
| `memory` | YES | YES — nullable, used only for scoping | Keep `created_by_agent` as attribution |
| `contact` | YES | YES — nullable, used only for scoping | |
| `contact_endpoint` | YES | YES — nullable, used only for scoping | |
| `relationship` | YES | YES — nullable, used only for scoping | Keep `created_by_agent` as attribution |
| `external_thread` | YES | YES — nullable, used only for scoping | |
| `external_message` | YES | YES — nullable, used only for scoping | |
| `notebook` | YES | DROP after migration (was NOT NULL for scoping) | |
| `note` | YES | DROP after migration (was NOT NULL for scoping) | Keep `hide_from_agents` |
| `notification` | YES | KEEP — repurpose as "who to deliver to" (see 6.3) | |
| `recipe` | YES | DROP after migration | |
| `meal_log` | YES | DROP after migration | |
| `pantry_item` | YES | DROP after migration | |
| `entity_link` | YES | YES — nullable, barely used | |
| `list` | YES | N/A (never had it) | |
| `context` | YES | N/A (never had it) | |
| `file_attachment` | YES | N/A (has `uploaded_by` — keep as attribution) | |
| `file_share` | YES | N/A (has `created_by` — keep as attribution) | |

### 6.2 Tables NOT Getting `namespace` — Keep `user_email`/`email` as Identity

| Table | Column | Rationale |
|-------|--------|-----------|
| `user_setting` | `email` (PK) | IS the user identity table |
| `oauth_connection` | `user_email` NOT NULL | Per-person OAuth credentials |
| `auth_magic_link` | `email` | Auth flow targets a person |
| `auth_refresh_token` | `email` | Auth token belongs to a person |
| `auth_one_time_code` | `email` | Auth flow targets a person |
| `oauth_state` | `user_email` | PKCE state |
| `calendar_event` | `user_email` | Synced from person's calendar |
| `geo_provider` | `owner_email` | Person's location provider |
| `geo_provider_user` | `user_email` | Person's provider subscription |
| `geo_location` | `user_email` | Person's physical location |
| `dev_session` | `user_email` | Person's dev session |

### 6.3 SPECIAL CASE: Notification

Notifications have a dual nature:
- **Routing**: who should see this notification → `user_email` (delivery target)
- **Context**: what namespace is this about → `namespace`

**Action:** Add `namespace` column to `notification`. Keep `user_email` as the delivery target (renamed conceptually to "recipient"). When a work item in namespace "household" triggers a reminder, notifications go to ALL users with grants to "household".

The notification creation logic changes from:
```
createNotification(user_email, work_item) → one notification to one user
```
to:
```
createNotification(namespace, work_item) → one notification per user with grant to that namespace
```

### 6.4 SPECIAL CASE: Skill Store

The skill store already uses `skill_id` + `collection` as its namespace system.

**Action:** Add a `namespace` column to `skill_store_item` that mirrors the top-level namespace system. The plugin maps `defaultNamespace` → `namespace` column (NOT `skill_id`). `skill_id` remains as a secondary grouping within a namespace.

This allows: memory in namespace "household", skill store items in namespace "household" — queried together as "everything in the household namespace."

Existing `user_email` on skill_store_item is dropped (was optional, same as other tables).

### 6.5 Attribution Columns — KEEP AS-IS

These columns record "who did this" and are NOT used for data access. They stay unchanged:

| Table | Column | Purpose |
|-------|--------|---------|
| `memory` | `created_by_agent` | Which agent stored this memory |
| `relationship` | `created_by_agent` | Which agent created this relationship |
| `work_item_activity` | `actor_email` | Who performed this action |
| `work_item_attachment` | `attached_by` | Who attached this file |
| `work_item_comment` | `user_email` | Who wrote this comment |
| `work_item_comment_reaction` | `user_email` | Who reacted |
| `user_presence` | `user_email` | Who is viewing this item now |
| `note_version` | `changed_by_email` | Who changed this note version |
| `file_attachment` | `uploaded_by` | Who uploaded this file |
| `file_share` | `created_by` | Who created this share link |

### 6.6 Sharing Tables — REPLACED BY namespace_grant

These tables exist solely to share data between users. Namespaces make them redundant:

| Table | Current Purpose | Replaced By |
|-------|----------------|-------------|
| `note_share` | Share a note with another user | Both users have grants to the note's namespace |
| `note_collaborator` | Track note collaborators | Same — namespace grants |
| `notebook_share` | Share a notebook with another user | Same — namespace grants |

These tables can be deprecated (not dropped immediately — mark as legacy).

---

## 7. API Contract

### 7.1 How Namespace Is Passed

**Body/query parameter** — consistent with existing patterns.

**For store/create operations:**
```
POST /api/work-items { ..., namespace: "household" }
POST /api/memories/unified { ..., namespace: "household" }
POST /api/contacts { ..., namespace: "household" }
```

**For list/search/recall operations:**
```
GET /api/work-items?namespaces=household,troy
GET /api/memories/search?q=...&namespaces=household,troy
GET /api/contacts?namespaces=household,troy
```

**For update/delete operations:**
- No namespace param needed — operation targets the record's existing namespace
- Record's namespace is immutable (delete + recreate to move)

### 7.2 Default Behavior

| Scenario | Store/Create default | List/Search default |
|----------|---------------------|---------------------|
| M2M agent with gateway config | `config.namespace.default` | `config.namespace.recall` |
| M2M agent without config | `'default'` | All namespaces (no filter) |
| Dashboard user | User's `is_default=true` grant | All granted namespaces |

### 7.3 Response Format

All entity responses include `namespace`:

```json
{
  "id": "uuid",
  "title": "Buy groceries",
  "namespace": "household",
  ...
}
```

No more `user_email` in entity responses (except on identity-bound tables like oauth_connection).

### 7.4 Removing user_email from API

**Phase approach:**
1. Add `namespace` param alongside `user_email` — both work
2. Routes use `namespace` if present, fall back to `user_email`
3. Deprecation warnings on `user_email` usage
4. Remove `user_email` from API contract (breaking change — major version bump)

This allows the plugin and any external integrations to migrate gradually.

---

## 8. Plugin Changes

### 8.1 Config Schema

Add to `openclaw.plugin.json`:

```json
{
  "namespace": {
    "type": "object",
    "properties": {
      "default": {
        "type": "string",
        "description": "Namespace for store/create when none specified",
        "pattern": "^[a-z0-9][a-z0-9._-]*$"
      },
      "recall": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Namespaces to search when none specified"
      }
    }
  }
}
```

### 8.2 Tool Changes

Every tool gets optional `namespace` (store) or `namespaces` (query) parameter:

```typescript
// Store tools
const MemoryStoreParamsSchema = z.object({
  ...existingParams,
  namespace: z.string().optional().describe('Target namespace for storage'),
});

// Query tools
const MemoryRecallParamsSchema = z.object({
  ...existingParams,
  namespaces: z.array(z.string()).optional().describe('Namespaces to search'),
});
```

### 8.3 API Client Changes

- Remove `user_email` from query params (phased — see 7.4)
- Add `namespace` / `namespaces` to request body/query
- `X-Agent-Id` header: keep for attribution/logging, not for scoping
- Remove `userScoping` config option (replaced by `namespace` config)

---

## 9. Database Migration Strategy

### 9.1 Migration 1: Add namespace_grant table + namespace columns

```sql
-- namespace_grant table
CREATE TABLE IF NOT EXISTS namespace_grant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL REFERENCES user_setting(email) ON DELETE CASCADE,
  namespace   text NOT NULL
                CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  role        text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member', 'observer')),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email)),
  UNIQUE(email, namespace)
);

CREATE INDEX IF NOT EXISTS idx_namespace_grant_email ON namespace_grant(email);
CREATE INDEX IF NOT EXISTS idx_namespace_grant_namespace ON namespace_grant(namespace);
CREATE UNIQUE INDEX IF NOT EXISTS idx_namespace_grant_default
  ON namespace_grant(email) WHERE is_default = true;

-- Bootstrap: create per-user namespaces from existing user_setting emails
-- Namespace name derived from email local part (slugified)
INSERT INTO namespace_grant (email, namespace, role, is_default)
SELECT
  lower(email),
  lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9]', '-', 'g')),
  'owner',
  true
FROM user_setting
ON CONFLICT (email, namespace) DO NOTHING;

-- Also give everyone access to 'default' for historically-unscoped data
INSERT INTO namespace_grant (email, namespace, role, is_default)
SELECT lower(email), 'default', 'member', false
FROM user_setting
ON CONFLICT (email, namespace) DO NOTHING;

-- Add namespace column to all entity tables (default 'default' for unscoped rows)
-- Rows with existing user_email will be backfilled to per-user namespaces in a separate step
ALTER TABLE work_item ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE memory ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE contact ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE contact_endpoint ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE relationship ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE external_thread ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE external_message ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE notebook ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE note ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE notification ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE list ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE recipe ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE meal_log ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE pantry_item ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE entity_link ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE context ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE file_attachment ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
ALTER TABLE skill_store_item ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default'
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);

-- Backfill: migrate existing data from user_email to per-user namespaces
-- For each table with user_email, set namespace to the user's default namespace
UPDATE work_item wi SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = wi.user_email AND ng.is_default = true AND wi.user_email IS NOT NULL;
UPDATE memory m SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = m.user_email AND ng.is_default = true AND m.user_email IS NOT NULL;
UPDATE contact c SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = c.user_email AND ng.is_default = true AND c.user_email IS NOT NULL;
UPDATE contact_endpoint ce SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = ce.user_email AND ng.is_default = true AND ce.user_email IS NOT NULL;
UPDATE relationship r SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = r.user_email AND ng.is_default = true AND r.user_email IS NOT NULL;
UPDATE external_thread et SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = et.user_email AND ng.is_default = true AND et.user_email IS NOT NULL;
UPDATE external_message em SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = em.user_email AND ng.is_default = true AND em.user_email IS NOT NULL;
UPDATE notebook nb SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = nb.user_email AND ng.is_default = true;
UPDATE note n SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = n.user_email AND ng.is_default = true;
UPDATE recipe r SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = r.user_email AND ng.is_default = true;
UPDATE meal_log ml SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = ml.user_email AND ng.is_default = true;
UPDATE pantry_item pi SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = pi.user_email AND ng.is_default = true AND pi.user_email IS NOT NULL;
UPDATE entity_link el SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = el.user_email AND ng.is_default = true AND el.user_email IS NOT NULL;
UPDATE memory m SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = m.user_email AND ng.is_default = true AND m.user_email IS NOT NULL;
UPDATE skill_store_item ssi SET namespace = ng.namespace
  FROM namespace_grant ng WHERE ng.email = ssi.user_email AND ng.is_default = true AND ssi.user_email IS NOT NULL;
-- Rows with NULL user_email remain in 'default' namespace (historically unscoped)

-- Indexes
CREATE INDEX IF NOT EXISTS idx_work_item_namespace ON work_item(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory(namespace);
CREATE INDEX IF NOT EXISTS idx_contact_namespace ON contact(namespace);
CREATE INDEX IF NOT EXISTS idx_contact_endpoint_namespace ON contact_endpoint(namespace);
CREATE INDEX IF NOT EXISTS idx_relationship_namespace ON relationship(namespace);
CREATE INDEX IF NOT EXISTS idx_external_thread_namespace ON external_thread(namespace);
CREATE INDEX IF NOT EXISTS idx_external_message_namespace ON external_message(namespace);
CREATE INDEX IF NOT EXISTS idx_notebook_namespace ON notebook(namespace);
CREATE INDEX IF NOT EXISTS idx_note_namespace ON note(namespace);
CREATE INDEX IF NOT EXISTS idx_notification_namespace ON notification(namespace);
CREATE INDEX IF NOT EXISTS idx_list_namespace ON list(namespace);
CREATE INDEX IF NOT EXISTS idx_recipe_namespace ON recipe(namespace);
CREATE INDEX IF NOT EXISTS idx_meal_log_namespace ON meal_log(namespace);
CREATE INDEX IF NOT EXISTS idx_pantry_item_namespace ON pantry_item(namespace);
CREATE INDEX IF NOT EXISTS idx_entity_link_namespace ON entity_link(namespace);
CREATE INDEX IF NOT EXISTS idx_context_namespace ON context(namespace);
CREATE INDEX IF NOT EXISTS idx_file_attachment_namespace ON file_attachment(namespace);
CREATE INDEX IF NOT EXISTS idx_skill_store_item_namespace ON skill_store_item(namespace);
```

### 9.2 Migration 2: Drop user_email scoping columns (AFTER all routes migrated)

This is a **separate, later migration** — only applied after all routes use namespace instead of user_email.

```sql
-- Drop user_email scoping columns from entity tables
-- (columns that were used ONLY for data access scoping, not attribution)
ALTER TABLE work_item DROP COLUMN IF EXISTS user_email;
ALTER TABLE contact DROP COLUMN IF EXISTS user_email;
ALTER TABLE contact_endpoint DROP COLUMN IF EXISTS user_email;
ALTER TABLE relationship DROP COLUMN IF EXISTS user_email;
ALTER TABLE external_thread DROP COLUMN IF EXISTS user_email;
ALTER TABLE external_message DROP COLUMN IF EXISTS user_email;
ALTER TABLE notebook DROP COLUMN IF EXISTS user_email;
ALTER TABLE note DROP COLUMN IF EXISTS user_email;
ALTER TABLE recipe DROP COLUMN IF EXISTS user_email;
ALTER TABLE meal_log DROP COLUMN IF EXISTS user_email;
ALTER TABLE pantry_item DROP COLUMN IF EXISTS user_email;
ALTER TABLE entity_link DROP COLUMN IF EXISTS user_email;
ALTER TABLE skill_store_item DROP COLUMN IF EXISTS user_email;
ALTER TABLE memory DROP COLUMN IF EXISTS user_email;

-- Drop indexes that referenced user_email
DROP INDEX IF EXISTS idx_work_item_user_email;
DROP INDEX IF EXISTS idx_contact_user_email;
DROP INDEX IF EXISTS idx_contact_endpoint_user_email;
DROP INDEX IF EXISTS idx_relationship_user_email;
DROP INDEX IF EXISTS idx_external_thread_user_email;
DROP INDEX IF EXISTS idx_external_message_user_email;
DROP INDEX IF EXISTS idx_notebook_user_email;
DROP INDEX IF EXISTS idx_note_user_email;
DROP INDEX IF EXISTS idx_memory_user_email;
DROP INDEX IF EXISTS idx_recipe_user;
DROP INDEX IF EXISTS idx_meal_log_user;
DROP INDEX IF EXISTS idx_entity_link_user_email;

-- Deprecate sharing tables (keep for now, drop later)
-- note_share, note_collaborator, notebook_share
```

### 9.3 NOT Dropped — user_email as Attribution

These columns stay because they record WHO did something, not data access:

- `work_item_comment.user_email` — who wrote the comment
- `work_item_comment_reaction.user_email` — who reacted
- `user_presence.user_email` — who is present
- `notification.user_email` — who to deliver to (renamed conceptually to "recipient")

---

## 10. Phased Implementation Order

### Phase 0: Pre-work (DONE)
- [x] Design doc (this document)
- [x] Missing issues: #1471 (Notebooks), #1472 (Entity Links, Context)
- [x] Epic #1418 updated with audit findings

### Phase 1: Foundation
- **#1429** — DB migration: add `namespace` column + `namespace_grant` table
- **#1473** — Namespace management API (`/api/namespaces/*` — create, grants, CRUD)
- **#1474** — User provisioning API (`/api/users/*` — M2M agent creates/manages dashboard users)
- **#1475** — Auth middleware: namespace resolution (replace principal binding)

### Phase 2: Gateway + Plugin
- **#1428** — Gateway config: per-agent `namespace.default` and `namespace.recall`
- Plugin: add `namespace`/`namespaces` params to all tool schemas
- Plugin: remove `userScoping` config, replace with `namespace` config

### Phase 3: Entity Migration (parallelizable)
Each issue updates routes + tests to use namespace instead of user_email:
1. **#1419** — Memory
2. **#1420** — Contacts
3. **#1421** — Relationships
4. **#1422** — Projects (work_item kind=project/epic/initiative)
5. **#1423** — Todos (work_item kind=issue/task)
6. **#1424** — Lists/Shopping
7. **#1425** — Meals/Recipes/Pantry
8. **#1426** — Threads/Messages
9. **#1471** — Notebooks
10. **#1472** — Entity Links/Context
11. **#1427** — Skill Store

### Phase 4: Cleanup
- Drop `user_email` scoping columns (Migration 2)
- Deprecate sharing tables (note_share, notebook_share, note_collaborator)
- Remove `user_email` from API contract
- Update dashboard UI to use namespace-based access

---

## 11. Backward Compatibility

### During transition (Phase 1-3):
1. **Both `namespace` and `user_email` params accepted** — routes use namespace if present, fall back to user_email
2. **Default namespace is `'default'`** — all existing data accessible
3. **All existing users get a grant to `'default'`** — no access loss
4. **Plugin tools work without namespace config** — falls back to `'default'`

### After transition (Phase 4):
1. **`user_email` params removed from API** — breaking change, requires plugin version bump
2. **All data partitioned by namespace only**
3. **Sharing via namespace grants only** — sharing tables deprecated

---

## 12. Review Findings and Amendments

Comprehensive review covering security, blind spots, functionality, and UX.

### 12.1 CRITICAL: Migration to `'default'` namespace exposes all data

**Problem:** All existing records migrate to `namespace = 'default'` and all existing users get a grant to `'default'`. This means every user sees every other user's data post-migration — a **regression** from the current (imperfect) `user_email` scoping.

**Resolution:** The migration must create **per-user namespaces** from existing `user_email` values, not dump everything into `'default'`.

Migration strategy (revised):
1. For each distinct `user_email` across entity tables, create a namespace (slugified from email)
2. Create a `namespace_grant` with `role: owner, is_default: true` for that user→namespace
3. Migrate each row's `namespace` to the namespace derived from its `user_email`
4. For rows with NULL `user_email` (nullable tables), assign to `'default'` — these were already globally visible
5. Create a `'default'` namespace grant for all users (so they can still see previously-unscoped data)

```sql
-- Step 1: Create per-user namespaces from existing user_email values
INSERT INTO namespace_grant (email, namespace, role, is_default)
SELECT DISTINCT
  COALESCE(user_email, email),
  lower(regexp_replace(split_part(COALESCE(user_email, email), '@', 1), '[^a-z0-9]', '-', 'g')),
  'owner',
  true
FROM (
  SELECT DISTINCT user_email FROM work_item WHERE user_email IS NOT NULL
  UNION SELECT DISTINCT user_email FROM contact WHERE user_email IS NOT NULL
  UNION SELECT DISTINCT user_email FROM memory WHERE user_email IS NOT NULL
  UNION SELECT DISTINCT user_email FROM notebook
  UNION SELECT DISTINCT email FROM user_setting
) AS emails(user_email, email)
ON CONFLICT (email, namespace) DO NOTHING;

-- Step 2: Backfill namespace from user_email on each table
UPDATE work_item SET namespace = (SELECT ng.namespace FROM namespace_grant ng WHERE ng.email = work_item.user_email AND ng.is_default = true LIMIT 1) WHERE user_email IS NOT NULL;
-- ... repeat for each table ...

-- Step 3: Give everyone access to 'default' for previously-unscoped data
INSERT INTO namespace_grant (email, namespace, role, is_default)
SELECT DISTINCT email, 'default', 'member', false
FROM user_setting
ON CONFLICT (email, namespace) DO NOTHING;
```

### 12.2 CRITICAL: Cross-namespace references — policy undefined

**Problem:** What happens when:
- A `work_item` in namespace `troy` depends on a `work_item` in namespace `household`?
- A `contact` in `troy` has a `relationship` with a `contact` in `household`?
- An `entity_link` connects entities across namespaces?
- A `memory` references a `contact_id` in a different namespace?

**Resolution:** Cross-namespace references are **allowed**. Rationale:
- This is the whole point of shared namespaces — a household shopping list can reference household contacts
- Agents operate across namespaces by design
- Forbidding cross-namespace references would break real workflows

**Rules for cross-namespace references:**
1. **Creating a reference requires access to BOTH namespaces** (for user tokens; M2M unrestricted)
2. **Querying returns the reference even if the target is in another namespace** — but the target's data is only populated if the requester has access to the target's namespace
3. **If the requester lacks access to the target's namespace**, the reference is returned with minimal metadata (id, namespace) but no full payload — a "redacted reference"
4. **Deleting a reference requires access to the namespace of the record containing the reference**, not the target

### 12.3 HIGH: Default namespace fallback creates authorization bypass

**Problem:** The middleware pseudocode falls back to `'default'` when no `is_default=true` grant exists. A user with zero grants would get access to `'default'` namespace.

**Resolution:** If a user has no grants, they have NO access. The middleware must:
1. Load grants → if empty, reject 403 (no namespace access configured)
2. If no `is_default=true` grant exists, use the first grant alphabetically (deterministic, not `'default'`)
3. Never inject a namespace the user doesn't have a grant for

### 12.4 HIGH: Transition period (both user_email and namespace accepted)

**Problem:** During Phase 1-3, routes accept both `namespace` and `user_email`. The old principal binding is removed and replaced with namespace binding. Routes that haven't been migrated yet still use `user_email` WHERE clauses but the middleware no longer forces `user_email`. This creates a window where user tokens bypass scoping on unmigrated routes.

**Resolution:** Phase gate criteria:
1. **Phase 1 (foundation):** Namespace middleware added BUT old principal binding KEPT alongside. Both run. Routes still use `user_email`.
2. **Phase 3 (per-entity):** Each entity migration switches its routes from `user_email` to `namespace` WHERE clauses. Only after ALL routes are migrated...
3. **Phase 4 (cleanup):** Remove old principal binding and `user_email` columns.

The old principal binding hook must NOT be removed until Phase 4. During transition, both hooks run.

### 12.5 HIGH: namespace_grant.email has no FK to user_setting

**Problem:** Grants can reference emails that don't exist in `user_setting`. Typos, case differences (`Troy@` vs `troy@`), and stale grants accumulate.

**Resolution:**
1. Add `REFERENCES user_setting(email)` FK constraint
2. Enforce email case normalization — `lower()` on insert/update
3. Add CHECK constraint: `email = lower(email)`

Updated schema:
```sql
CREATE TABLE namespace_grant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL REFERENCES user_setting(email) ON DELETE CASCADE,
  namespace   text NOT NULL CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63),
  role        text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member', 'observer')),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email)),
  UNIQUE(email, namespace)
);
```

Note: The FK to `user_setting(email)` means user provisioning (#1474) must create the `user_setting` row BEFORE creating grants. The `ON DELETE CASCADE` ensures grants are cleaned up if a user is deleted.

### 12.6 HIGH: Namespace validation at DB level

**Problem:** The namespace naming pattern (`^[a-z0-9][a-z0-9._-]*$`, max 63) is only defined as app-level convention. The migration SQL uses a bare `text NOT NULL DEFAULT 'default'` with no CHECK.

**Resolution:** Add CHECK constraint to the `namespace` column on all entity tables:
```sql
ALTER TABLE work_item ADD CONSTRAINT chk_work_item_namespace
  CHECK (namespace ~ '^[a-z0-9][a-z0-9._-]*$' AND length(namespace) <= 63);
```
Apply to all entity tables in the migration.

### 12.7 MEDIUM: Notification fanout and privacy

**Problem:** "All users with grant to namespace get notified" is too broad. A reminder for a work item assigned to Troy shouldn't notify Matty just because she also has household access.

**Resolution:** Notification routing uses **namespace + assignee/participant logic**, not namespace alone:
- **Assignee-specific notifications** (reminders, deadline warnings): only the assigned user(s)
- **Activity notifications** (new comment, status change): namespace members who are participants/watchers on the specific entity
- **System notifications** (namespace-wide announcements): all namespace members

The `notification.user_email` column stays as the explicit delivery target. The notification SERVICE resolves who to notify; the namespace is context, not the distribution list.

### 12.8 MEDIUM: Junction tables with two parents in different namespaces

**Problem:** `work_item_contact` links a work_item to a contact. If they're in different namespaces, which namespace does the junction row inherit?

**Resolution:** Junction tables don't get a `namespace` column. They inherit access from their parents:
- To CREATE a junction (e.g., link a contact to a work item), the user needs access to BOTH parent namespaces
- To READ a junction, the user needs access to at least ONE parent namespace (the junction appears when querying either parent)
- To DELETE a junction, same as create — access to both

### 12.9 MEDIUM: Immutable namespace may be too rigid

**Problem:** "Record's namespace is immutable (delete + recreate to move)" creates friction. A user might want to move a shopping list from `troy` to `household` without losing history.

**Resolution:** Add a `PATCH /api/<entity>/:id/namespace` endpoint (future work, not in this epic). For now, immutable is simpler and prevents accidental data movement. Document that namespace moves are planned post-MVP.

### 12.10 LOW: Dashboard UX — namespace switcher

**Problem:** The dashboard currently has no concept of namespaces. After this migration, users need to:
- See which namespace they're viewing
- Switch between namespaces
- See data from multiple namespaces simultaneously
- Know which namespace a record belongs to

**Resolution:** Dashboard UX changes (out of scope for this epic, but must be planned):
1. **Namespace indicator** in header/sidebar showing current namespace(s)
2. **Namespace picker** — dropdown or sidebar toggle to select active namespaces
3. **Namespace badge** on entity cards/rows showing which namespace they belong to
4. **"All namespaces" mode** — default view shows data from all granted namespaces
5. **Create-in-namespace** — when creating, show which namespace the new item will be in
6. Bootstrap data should include the user's namespace grants

### 12.11 Phase Exit Criteria

Each phase must meet specific criteria before the next begins:

**Phase 1 → Phase 2:**
- namespace_grant table exists and is populated
- All entity tables have namespace column
- Existing data migrated to per-user namespaces (not all in 'default')
- Namespace management API working with tests
- Auth middleware runs BOTH old principal binding AND new namespace binding

**Phase 2 → Phase 3:**
- Gateway config supports namespace.default and namespace.recall
- Plugin sends namespace params
- At least one entity (memory) fully migrated as proof of concept

**Phase 3 → Phase 4:**
- ALL entity routes migrated to namespace-based queries
- No routes use user_email for scoping (only attribution)
- E2E tests pass with namespace-only scoping
- Dashboard updated with namespace awareness

---

## 13. Pre-existing Issues Found During Audit

These are NOT part of Epic #1418 but were discovered:

1. **`X-Agent-Id` header is sent by plugin but ignored by server** — no effect
2. **Many routes completely unscoped** — activity, backlog, search, audit-log, files return ALL data
3. **`entity_link` GET/DELETE don't filter by user_email** — cross-user leak
4. **`pantry_item` queries inconsistent** — doesn't always filter
5. **`file_attachment` and `file_share` have no user scoping** — any user can access any file
6. **Webhook `agentId` conflated with `workItem.user_email`** — should use agent identity
7. **Principal binding hook only overrides EXISTING fields** — incomplete enforcement
8. **`resolveUserEmail()` defined but never called** — dead code
