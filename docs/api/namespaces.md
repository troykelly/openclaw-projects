# Namespace API Reference

This document covers the namespace management API endpoints. All endpoints are relative to the `/api` prefix.

## Authentication

All namespace endpoints require authentication via session cookie (user) or M2M JWT token.

**M2M `api:full` scope:** M2M tokens with the `api:full` scope bypass per-user namespace access checks on read operations. This enables OpenClaw agents to orchestrate across all namespaces. Admin mutations (invite, update, remove) still require an explicit `readwrite` grant.

---

## Endpoints

### List Namespaces

**GET** `/namespaces`

Returns namespaces the authenticated user has access to. M2M tokens with `api:full` scope return all namespaces across all users.

**Response (200):** Array of grant objects.

```json
[
  {
    "namespace": "acme",
    "access": "readwrite",
    "is_home": true,
    "priority": 50,
    "created_at": "2026-01-15T10:30:00.000Z"
  },
  {
    "namespace": "beta-project",
    "access": "read",
    "is_home": false,
    "priority": 0,
    "created_at": "2026-02-01T14:00:00.000Z"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `namespace` | string | Namespace identifier |
| `access` | string | Access level: `read` or `readwrite` |
| `is_home` | boolean | Whether this is the user's home namespace |
| `priority` | integer | Sort priority (0-100, higher = more important) |
| `created_at` | string | ISO 8601 timestamp of grant creation |

**Ordering:** Results are ordered by `priority DESC`, then `namespace ASC`.

---

### Create Namespace

**POST** `/namespaces`

Create a new namespace. The creator automatically receives a `readwrite` grant.

**Request Body:**

```json
{
  "name": "my-project"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Namespace name (see validation rules below) |

**Namespace Name Validation:**
- Must match pattern: `^[a-z0-9][a-z0-9._-]*$`
- Maximum 63 characters
- Must start with a lowercase letter or digit
- May contain lowercase letters, digits, dots, hyphens, underscores

**Response (201 Created):**

```json
{
  "namespace": "my-project",
  "created": true
}
```

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "name is required" }` | Missing or empty name |
| 400 | `{ "error": "<validation message>" }` | Name fails validation |
| 409 | `{ "error": "namespace 'x' already exists" }` | Namespace already has grants |

**M2M Behavior:** M2M tokens use the `X-User-Email` header (preferred) or `X-Agent-Id` header to determine which user receives the owner grant. The target user must exist in `user_setting`.

---

### Get Namespace Detail

**GET** `/namespaces/:ns`

Returns namespace details including all member grants. Requires the caller to have any access level to the namespace.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `ns` | string | Namespace identifier (URL-encoded) |

**Response (200):**

```json
{
  "namespace": "acme",
  "members": [
    {
      "id": "019502ab-1234-7000-8000-abcdef012345",
      "email": "alice@example.com",
      "namespace": "acme",
      "access": "readwrite",
      "is_home": true,
      "created_at": "2026-01-15T10:30:00.000Z",
      "updated_at": "2026-01-15T10:30:00.000Z"
    }
  ],
  "member_count": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `namespace` | string | Namespace identifier |
| `members` | array | Array of member grant objects |
| `member_count` | integer | Total number of members |

**Member Object:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Grant UUID |
| `email` | string | Member's email address |
| `namespace` | string | Namespace identifier |
| `access` | string | Access level: `read` or `readwrite` |
| `is_home` | boolean | Whether this namespace is the member's home |
| `created_at` | string | ISO 8601 timestamp |
| `updated_at` | string | ISO 8601 timestamp |

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 403 | `{ "error": "No access to namespace" }` | User has no grant for this namespace |

---

### List Namespace Grants

**GET** `/namespaces/:ns/grants`

Returns the same grant data as the detail endpoint but as a plain array. Requires any access level.

**Response (200):** Array of member grant objects (same shape as `members` in the detail endpoint).

---

### Invite Member (Create/Update Grant)

**POST** `/namespaces/:ns/grants`

Grant access to a user. If the user already has a grant, it is updated (upsert). Requires `readwrite` access.

**Request Body:**

```json
{
  "email": "bob@example.com",
  "access": "read",
  "is_home": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | User's email address (must exist in `user_setting`) |
| `access` | string | No | Access level: `read` or `readwrite` (default: `readwrite`) |
| `is_home` | boolean | No | Set as user's home namespace (default: `false`) |

**Response (201 Created):** The created/updated grant object.

```json
{
  "id": "019502ab-1234-7000-8000-abcdef012345",
  "email": "bob@example.com",
  "namespace": "acme",
  "access": "read",
  "is_home": false,
  "created_at": "2026-03-10T12:00:00.000Z",
  "updated_at": "2026-03-10T12:00:00.000Z"
}
```

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "email is required" }` | Missing email |
| 400 | `{ "error": "access must be one of: read, readwrite" }` | Invalid access level |
| 403 | `{ "error": "No access to namespace" }` | Caller has no grant |
| 403 | `{ "error": "Requires readwrite access to manage grants" }` | Caller has read-only access |
| 404 | `{ "error": "user 'x' not found" }` | Target email not in `user_setting` |

**Note:** Setting `is_home: true` automatically unsets any existing home namespace for that user.

---

### Update Grant

**PATCH** `/namespaces/:ns/grants/:id`

Update access level, home flag, or priority for an existing grant. Requires `readwrite` access.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `ns` | string | Namespace identifier |
| `id` | string | Grant UUID |

**Request Body:** At least one field required.

```json
{
  "access": "readwrite",
  "is_home": true,
  "priority": 75
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `access` | string | No | New access level: `read` or `readwrite` |
| `is_home` | boolean | No | Set as user's home namespace |
| `priority` | integer | No | Sort priority (0-100) |

**Response (200):** The updated grant object.

```json
{
  "id": "019502ab-1234-7000-8000-abcdef012345",
  "email": "bob@example.com",
  "namespace": "acme",
  "access": "readwrite",
  "is_home": true,
  "priority": 75,
  "created_at": "2026-01-15T10:30:00.000Z",
  "updated_at": "2026-03-10T12:05:00.000Z"
}
```

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "access, is_home, or priority is required" }` | No fields provided |
| 400 | `{ "error": "access must be one of: read, readwrite" }` | Invalid access level |
| 400 | `{ "error": "priority must be an integer between 0 and 100" }` | Invalid priority |
| 403 | `{ "error": "Requires readwrite access to manage grants" }` | Insufficient access |
| 404 | `{ "error": "Grant not found" }` | Grant ID not found in namespace |

---

### Remove Grant

**DELETE** `/namespaces/:ns/grants/:id`

Revoke a user's access to a namespace. Requires `readwrite` access.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `ns` | string | Namespace identifier |
| `id` | string | Grant UUID |

**Response (200):**

```json
{
  "deleted": true
}
```

**Error Responses:**

| Status | Body | Condition |
|--------|------|-----------|
| 403 | `{ "error": "Requires readwrite access to manage grants" }` | Insufficient access |
| 404 | `{ "error": "Grant not found" }` | Grant ID not found in namespace |

---

## Settings Endpoints (Namespace-Related)

### GET /settings

Returns the user's settings. Relevant namespace-related fields:

| Field | Type | Description |
|-------|------|-------------|
| `active_namespaces` | string[] or null | User's selected active namespaces (planned in #2348) |
| `active_namespaces_sanitized` | string[] or null | Server-validated active namespaces with invalid entries removed (planned in #2348) |

### PATCH /settings

Update user settings. The `active_namespaces` field (planned in #2348) will accept an array of namespace identifiers to persist the user's multi-namespace selection.

**Note:** The `active_namespaces_sanitized` field is read-only and computed by the server by filtering `active_namespaces` against the user's actual grants.
