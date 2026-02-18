# Skill Store API Reference

The Skill Store provides persistent, namespaced key-value-plus-document storage for OpenClaw skills. Skills can store configuration, cached results, structured data, and searchable content with automatic embedding generation for semantic search.

All endpoints require authentication via `Authorization: Bearer <token>` header.

---

## Concepts

| Concept | Description |
|---------|-------------|
| **skill_id** | Self-declared identifier for a skill. Alphanumeric, hyphens, underscores only. Max 100 characters. |
| **collection** | Logical grouping within a skill (e.g., `articles`, `config`). Defaults to `_default`. |
| **key** | Optional unique key within (skill_id, collection). When provided, enables upsert semantics. |
| **soft delete** | Items are marked with `deleted_at` rather than removed. Purged automatically after 30 days. |
| **TTL** | Items with `expires_at` are auto-cleaned every 15 minutes. Pinned items survive TTL cleanup. |

---

## Items

### Create or Upsert Item

**POST** `/api/skill-store/items`

Creates a new item, or updates an existing item if `key` is provided and a matching `(skill_id, collection, key)` already exists.

**Request Body:**

```json
{
  "skill_id": "news-collator",
  "collection": "articles",
  "key": "bbc-2024-01-15-tech",
  "title": "New AI Breakthrough Announced",
  "summary": "Researchers publish findings on...",
  "content": "Full article text here...",
  "data": {
    "source": "BBC",
    "author": "Jane Smith",
    "word_count": 1250
  },
  "tags": ["ai", "technology", "research"],
  "priority": 10,
  "media_url": "https://example.com/image.jpg",
  "media_type": "image/jpeg",
  "source_url": "https://bbc.co.uk/article/123",
  "user_email": "user@example.com",
  "expires_at": "2025-02-15T00:00:00Z",
  "pinned": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier (alphanumeric, hyphens, underscores, max 100 chars) |
| `collection` | string | No | Collection name (default: `_default`, max 200 chars) |
| `key` | string | No | Unique key within (skill_id, collection) for upsert (max 500 chars) |
| `title` | string | No | Item title (max 500 chars). Used in search with highest weight. |
| `summary` | string | No | Short summary (max 2000 chars). Used in search with medium weight. |
| `content` | string | No | Full content (max 50000 chars). Used in search with lowest weight. |
| `data` | object | No | Structured JSON payload (max 1MB serialized) |
| `tags` | string[] | No | Classification tags (max 50 tags, each max 100 chars) |
| `priority` | integer | No | Priority value 0-100 (default: 0) |
| `media_url` | string | No | URL to associated media |
| `media_type` | string | No | MIME type of the media |
| `source_url` | string | No | Original source URL |
| `user_email` | string | No | User scope for multi-user skills (null = shared) |
| `expires_at` | string | No | ISO 8601 TTL expiration timestamp |
| `pinned` | boolean | No | If true, survives TTL cleanup (default: false) |

**Response (201 Created)** -- new item:

```json
{
  "id": "019c1234-5678-7890-abcd-ef1234567890",
  "skill_id": "news-collator",
  "collection": "articles",
  "key": "bbc-2024-01-15-tech",
  "title": "New AI Breakthrough Announced",
  "summary": "Researchers publish findings on...",
  "content": "Full article text here...",
  "data": { "source": "BBC", "author": "Jane Smith", "word_count": 1250 },
  "media_url": "https://example.com/image.jpg",
  "media_type": "image/jpeg",
  "source_url": "https://bbc.co.uk/article/123",
  "status": "active",
  "tags": ["ai", "technology", "research"],
  "priority": 10,
  "expires_at": "2025-02-15T00:00:00.000Z",
  "pinned": false,
  "embedding_status": "pending",
  "user_email": "user@example.com",
  "created_by": null,
  "deleted_at": null,
  "created_at": "2025-01-15T10:30:00.000Z",
  "updated_at": "2025-01-15T10:30:00.000Z"
}
```

**Response (200 OK)** -- upserted (key existed):

Same shape as 201, with updated field values.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing `skill_id`, or `data` exceeds 1MB |
| 429 | Item or collection quota exceeded |

---

### Get Item by ID

**GET** `/api/skill-store/items/:id`

Retrieves a single item by UUID.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `include_deleted` | string | Set to `true` to include soft-deleted items |

**Response (200 OK):**

```json
{
  "id": "019c1234-5678-7890-abcd-ef1234567890",
  "skill_id": "news-collator",
  "collection": "articles",
  "key": "bbc-2024-01-15-tech",
  "title": "New AI Breakthrough Announced",
  "summary": "Researchers publish findings on...",
  "content": "Full article text here...",
  "data": { "source": "BBC" },
  "status": "active",
  "tags": ["ai", "technology"],
  "priority": 10,
  "expires_at": null,
  "pinned": false,
  "embedding_status": "complete",
  "user_email": null,
  "created_at": "2025-01-15T10:30:00.000Z",
  "updated_at": "2025-01-15T10:30:00.000Z"
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid UUID format |
| 404 | Item not found (or soft-deleted unless `include_deleted=true`) |

---

### Get Item by Composite Key

**GET** `/api/skill-store/items/by-key`

Retrieves a single item by its composite key `(skill_id, collection, key)`.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `collection` | string | No | Collection name (default: `_default`) |
| `key` | string | Yes | Item key |

**Response (200 OK):**

Same shape as Get by ID.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing `skill_id` or `key` |
| 404 | Item not found |

**Example:**

```bash
curl "https://api.example.com/api/skill-store/items/by-key?skill_id=news-collator&collection=articles&key=bbc-2024-01-15-tech" \
  -H "Authorization: Bearer $API_TOKEN"
```

---

### List Items

**GET** `/api/skill-store/items`

Lists items with filtering, sorting, and pagination.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `collection` | string | No | Filter by collection |
| `status` | string | No | Filter by status: `active`, `archived`, `processing` |
| `tags` | string | No | Comma-separated tags (items must contain ALL specified tags) |
| `since` | string | No | Filter items created at or after this ISO 8601 timestamp |
| `until` | string | No | Filter items created at or before this ISO 8601 timestamp |
| `user_email` | string | No | Filter by user email scope |
| `order_by` | string | No | Sort field: `created_at` (default), `updated_at`, `title`, `priority` |
| `limit` | integer | No | Page size (default: 50, max: 200) |
| `offset` | integer | No | Pagination offset (default: 0) |

**Response (200 OK):**

```json
{
  "items": [
    {
      "id": "019c1234-...",
      "skill_id": "news-collator",
      "collection": "articles",
      "key": "bbc-2024-01-15-tech",
      "title": "New AI Breakthrough Announced",
      "status": "active",
      "tags": ["ai", "technology"],
      "priority": 10,
      "created_at": "2025-01-15T10:30:00.000Z",
      "updated_at": "2025-01-15T10:30:00.000Z"
    }
  ],
  "total": 42,
  "has_more": true
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing `skill_id` |

**Example:**

```bash
curl "https://api.example.com/api/skill-store/items?skill_id=news-collator&collection=articles&tags=ai,technology&limit=10" \
  -H "Authorization: Bearer $API_TOKEN"
```

---

### Update Item

**PATCH** `/api/skill-store/items/:id`

Partially updates an existing item. Only provided fields are changed.

**Request Body:**

```json
{
  "title": "Updated Title",
  "status": "archived",
  "tags": ["ai", "updated"],
  "data": { "new_field": "value" },
  "priority": 50
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Updated title |
| `summary` | string | Updated summary |
| `content` | string | Updated content |
| `data` | object | Replaces entire data payload (max 1MB) |
| `tags` | string[] | Replaces entire tags array |
| `priority` | integer | Updated priority |
| `media_url` | string | Updated media URL |
| `media_type` | string | Updated media type |
| `source_url` | string | Updated source URL |
| `status` | string | New status: `active`, `archived`, `processing` |
| `user_email` | string | Updated user scope |
| `expires_at` | string | Updated TTL expiration |
| `pinned` | boolean | Updated pin status |

**Response (200 OK):**

Returns the full updated item.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid UUID, no fields to update, or `data` exceeds 1MB |
| 404 | Item not found |

---

### Delete Item

**DELETE** `/api/skill-store/items/:id`

Soft deletes an item by default. Use `?permanent=true` for hard delete.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `permanent` | string | Set to `true` for irreversible hard delete |

**Response:** `204 No Content`

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid UUID format |
| 404 | Item not found |

**Soft delete behavior:**

- Item gets a `deleted_at` timestamp but remains in the database.
- Soft-deleted items are excluded from list, search, and by-key lookups.
- Items can be viewed with `GET /api/skill-store/items/:id?include_deleted=true`.
- A pgcron job permanently purges soft-deleted items after 30 days.

---

### Bulk Create/Upsert

**POST** `/api/skill-store/items/bulk`

Creates or upserts up to 100 items in a single transaction. If any item fails validation, the entire batch is rolled back.

**Request Body:**

```json
{
  "items": [
    {
      "skill_id": "news-collator",
      "collection": "articles",
      "key": "article-1",
      "title": "First Article",
      "data": { "source": "BBC" }
    },
    {
      "skill_id": "news-collator",
      "collection": "articles",
      "key": "article-2",
      "title": "Second Article",
      "data": { "source": "CNN" }
    }
  ]
}
```

**Response (200 OK):**

```json
{
  "items": [
    { "id": "019c1234-...", "skill_id": "news-collator", "collection": "articles", "key": "article-1", "..." : "..." },
    { "id": "019c5678-...", "skill_id": "news-collator", "collection": "articles", "key": "article-2", "..." : "..." }
  ],
  "created": 2
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Empty items array, more than 100 items, or invalid item at specific index |

---

### Bulk Delete

**DELETE** `/api/skill-store/items/bulk`

Soft deletes multiple items matching filter criteria. Requires `skill_id` plus at least one additional filter to prevent accidental mass deletion.

**Request Body:**

```json
{
  "skill_id": "news-collator",
  "collection": "articles",
  "tags": ["outdated"],
  "status": "archived"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `collection` | string | No* | Filter by collection |
| `tags` | string[] | No* | Filter by tags (containment match) |
| `status` | string | No* | Filter by status |

*At least one of `collection`, `tags`, or `status` is required.

**Response (200 OK):**

```json
{
  "deleted": 15
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing `skill_id` or no additional filter provided |

---

### Archive Item

**POST** `/api/skill-store/items/:id/archive`

Sets an item's status to `archived`. Archived items remain queryable but are logically inactive.

**Response (200 OK):**

Returns the full updated item with `status: "archived"`.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid UUID format |
| 404 | Item not found |

---

## Search

### Full-Text Search

**POST** `/api/skill-store/search`

Searches items using PostgreSQL full-text search (tsvector). Results are ranked by relevance using `ts_rank` with weighted fields: title (A), summary (B), content (C).

**Request Body:**

```json
{
  "skill_id": "news-collator",
  "query": "artificial intelligence breakthrough",
  "collection": "articles",
  "tags": ["technology"],
  "status": "active",
  "user_email": "user@example.com",
  "limit": 20,
  "offset": 0
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `query` | string | Yes | Search query text |
| `collection` | string | No | Filter by collection |
| `tags` | string[] | No | Filter by tags |
| `status` | string | No | Filter by status |
| `user_email` | string | No | Filter by user scope |
| `limit` | integer | No | Max results (default: 20) |
| `offset` | integer | No | Pagination offset (default: 0) |

**Response (200 OK):**

```json
{
  "results": [
    {
      "id": "019c1234-...",
      "skill_id": "news-collator",
      "collection": "articles",
      "key": "bbc-2024-01-15-tech",
      "title": "New AI Breakthrough Announced",
      "summary": "Researchers publish findings on...",
      "content": "Full article text...",
      "data": {},
      "tags": ["ai", "technology"],
      "status": "active",
      "priority": 10,
      "user_email": null,
      "created_at": "2025-01-15T10:30:00.000Z",
      "updated_at": "2025-01-15T10:30:00.000Z",
      "relevance": 0.0891
    }
  ],
  "total": 5
}
```

---

### Semantic Search

**POST** `/api/skill-store/search/semantic`

Searches items using vector similarity (cosine distance) via pgvector. Falls back to ILIKE text search if embeddings are not configured. When `semantic_weight` is provided, uses hybrid search (Reciprocal Rank Fusion combining semantic + full-text results).

**Request Body:**

```json
{
  "skill_id": "news-collator",
  "query": "recent developments in machine learning",
  "collection": "articles",
  "min_similarity": 0.3,
  "semantic_weight": 0.7,
  "limit": 20,
  "offset": 0
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `query` | string | Yes | Search query (embedded and compared against stored vectors) |
| `collection` | string | No | Filter by collection |
| `tags` | string[] | No | Filter by tags |
| `status` | string | No | Filter by status |
| `user_email` | string | No | Filter by user scope |
| `min_similarity` | number | No | Minimum cosine similarity threshold 0-1 (default: 0.3) |
| `semantic_weight` | number | No | If set, enables hybrid search with this weight for semantic (0-1). Full-text weight = 1 - semantic_weight. |
| `limit` | integer | No | Max results (default: 20) |
| `offset` | integer | No | Pagination offset (default: 0) |

**Response (200 OK) -- pure semantic:**

```json
{
  "results": [
    {
      "id": "019c1234-...",
      "title": "New AI Breakthrough Announced",
      "similarity": 0.89,
      "..."
    }
  ],
  "search_type": "semantic",
  "query_embedding_provider": "openai"
}
```

**Response (200 OK) -- hybrid (when `semantic_weight` is provided):**

```json
{
  "results": [
    {
      "id": "019c1234-...",
      "title": "New AI Breakthrough Announced",
      "score": 0.0148,
      "fulltext_rank": 1,
      "semantic_rank": 2,
      "..."
    }
  ],
  "search_type": "hybrid",
  "semantic_weight": 0.7
}
```

**Response (200 OK) -- text fallback (when embeddings unavailable):**

```json
{
  "results": [
    {
      "id": "019c1234-...",
      "title": "New AI Breakthrough Announced",
      "similarity": 0.5,
      "..."
    }
  ],
  "search_type": "text"
}
```

---

## Collections

### List Collections

**GET** `/api/skill-store/collections`

Lists all collections for a skill with item counts and last activity timestamps.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `user_email` | string | No | Filter by user scope |

**Response (200 OK):**

```json
{
  "collections": [
    {
      "collection": "articles",
      "count": 42,
      "latest_at": "2025-01-15T10:30:00.000Z"
    },
    {
      "collection": "config",
      "count": 3,
      "latest_at": "2025-01-10T08:00:00.000Z"
    }
  ]
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing `skill_id` |

---

### Delete Collection

**DELETE** `/api/skill-store/collections/:name`

Soft deletes all items in a collection.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |

**Response (200 OK):**

```json
{
  "deleted": 42
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing `skill_id` |

---

## Aggregation

### Aggregate Items

**GET** `/api/skill-store/aggregate`

Runs simple aggregation operations on skill store items.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `operation` | string | Yes | One of: `count`, `count_by_tag`, `count_by_status`, `latest`, `oldest` |
| `collection` | string | No | Filter by collection |
| `since` | string | No | Filter items created at or after this ISO 8601 timestamp |
| `until` | string | No | Filter items created before this ISO 8601 timestamp |
| `user_email` | string | No | Filter by user scope |

**Response examples by operation:**

`count`:
```json
{ "result": { "count": 42 } }
```

`count_by_tag`:
```json
{ "result": { "tags": [{ "tag": "ai", "count": 15 }, { "tag": "tech", "count": 8 }] } }
```

`count_by_status`:
```json
{ "result": { "statuses": [{ "status": "active", "count": 35 }, { "status": "archived", "count": 7 }] } }
```

`latest`:
```json
{
  "result": {
    "item": {
      "id": "019c1234-...",
      "skill_id": "news-collator",
      "collection": "articles",
      "key": "latest-article",
      "title": "Most Recent Item",
      "status": "active",
      "created_at": "2025-01-15T10:30:00.000Z",
      "updated_at": "2025-01-15T10:30:00.000Z"
    }
  }
}
```

`oldest`:
```json
{ "result": { "item": { "..." } } }
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing `skill_id`, missing `operation`, or invalid operation value |

---

## Schedules

Schedules define recurring cron jobs that fire webhooks to OpenClaw for periodic skill processing (e.g., daily digest generation, data aggregation).

### Create Schedule

**POST** `/api/skill-store/schedules`

**Request Body:**

```json
{
  "skill_id": "news-collator",
  "collection": "articles",
  "cron_expression": "0 9 * * *",
  "timezone": "America/New_York",
  "webhook_url": "https://gateway.example.com/hooks/process-news",
  "webhook_headers": {
    "Authorization": "Bearer hook-token-123"
  },
  "payload_template": {
    "action": "generate_digest",
    "format": "email"
  },
  "enabled": true,
  "max_retries": 5
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `collection` | string | No | Scope schedule to a specific collection |
| `cron_expression` | string | Yes | Standard 5-field cron expression. Minimum interval: 5 minutes. |
| `timezone` | string | No | IANA timezone name (default: `UTC`) |
| `webhook_url` | string | Yes | URL called when schedule fires. Must be HTTPS in production. |
| `webhook_headers` | object | No | Headers sent with webhook request |
| `payload_template` | object | No | Template merged with runtime data (`skill_id`, `collection`, `schedule_id`, `triggered_at`) |
| `enabled` | boolean | No | Whether schedule is active (default: true) |
| `max_retries` | integer | No | Max consecutive failures before auto-disable (default: 5) |

**Cron expression constraints:**

- Must be exactly 5 fields: `minute hour day month weekday`
- Cannot fire more frequently than every 5 minutes (e.g., `*/3 * * * *` is rejected)
- `* * * * *` (every minute) is rejected

**Response (201 Created):**

```json
{
  "id": "019c1234-5678-7890-abcd-ef1234567890",
  "skill_id": "news-collator",
  "collection": "articles",
  "cron_expression": "0 9 * * *",
  "timezone": "America/New_York",
  "webhook_url": "https://gateway.example.com/hooks/process-news",
  "webhook_headers": { "Authorization": "Bearer hook-token-123" },
  "payload_template": { "action": "generate_digest", "format": "email" },
  "enabled": true,
  "max_retries": 5,
  "last_run_at": null,
  "next_run_at": null,
  "last_run_status": null,
  "created_at": "2025-01-15T10:30:00.000Z",
  "updated_at": "2025-01-15T10:30:00.000Z"
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing required fields, invalid cron expression, invalid timezone, or invalid webhook URL |
| 409 | Duplicate schedule (same skill_id + collection + cron_expression) |
| 429 | Schedule quota exceeded |

---

### List Schedules

**GET** `/api/skill-store/schedules`

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | No | Filter by skill identifier |
| `enabled` | string | No | Filter by enabled status (`true`/`false`) |
| `limit` | integer | No | Page size (default: 50, max: 100) |
| `offset` | integer | No | Pagination offset (default: 0) |

**Response (200 OK):**

```json
{
  "schedules": [
    {
      "id": "019c1234-...",
      "skill_id": "news-collator",
      "collection": "articles",
      "cron_expression": "0 9 * * *",
      "timezone": "America/New_York",
      "webhook_url": "https://gateway.example.com/hooks/process-news",
      "webhook_headers": {},
      "payload_template": {},
      "enabled": true,
      "max_retries": 5,
      "last_run_at": "2025-01-15T14:00:00.000Z",
      "next_run_at": "2025-01-16T14:00:00.000Z",
      "last_run_status": "success",
      "created_at": "2025-01-10T08:00:00.000Z",
      "updated_at": "2025-01-15T14:00:00.000Z"
    }
  ],
  "total": 3
}
```

---

### Update Schedule

**PATCH** `/api/skill-store/schedules/:id`

Partially updates a schedule. Only provided fields are changed.

**Request Body:**

```json
{
  "cron_expression": "0 */6 * * *",
  "webhook_url": "https://new-gateway.example.com/hooks/process",
  "enabled": true,
  "max_retries": 10
}
```

| Field | Type | Description |
|-------|------|-------------|
| `cron_expression` | string | Updated cron expression |
| `timezone` | string | Updated timezone |
| `webhook_url` | string | Updated webhook URL |
| `webhook_headers` | object | Updated webhook headers |
| `payload_template` | object | Updated payload template |
| `enabled` | boolean | Enable/disable schedule |
| `max_retries` | integer | Updated retry limit |

**Response (200 OK):**

Returns the full updated schedule.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid UUID, invalid cron expression, invalid timezone, invalid URL, or no fields to update |
| 404 | Schedule not found |

---

### Delete Schedule

**DELETE** `/api/skill-store/schedules/:id`

Permanently deletes a schedule (hard delete).

**Response:** `204 No Content`

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid UUID format |
| 404 | Schedule not found |

---

### Trigger Schedule

**POST** `/api/skill-store/schedules/:id/trigger`

Manually triggers a schedule immediately, regardless of its cron expression. Enqueues an internal job for processing.

**Response (202 Accepted):**

```json
{
  "job_id": "019c1234-5678-7890-abcd-ef1234567890",
  "message": "Schedule triggered, job enqueued for processing"
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid UUID format |
| 404 | Schedule not found |

---

### Pause Schedule

**POST** `/api/skill-store/schedules/:id/pause`

Disables a schedule (sets `enabled = false`).

**Response (200 OK):**

Returns the full schedule with `enabled: false`.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid UUID format |
| 404 | Schedule not found |

---

### Resume Schedule

**POST** `/api/skill-store/schedules/:id/resume`

Re-enables a paused schedule (sets `enabled = true`).

**Response (200 OK):**

Returns the full schedule with `enabled: true`.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid UUID format |
| 404 | Schedule not found |

---

## Admin Endpoints

These endpoints provide operational visibility into the Skill Store. They live under `/api/admin/skill-store/` and are intended for platform operators.

### Global Stats

**GET** `/api/admin/skill-store/stats`

Returns aggregate statistics across all skills.

**Response (200 OK):**

```json
{
  "total_items": 1250,
  "by_status": {
    "active": 1100,
    "archived": 130,
    "processing": 20
  },
  "by_skill": [
    { "skill_id": "news-collator", "count": 500 },
    { "skill_id": "shopping-list", "count": 350 },
    { "skill_id": "code-snippets", "count": 400 }
  ],
  "storage_estimate": {
    "total_bytes": 52428800
  }
}
```

---

### List Skills

**GET** `/api/admin/skill-store/skills`

Lists all registered skill_ids with item counts, collection counts, and last activity.

**Response (200 OK):**

```json
{
  "skills": [
    {
      "skill_id": "news-collator",
      "item_count": 500,
      "collection_count": 5,
      "last_activity": "2025-01-15T10:30:00.000Z"
    },
    {
      "skill_id": "shopping-list",
      "item_count": 350,
      "collection_count": 2,
      "last_activity": "2025-01-14T18:00:00.000Z"
    }
  ]
}
```

---

### Skill Detail

**GET** `/api/admin/skill-store/skills/:skill_id`

Detailed view of a single skill including item status breakdown, collections, embedding status, and schedules.

**Response (200 OK):**

```json
{
  "skill_id": "news-collator",
  "total_items": 500,
  "by_status": {
    "active": 450,
    "archived": 40,
    "processing": 10
  },
  "collections": [
    { "collection": "articles", "count": 400 },
    { "collection": "config", "count": 5 },
    { "collection": "digests", "count": 95 }
  ],
  "embedding_status": {
    "complete": 480,
    "pending": 15,
    "failed": 5
  },
  "schedules": [
    {
      "id": "019c1234-...",
      "collection": "articles",
      "cron_expression": "0 9 * * *",
      "timezone": "America/New_York",
      "enabled": true,
      "last_run_status": "success",
      "last_run_at": "2025-01-15T14:00:00.000Z",
      "next_run_at": "2025-01-16T14:00:00.000Z",
      "created_at": "2025-01-10T08:00:00.000Z"
    }
  ]
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 404 | Skill not found (no items exist for this skill_id) |

---

### Skill Quota Usage

**GET** `/api/admin/skill-store/skills/:skill_id/quota`

Returns quota usage vs. configured limits for a skill.

**Response (200 OK):**

```json
{
  "skill_id": "news-collator",
  "items": {
    "current": 500,
    "limit": 100000
  },
  "collections": {
    "current": 5,
    "limit": 1000
  },
  "schedules": {
    "current": 2,
    "limit": 20
  },
  "max_item_size_bytes": 1048576
}
```

Default quota limits (configurable via environment variables):

| Quota | Default | Environment Variable |
|-------|---------|---------------------|
| Items per skill | 100,000 | `SKILL_STORE_MAX_ITEMS_PER_SKILL` |
| Collections per skill | 1,000 | `SKILL_STORE_MAX_COLLECTIONS_PER_SKILL` |
| Schedules per skill | 20 | `SKILL_STORE_MAX_SCHEDULES_PER_SKILL` |
| Max item data size | 1 MB | `SKILL_STORE_MAX_ITEM_SIZE_BYTES` |

---

### Purge Skill

**DELETE** `/api/admin/skill-store/skills/:skill_id`

Hard deletes ALL data for a skill (items + schedules). Irreversible. Requires the `X-Confirm-Delete: true` header.

**Request Headers:**

| Header | Value | Required |
|--------|-------|----------|
| `X-Confirm-Delete` | `true` | Yes |

**Response (200 OK):**

```json
{
  "skill_id": "news-collator",
  "deleted_count": 500,
  "deleted_schedules": 2
}
```

**Error Responses:**

| Status | Description |
|--------|-------------|
| 400 | Missing `X-Confirm-Delete: true` header |
| 404 | Skill not found |

---

### Embedding Status

**GET** `/api/admin/skill-store/embeddings/status`

Returns embedding generation statistics across all skill store items.

**Response (200 OK):**

```json
{
  "total": 1250,
  "by_status": {
    "complete": 1200,
    "pending": 30,
    "failed": 20
  },
  "provider": "openai",
  "model": "text-embedding-3-small"
}
```

---

### Backfill Embeddings

**POST** `/api/admin/skill-store/embeddings/backfill`

Enqueues embedding generation jobs for items with `pending` or `failed` embedding status. Items are processed asynchronously by the job processor.

**Request Body:**

```json
{
  "batch_size": 100
}
```

| Field | Type | Description |
|-------|------|-------------|
| `batch_size` | integer | Number of items to process (default: 100, max: 1000) |

**Response (202 Accepted):**

```json
{
  "status": "completed",
  "enqueued": 30,
  "skipped": 5
}
```

`skipped` indicates items with no text content to embed.

---

## Plugin Tools

The OpenClaw plugin exposes these tools to agents. They wrap the REST API with validation, credential detection, and formatted output.

### skill_store_put

Stores or updates data in the skill store.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `collection` | string | No | Collection name |
| `key` | string | No | Unique key for upsert |
| `title` | string | No | Item title (max 500 chars) |
| `summary` | string | No | Short summary (max 2000 chars) |
| `content` | string | No | Full content (max 50000 chars) |
| `data` | object | No | Structured JSON payload (max 1MB) |
| `media_url` | string | No | URL to media (must be valid URL) |
| `media_type` | string | No | MIME type (max 100 chars) |
| `source_url` | string | No | Source URL (must be valid URL) |
| `tags` | string[] | No | Tags (max 50 items, each max 100 chars) |
| `priority` | integer | No | Priority 0-100 |
| `expires_at` | string | No | ISO 8601 expiration timestamp |
| `pinned` | boolean | No | Pin status |
| `user_email` | string | No | User scope email |

**Safety features:**
- Scans text fields for credential patterns (API keys, passwords, bearer tokens) and logs warnings.
- Sanitizes text to remove control characters.
- Validates data size before sending.

### skill_store_get

Retrieves an item by ID or composite key.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | No* | Item UUID |
| `skill_id` | string | No* | Skill identifier (for key lookup) |
| `collection` | string | No | Collection name (for key lookup) |
| `key` | string | No* | Item key (for key lookup) |

*Either `id` or (`skill_id` + `key`) must be provided.

### skill_store_list

Lists items with filtering and pagination.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `collection` | string | No | Filter by collection |
| `status` | string | No | Filter: `active`, `archived`, `processing` |
| `tags` | string[] | No | Filter by tags |
| `since` | string | No | ISO 8601 lower bound on created_at |
| `limit` | integer | No | Page size 1-200 |
| `offset` | integer | No | Pagination offset |
| `order_by` | string | No | Sort: `created_at`, `updated_at`, `title`, `priority` |
| `user_email` | string | No | Filter by user scope |

### skill_store_delete

Soft deletes an item by ID or composite key.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | No* | Item UUID |
| `skill_id` | string | No* | Skill identifier (for key lookup) |
| `collection` | string | No | Collection name (for key lookup) |
| `key` | string | No* | Item key (for key lookup) |

*Either `id` or (`skill_id` + `key`) must be provided.

### skill_store_search

Searches items by text or semantic similarity.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `query` | string | Yes | Search query |
| `collection` | string | No | Filter by collection |
| `tags` | string[] | No | Filter by tags (max 50) |
| `semantic` | boolean | No | If true, use semantic/vector search (default: full-text) |
| `min_similarity` | number | No | Minimum similarity threshold 0-1 (for semantic mode) |
| `limit` | integer | No | Max results 1-200 |
| `user_email` | string | No | Filter by user scope |

### skill_store_collections

Lists all collections for a skill with item counts.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `user_email` | string | No | Filter by user scope |

### skill_store_aggregate

Runs aggregation operations on skill store items.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill_id` | string | Yes | Skill identifier |
| `operation` | string | Yes | One of: `count`, `count_by_tag`, `count_by_status`, `latest`, `oldest` |
| `collection` | string | No | Filter by collection |
| `since` | string | No | ISO 8601 lower bound |
| `until` | string | No | ISO 8601 upper bound |
| `user_email` | string | No | Filter by user scope |
