# Design: Identity Model & Namespace Permissions

**Date:** 2026-02-22  
**Status:** Draft  
**Supersedes:** PR #1568 (M2M grant fix — dead code, `PluginRuntime` has no `.user`)  
**Related:** #1567, #1418 (namespace scoping epic)

---

## 1. Problem Statement

### 1.1 No link between auth identity and contact data

`user_setting` (the login entity with email, theme, timezone) and `contact` (the data entity with display_name, endpoints, relationships) are completely disconnected. A human who logs in as `troy@troykelly.com` has no connection to the contact record for "Troy Kelly". This means:

- Multi-email login is impossible (a user can only log in with `user_setting.email`)
- The system can't determine "which contact is this logged-in user?"
- Agent-side sender resolution (Telegram ID → human) requires manual mapping

### 1.2 M2M agents can't resolve humans

When an OpenClaw agent calls the API via M2M token, it sends `X-Agent-Id: troy`. The M2M JWT `sub` is `"openclaw-gateway"`. Neither maps to `user_setting.email` (`troy@troykelly.com`). PR #1568 attempted to send `X-User-Email` from the plugin, but `api.runtime` (`PluginRuntime` type) has no `.user` property — the header is never populated.

### 1.3 Roles conflate data access with permissions

`namespace_grant.role` (owner/admin/member/observer) tries to encode both "can this user see this data?" and "what can this user do in the UI?". This doesn't scale:

- Adding a new permission level requires schema changes and code updates
- A user might need different permission levels for different features (HA admin but contacts observer)
- Role hierarchy logic (`admin >= member`) adds complexity

### 1.4 No agent namespace scoping

All agents share one M2M token (`sub: "openclaw-gateway"`, `scope: "api:full"`). Every agent sees everything. There's no mechanism to restrict agent "forge" to namespace "dev" while agent "troy" sees "troy" and "tmt".

---

## 2. Design

### 2.1 Core Entities

**Human** (`user_setting`): An auth identity that can log into the platform.

- Retains `email` as primary/bootstrap login identifier
- Gains `contact_id` (nullable FK → `contact`) for linking to a contact record
- One human → at most one contact. One contact → at most one human.

**Contact** (`contact`): A data entity representing a person, organisation, group, or agent.

- Lives in a namespace (defaults to `default`)
- Has zero or more `contact_endpoint` records (email, phone, telegram, etc.)
- Has zero or more relationships with other contacts
- May or may not be linked to a human (most contacts won't be)

**Namespace Grant** (`namespace_grant`): A human's membership in a namespace with an access level.

- `access` column: `read` or `readwrite` (replaces the old 4-level `role` column).
  - `read`: Can view data in the namespace. Cannot create, update, or delete.
  - `readwrite`: Full CRUD on data in the namespace.
- `is_home` flag (one per human) — the default namespace for that human's data.
- Platform-level permissions (admin UIs, HA config, etc.) are controlled by membership in config-defined permission namespaces — these don't need access levels since membership implies the permission.

### 2.2 Auth-Linked Contacts Must Be in `default`

Any contact linked to a `user_setting` (i.e. a contact that represents a human who can log in) **must** live in the `default` namespace. This:

- Solves the chicken-and-egg: auth lookup only queries `default`, no cross-namespace bypass needed
- Ensures all login-capable contacts are globally visible (appropriate for the trust level of running OpenClaw)
- Is enforced by a DB constraint or application-level validation on the `user_setting.contact_id` FK

### 2.3 Authentication Flow

**Primary flow** (human with linked contact):

```
Login email
  → contact_endpoint lookup (namespace='default', endpoint_type='email',
      normalized_value=<email>, is_login_eligible=true)
  → contact.id
  → user_setting (WHERE contact_id = contact.id)
  → namespace_grant (all memberships for this human)
  → Dashboard session
```

**Bootstrap flow** (human without linked contact):

```
Login email
  → user_setting (WHERE email = <login_email>)
  → namespace_grant (all memberships for this human)
  → Dashboard session
```

The system tries the primary flow first, falls back to bootstrap.

**Login-eligible endpoints:** Not every email endpoint on an auth-linked contact grants login access. The `contact_endpoint` table gains an `is_login_eligible` boolean (default `false`). Only endpoints explicitly marked as login-eligible are used in the auth lookup. This prevents a scenario where adding a work email to a contact inadvertently creates a new login path.

Setting `is_login_eligible = true` is a privileged operation — requires the human themselves (via authenticated session) or a platform admin. The bootstrap migration auto-marks the endpoint matching `user_setting.email` as login-eligible.

### 2.4 Namespace-Based Permissions

Permissions are defined in **platform configuration**, not database schema.

```jsonc
{
  "permissions": {
    "platform_admin": {
      "namespace": "admins",
      "description": "Full platform administration"
    },
    "ha_admin": {
      "namespace": "home-assistant-admins",
      "description": "Configure HA integrations, reconnect services"
    },
    "ha_user": {
      "namespace": "home-assistant-users",
      "description": "Set location entity, view HA dashboards"
    }
  }
}
```

**Permission check:** Is the human a member of the namespace defined for that permission?

**Benefits:**

- Adding a permission level = create a namespace + add a config entry. No migrations.
- A human in multiple permission-namespaces gets the union of permissions.
- Auditing: list namespace members to see who has what access.
- Permissions are orthogonal to data namespaces (you can be in "ha-admin" for permissions AND "troy" for your data).

### 2.5 Human Home Namespace

Each human has exactly one namespace flagged as `is_home`. This determines:

- Where their data goes by default (when creating todos, memories, contacts, etc. without an explicit namespace)
- The pre-selected namespace in the dashboard UI's namespace picker

The home namespace is set on the `namespace_grant` record. The existing unique partial index `(email) WHERE is_default = true` enforces the one-per-human constraint (renamed to `is_home`).

### 2.6 Agent Namespace Awareness

Each agent has a default namespace from its config (e.g., agent "tmt" defaults to namespace "tmt").

**Sender resolution flow** (in group chats or direct messages):

1. Message arrives from sender (e.g., Telegram ID `2077788301`)
2. Agent resolves: sender ID → `contact_endpoint` (in `default`) → `contact` → linked `user_setting` → namespace grants including home
3. Agent now knows: "Troy said this, his home namespace is `troy`, we're in context where my default is `tmt`"
4. Agent decides based on content:
   - Personal action ("remind me to call the vet") → Troy's home namespace
   - Group-relevant ("we all loved that movie") → agent's default namespace (TMT)
   - Explicit ("save this in the TMT namespace") → as specified

This is agent judgment, not hard-coded rules. The infrastructure provides the data; the agent makes the call.

### 2.7 Agent Scoping (Future — Not In Scope)

Currently: single M2M token with `api:full`, shared by all agents. Future work may add per-agent tokens or agent-specific namespace grants. Not addressed in this design.

---

## 3. Schema Changes

### 3.1 `user_setting` — Add Contact Link

```sql
ALTER TABLE user_setting
  ADD COLUMN contact_id uuid REFERENCES contact(id) ON DELETE SET NULL;

-- Enforce 1:1 (at most one human per contact)
CREATE UNIQUE INDEX idx_user_setting_contact_id
  ON user_setting(contact_id) WHERE contact_id IS NOT NULL;
```

Application-level validation: when setting `contact_id`, verify the contact's namespace is `default`.

### 3.2 `namespace_grant` — Replace Role with Access Level, Rename is_default

```sql
-- Replace 4-level role with 2-level access
ALTER TABLE namespace_grant DROP COLUMN role;
ALTER TABLE namespace_grant ADD COLUMN access text NOT NULL DEFAULT 'readwrite'
  CHECK (access IN ('read', 'readwrite'));

-- Rename for clarity
ALTER TABLE namespace_grant RENAME COLUMN is_default TO is_home;

-- Rename indexes
ALTER INDEX idx_namespace_grant_default RENAME TO idx_namespace_grant_home;
```

**Migration mapping:** `owner` → `readwrite`, `admin` → `readwrite`, `member` → `readwrite`, `observer` → `read`.

### 3.3 Bootstrap Migration — Link Existing Humans to Contacts

```sql
-- Auto-link user_setting records to contacts that have a matching email endpoint in 'default'
UPDATE user_setting us
SET contact_id = c.id
FROM contact_endpoint ce
JOIN contact c ON c.id = ce.contact_id AND c.namespace = 'default'
WHERE ce.endpoint_type = 'email'
  AND ce.normalized_value = lower(us.email)
  AND us.contact_id IS NULL
  -- If multiple contacts match, pick the one updated most recently
  AND c.id = (
    SELECT c2.id FROM contact c2
    JOIN contact_endpoint ce2 ON ce2.contact_id = c2.id
    WHERE ce2.endpoint_type = 'email'
      AND ce2.normalized_value = lower(us.email)
      AND c2.namespace = 'default'
    ORDER BY c2.updated_at DESC
    LIMIT 1
  );
```

---

## 4. Server Changes

### 4.1 Auth Middleware

- `getAuthIdentity()`: Add contact-endpoint-based resolution. After JWT verification, if `identity.type === 'user'`, also resolve their `contact_id` and full namespace memberships.
- New helper: `resolveHumanByEmail(email)` — tries contact_endpoint lookup in `default` (where `is_login_eligible = true`), falls back to `user_setting.email`.
- **Performance:** The resolved identity (email → contact → user_setting → grants) should be cached with a short TTL (60s). The contact-to-user mapping changes rarely. This avoids 4 extra queries per authenticated request.

### 4.2 Namespace Create (M2M Path)

Replace the current `X-User-Email` / `X-Agent-Id` fallback chain with sender resolution:

- Agent sends `X-Agent-Id` (agent name) and `X-Sender-Id` (sender's channel identifier, e.g., Telegram user ID)
- Server resolves `X-Sender-Id` → contact_endpoint → contact → user_setting → use that human's email for the grant
- Fallback: if no sender can be resolved, log a warning and skip the owner grant (same as current behavior for unknown users)

### 4.3 Permission Checks

New utility: `hasPermission(humanEmail, permissionName, config)`:

1. Look up `config.permissions[permissionName].namespace`
2. Check if `namespace_grant` exists for that human + namespace
3. Return boolean

### 4.4 All Existing Role Checks

Audit and update all code that currently checks `namespace_grant.role`. Replace with either:

- Simple membership check (most cases)
- Permission namespace check (for admin-level operations)

---

## 5. Plugin Changes

### 5.1 Sender Identity in API Requests

Plugin should send the sender's channel-specific ID (e.g., Telegram user ID) via `X-Sender-Id` header. This enables the server to resolve the sender → human chain.

The plugin already has access to `context.messageChannel` (the channel name) and could access sender metadata from the message context. Specific implementation depends on OpenClaw SDK exposing sender identity to plugins — may require an OpenClaw SDK change or a new header.

### 5.2 Namespace Selection Logic

No plugin schema change needed. The agent's existing namespace selection logic (`getStoreNamespace()`) continues to work. The agent makes context-aware decisions about which namespace to target based on its own judgment.

---

## 6. Impact on Existing Code

### 6.1 Breaking Changes

This is a greenfields redesign. The following will break and must be updated in the same release:

- `namespace_grant.role` → replaced by `access` (`read`/`readwrite`)
- `namespace_grant.is_default` → renamed to `is_home`
- All API responses returning namespace grants must reflect the new shape
- All frontend components displaying/checking roles must be updated
- All server-side permission checks must switch from role-based to access-level + permission-namespace checks
- OpenAPI schemas must be updated

### 6.2 Non-Breaking Changes

- `user_setting.contact_id` is nullable — existing records continue to work
- Bootstrap login flow (direct `user_setting.email` match) is preserved as fallback
- Contact data model changes are additions only

---

## 7. Open Questions

1. **Config storage for permissions**: File-based config (alongside openclaw.json)? DB table? Environment variable? File-based is simplest and aligns with how OpenClaw config works.

2. **SDK sender identity**: Does the OpenClaw plugin SDK expose the message sender's ID to plugins? If not, this requires an upstream SDK change. The plugin could alternatively embed sender ID in a custom header based on available message context.

## 8. Security Notes

**M2M token trust model:** The M2M token (`sub: "openclaw-gateway"`, `scope: "api:full"`) is a trusted infrastructure credential. Any process with this token can act as any user via `X-Sender-Id` or `X-Agent-Id`. This is by design — the M2M token is equivalent to database admin access. If compromised, all API operations are exposed regardless of namespace scoping. Protection is at the infrastructure level (token storage, network isolation), not the API level.

**`is_login_eligible` on contact endpoints:** Adding an email endpoint to a contact is a normal data operation. Making that endpoint login-eligible is a **privileged operation** — it grants authentication capability. The `is_login_eligible` flag on `contact_endpoint` separates these concerns. Only the human themselves (authenticated session) or a platform admin can set this flag.
