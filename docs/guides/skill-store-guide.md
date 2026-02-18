# Skill Store Developer Guide

This guide walks through building OpenClaw skills that use the Skill Store for persistent state, searchable content, and scheduled processing.

## What Is the Skill Store?

The Skill Store is a namespaced, persistent storage service for OpenClaw skills. It replaces ad-hoc file-based storage (JSON files, workspace markdown) with a proper database-backed system that supports:

- **Key-value storage** with upsert semantics
- **Full-text search** across stored content
- **Semantic search** using pgvector embeddings
- **Collection-based organization** within each skill
- **TTL expiration** with automatic cleanup
- **Scheduled processing** via cron webhooks
- **Multi-user isolation** for skills serving multiple users

Skills interact with the Skill Store through either the REST API directly or via the OpenClaw plugin tools (recommended for agent-facing operations).

---

## Getting Started

### Storing Your First Item

Every skill store operation requires a `skill_id` -- a self-declared identifier for your skill. This is the namespace that isolates your data from other skills.

Using the plugin tool:

```
skill_store_put({
  skill_id: "my-weather-skill",
  collection: "forecasts",
  key: "sydney-2025-01-15",
  title: "Sydney Weather Forecast",
  summary: "Sunny, 28C high, 19C low",
  data: {
    high_c: 28,
    low_c: 19,
    conditions: "sunny",
    humidity: 45
  },
  tags: ["weather", "sydney", "australia"]
})
```

Using the REST API directly:

```bash
curl -X POST https://api.example.com/api/skill-store/items \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "skill_id": "my-weather-skill",
    "collection": "forecasts",
    "key": "sydney-2025-01-15",
    "title": "Sydney Weather Forecast",
    "summary": "Sunny, 28C high, 19C low",
    "data": {
      "high_c": 28,
      "low_c": 19,
      "conditions": "sunny",
      "humidity": 45
    },
    "tags": ["weather", "sydney", "australia"]
  }'
```

### Retrieving Items

By composite key (recommended for known items):

```
skill_store_get({
  skill_id: "my-weather-skill",
  collection: "forecasts",
  key: "sydney-2025-01-15"
})
```

By UUID:

```
skill_store_get({
  id: "019c1234-5678-7890-abcd-ef1234567890"
})
```

### Listing Items

```
skill_store_list({
  skill_id: "my-weather-skill",
  collection: "forecasts",
  tags: ["sydney"],
  limit: 10,
  order_by: "created_at"
})
```

### Deleting Items

By key:

```
skill_store_delete({
  skill_id: "my-weather-skill",
  collection: "forecasts",
  key: "sydney-2025-01-15"
})
```

This performs a soft delete. The item is hidden from queries but can be recovered within 30 days.

---

## Key-Value Patterns

The Skill Store replaces JSON file storage with proper database-backed key-value semantics. The `(skill_id, collection, key)` tuple acts as a composite primary key with upsert behavior.

### Replacing JSON File Storage

**Before (file-based):**

```python
# Read config
with open("config.json") as f:
    config = json.load(f)

# Update config
config["last_run"] = datetime.now().isoformat()

# Write config
with open("config.json", "w") as f:
    json.dump(config, f)
```

**After (Skill Store):**

```
# Read config
skill_store_get({
  skill_id: "my-skill",
  collection: "config",
  key: "settings"
})

# Update config (upsert)
skill_store_put({
  skill_id: "my-skill",
  collection: "config",
  key: "settings",
  data: {
    last_run: "2025-01-15T10:30:00Z",
    output_format: "markdown",
    max_results: 50
  }
})
```

### Common Key-Value Patterns

**Singleton configuration:**

```
skill_store_put({
  skill_id: "my-skill",
  collection: "config",
  key: "settings",
  data: { theme: "dark", language: "en", notifications: true }
})
```

**Per-entity state tracking:**

```
skill_store_put({
  skill_id: "rss-reader",
  collection: "feed-state",
  key: "https://example.com/feed.xml",
  data: {
    last_fetched: "2025-01-15T10:30:00Z",
    last_etag: "abc123",
    item_count: 42
  }
})
```

**Cache with TTL:**

```
skill_store_put({
  skill_id: "api-cache",
  collection: "responses",
  key: "weather-api-sydney",
  data: { temperature: 28, conditions: "sunny" },
  expires_at: "2025-01-15T11:30:00Z"
})
```

---

## Collection Organization Strategies

Collections are logical groupings within a skill. Use them to separate different types of data.

### Recommended Patterns

**By data type:**

```
my-skill/
  config/       -- skill configuration
  cache/        -- temporary cached data with TTL
  results/      -- processed results
  logs/         -- activity logs
```

**By source (for aggregation skills):**

```
news-collator/
  bbc/          -- articles from BBC
  reuters/      -- articles from Reuters
  techcrunch/   -- articles from TechCrunch
  digests/      -- generated digest outputs
```

**By time period:**

```
analytics/
  2025-01/      -- January data
  2025-02/      -- February data
  summaries/    -- cross-period summaries
```

**By user (when combined with `user_email`):**

```
shopping-list/
  groceries/    -- scoped by user_email
  hardware/     -- scoped by user_email
```

### Listing Your Collections

```
skill_store_collections({
  skill_id: "my-skill"
})
```

Returns each collection with its item count, helping you understand your data distribution.

### Collection Cleanup

Soft delete an entire collection:

```bash
curl -X DELETE "https://api.example.com/api/skill-store/collections/old-data?skill_id=my-skill" \
  -H "Authorization: Bearer $API_TOKEN"
```

---

## Search Patterns

The Skill Store supports three search modes, each suited to different needs.

### Full-Text Search

Uses PostgreSQL tsvector for keyword matching with relevance ranking. Best for exact keyword lookups.

```
skill_store_search({
  skill_id: "news-collator",
  query: "artificial intelligence regulation",
  collection: "articles"
})
```

The search is performed against a pre-built search vector with weighted fields:
- **Title** (weight A -- highest relevance)
- **Summary** (weight B -- medium relevance)
- **Content** (weight C -- lowest relevance)

### Semantic Search

Uses pgvector embeddings for meaning-based similarity search. Best for finding conceptually related items even when they don't share exact keywords.

```
skill_store_search({
  skill_id: "news-collator",
  query: "impact of machine learning on healthcare",
  semantic: true,
  min_similarity: 0.4
})
```

**How it works:**

1. The query is embedded using the configured embedding provider (OpenAI, VoyageAI, or Gemini).
2. The resulting vector is compared against stored item embeddings using cosine similarity.
3. Results above the `min_similarity` threshold are returned, sorted by similarity.

**Graceful fallback:** If the embedding service is unavailable or not configured, semantic search falls back to ILIKE text matching. The response includes `search_type: "text"` to indicate the fallback.

### Hybrid Search

Combines full-text and semantic results using Reciprocal Rank Fusion (RRF). Use the REST API directly for hybrid search:

```bash
curl -X POST https://api.example.com/api/skill-store/search/semantic \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "skill_id": "news-collator",
    "query": "climate change policy",
    "semantic_weight": 0.7,
    "min_similarity": 0.3,
    "limit": 20
  }'
```

The `semantic_weight` parameter controls the balance:
- `0.7` (default): 70% semantic, 30% full-text
- `1.0`: pure semantic
- `0.0`: pure full-text
- `0.5`: equal weight

Each result includes `fulltext_rank` and `semantic_rank` so you can understand why items were ranked.

### Choosing the Right Search Mode

| Scenario | Mode | Why |
|----------|------|-----|
| User typed exact keywords | Full-text | Precise keyword matching |
| User described what they want | Semantic | Meaning-based, handles synonyms |
| General-purpose search | Hybrid | Best of both worlds |
| Quick exact-key lookup | `skill_store_get` with key | Not a search -- direct retrieval |

---

## TTL and Lifecycle Management

### Automatic Expiration

Set `expires_at` on items that should be automatically cleaned up:

```
skill_store_put({
  skill_id: "api-cache",
  collection: "responses",
  key: "weather-current",
  data: { temperature: 28 },
  expires_at: "2025-01-15T11:00:00Z"
})
```

A pgcron job runs every 15 minutes to delete expired items (up to 5,000 per batch).

### Pinning Important Items

Pinned items survive TTL cleanup:

```
skill_store_put({
  skill_id: "api-cache",
  collection: "responses",
  key: "critical-config",
  data: { api_endpoint: "https://..." },
  expires_at: "2025-01-15T11:00:00Z",
  pinned: true
})
```

The `expires_at` is ignored for pinned items during cleanup.

### Item Status Lifecycle

Items have three statuses:

| Status | Meaning |
|--------|---------|
| `active` | Default. Item is live and queryable. |
| `archived` | Logically inactive but still searchable. Use for items that are no longer current but should be preserved. |
| `processing` | Item is being processed (e.g., waiting for enrichment). |

Archive an item:

```bash
curl -X POST https://api.example.com/api/skill-store/items/{id}/archive \
  -H "Authorization: Bearer $API_TOKEN"
```

### Soft Delete and Recovery

Soft-deleted items:
- Are hidden from list, search, and by-key lookups.
- Can still be retrieved with `GET /api/skill-store/items/:id?include_deleted=true`.
- Are permanently purged after 30 days by an automatic pgcron job.

---

## Multi-User Isolation

When a skill serves multiple users, set `user_email` to scope items per user:

```
// Store for user A
skill_store_put({
  skill_id: "shopping-list",
  collection: "groceries",
  key: "milk",
  title: "Whole milk",
  user_email: "alice@example.com"
})

// Store for user B
skill_store_put({
  skill_id: "shopping-list",
  collection: "groceries",
  key: "milk",
  title: "Oat milk",
  user_email: "bob@example.com"
})
```

These are separate items because the `user_email` differs. Both can have the same `(skill_id, collection, key)`.

**Query with user scope:**

```
skill_store_list({
  skill_id: "shopping-list",
  collection: "groceries",
  user_email: "alice@example.com"
})
```

**Shared items:** Items with `user_email: null` are visible to all users of the skill (e.g., shared configuration, reference data).

---

## Scheduled Processing

Schedules let you set up recurring cron jobs that fire webhooks to your OpenClaw gateway. This is useful for periodic data processing, digest generation, cleanup, and more.

### Creating a Schedule

```bash
curl -X POST https://api.example.com/api/skill-store/schedules \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "skill_id": "news-collator",
    "collection": "articles",
    "cron_expression": "0 9 * * 1-5",
    "timezone": "America/New_York",
    "webhook_url": "https://gateway.example.com/hooks/generate-digest",
    "webhook_headers": {
      "Authorization": "Bearer hook-secret"
    },
    "payload_template": {
      "action": "generate_digest",
      "format": "email",
      "max_articles": 20
    }
  }'
```

This schedule fires at 9:00 AM Eastern on weekdays.

### How Schedule Execution Works

1. **pgcron** runs every minute and checks for due schedules.
2. When a schedule is due, an `internal_job` is enqueued with job kind `skill_store.scheduled_process`.
3. The job processor sends an HTTP POST to the `webhook_url` with the payload.
4. The payload includes both your `payload_template` and runtime data (`skill_id`, `collection`, `schedule_id`, `triggered_at`).
5. `last_run_status` and `last_run_at` are updated on the schedule.

### Cron Expression Examples

| Expression | Meaning |
|------------|---------|
| `0 9 * * *` | Daily at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/15 * * * *` | Every 15 minutes |
| `0 */6 * * *` | Every 6 hours |
| `0 0 1 * *` | First day of each month at midnight |
| `30 14 * * 3` | Wednesdays at 2:30 PM |

**Minimum interval:** 5 minutes. Expressions like `*/3 * * * *` or `* * * * *` are rejected.

### Timezone Support

Schedules support IANA timezone names:

```json
{
  "timezone": "America/New_York"
}
```

```json
{
  "timezone": "Australia/Sydney"
}
```

```json
{
  "timezone": "Europe/London"
}
```

The default timezone is `UTC`.

### Retry Behavior

When the webhook request fails, the schedule tracks failure count. The `max_retries` field (default: 5) controls how many consecutive failures are allowed before the system stops attempting the schedule.

### Manual Triggering

Trigger a schedule immediately for testing or ad-hoc runs:

```bash
curl -X POST https://api.example.com/api/skill-store/schedules/{id}/trigger \
  -H "Authorization: Bearer $API_TOKEN"
```

This enqueues a job for immediate processing regardless of the cron expression.

### Pausing and Resuming

```bash
# Pause
curl -X POST https://api.example.com/api/skill-store/schedules/{id}/pause \
  -H "Authorization: Bearer $API_TOKEN"

# Resume
curl -X POST https://api.example.com/api/skill-store/schedules/{id}/resume \
  -H "Authorization: Bearer $API_TOKEN"
```

---

## Example: News Collation Skill

This walkthrough demonstrates a complete skill that collects articles from multiple sources, stores them, and generates a daily digest.

### 1. Store Articles

As your skill scrapes or receives articles:

```
skill_store_put({
  skill_id: "news-collator",
  collection: "bbc",
  key: "bbc-2025-01-15-ai-policy",
  title: "EU Approves New AI Regulation Framework",
  summary: "The European Union has finalized comprehensive regulations governing artificial intelligence deployment across member states.",
  content: "Full article text...",
  data: {
    source: "BBC News",
    author: "Sarah Johnson",
    published_at: "2025-01-15T08:00:00Z",
    category: "technology",
    word_count: 1200
  },
  tags: ["ai", "regulation", "eu", "policy"],
  source_url: "https://bbc.co.uk/news/technology-12345",
  user_email: "user@example.com"
})
```

### 2. Set Up Daily Digest Schedule

```bash
curl -X POST https://api.example.com/api/skill-store/schedules \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "skill_id": "news-collator",
    "cron_expression": "0 8 * * 1-5",
    "timezone": "America/New_York",
    "webhook_url": "https://gateway.example.com/hooks/news-digest",
    "payload_template": {
      "action": "generate_digest",
      "lookback_hours": 24,
      "max_articles": 20,
      "format": "summary"
    }
  }'
```

### 3. Search Articles

When the user asks about a topic:

```
skill_store_search({
  skill_id: "news-collator",
  query: "artificial intelligence regulation",
  semantic: true,
  limit: 10
})
```

### 4. Check Data Volume

```
skill_store_aggregate({
  skill_id: "news-collator",
  operation: "count_by_tag"
})
```

Returns:

```
- ai: 45
- technology: 38
- regulation: 22
- climate: 15
- health: 12
```

### 5. Browse Collections

```
skill_store_collections({
  skill_id: "news-collator"
})
```

Returns:

```
4 collections (182 total items)
- bbc: 65 items
- reuters: 52 items
- techcrunch: 40 items
- digests: 25 items
```

### 6. Clean Up Old Data

Set TTL on articles so they auto-expire:

```
skill_store_put({
  skill_id: "news-collator",
  collection: "bbc",
  key: "bbc-2025-01-15-ai-policy",
  title: "EU Approves New AI Regulation Framework",
  summary: "...",
  expires_at: "2025-02-15T00:00:00Z",
  tags: ["ai", "regulation", "eu"]
})
```

Or archive old digests:

```bash
curl -X POST https://api.example.com/api/skill-store/items/{digest-id}/archive \
  -H "Authorization: Bearer $API_TOKEN"
```

---

## Quota Awareness

The Skill Store enforces resource quotas per skill. When a quota is exceeded, the API returns `429 Too Many Requests`.

### Default Limits

| Resource | Default Limit | Environment Variable |
|----------|--------------|---------------------|
| Items per skill | 100,000 | `SKILL_STORE_MAX_ITEMS_PER_SKILL` |
| Collections per skill | 1,000 | `SKILL_STORE_MAX_COLLECTIONS_PER_SKILL` |
| Schedules per skill | 20 | `SKILL_STORE_MAX_SCHEDULES_PER_SKILL` |
| Max data field size | 1 MB | `SKILL_STORE_MAX_ITEM_SIZE_BYTES` |

### Handling 429 Responses

When a quota is exceeded, the response includes current usage and the limit:

```json
{
  "error": "Item quota exceeded",
  "current": 100000,
  "limit": 100000
}
```

**Best practices for quota management:**

1. **Use TTL aggressively** for transient data (cache, temporary results).
2. **Archive instead of accumulating** -- move old items to `archived` status and periodically clean up.
3. **Monitor usage** via the admin quota endpoint.
4. **Bulk delete** old data by collection or tags when approaching limits.

### Checking Your Quota

```bash
curl https://api.example.com/api/admin/skill-store/skills/my-skill/quota \
  -H "Authorization: Bearer $API_TOKEN"
```

Returns:

```json
{
  "skill_id": "my-skill",
  "items": { "current": 4500, "limit": 100000 },
  "collections": { "current": 8, "limit": 1000 },
  "schedules": { "current": 2, "limit": 20 },
  "max_item_size_bytes": 1048576
}
```

---

## skill_id Trust Model

The `skill_id` is **self-declared** by the skill at call time. There is no central registry or authentication of skill identities. This means:

### Rules and Conventions

1. **Format:** Alphanumeric characters, hyphens, and underscores only. Max 100 characters.
2. **Examples:** `news-collator`, `weather_skill`, `shopping-list-v2`
3. **Invalid:** `my skill` (spaces), `my.skill` (dots), `a` * 101 characters (too long)

### Naming Conventions

- Use lowercase with hyphens: `my-awesome-skill`
- Include version only if breaking changes: `my-skill-v2`
- Use a unique prefix if part of a suite: `acme-crm-contacts`, `acme-crm-deals`

### Isolation Guarantees

- Each `skill_id` has its own namespace of collections, items, and schedules.
- Quotas are enforced per `skill_id`.
- One skill cannot accidentally overwrite another skill's data (the composite key is `skill_id + collection + key`).

### Trust Boundary

Since skill_ids are self-declared, any agent or API caller can read/write to any skill_id they know about. The Skill Store trusts the caller to provide the correct skill_id. This is appropriate because:

- OpenClaw agents run in a trusted context (the gateway controls which skills are loaded).
- The API is authenticated -- only authorized callers can access the Skill Store.
- For additional isolation, skills can use `user_email` scoping.

If stronger isolation is needed in the future, skill_id validation could be added at the gateway level.

---

## Embedding and Semantic Search Details

### How Embeddings Are Generated

When an item is created or updated, the system asynchronously enqueues an embedding job:

1. An `internal_job` with kind `skill_store.embed` is created.
2. The job processor picks it up and builds embedding text from the item.
3. **Embedding text priority:** `title + summary` (preferred) or `title + content` (fallback).
4. The embedding is generated via the configured provider (OpenAI, VoyageAI, or Gemini).
5. The 1024-dimensional vector is stored in the `embedding` column.
6. `embedding_status` is set to `complete`.

### Embedding Status Values

| Status | Meaning |
|--------|---------|
| `pending` | Embedding not yet generated (waiting in queue, or provider not configured) |
| `complete` | Embedding stored and ready for semantic search |
| `failed` | Embedding generation failed (will retry on backfill) |

### Backfilling Embeddings

If you deploy the embedding provider after items have been created, backfill existing items:

```bash
curl -X POST https://api.example.com/api/admin/skill-store/embeddings/backfill \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "batch_size": 500 }'
```

### Search Without Embeddings

Full-text search works regardless of embedding status. Semantic search gracefully falls back to text-based ILIKE matching when embeddings are not available, returning `search_type: "text"` in the response.

---

## Reference

- [Skill Store API Reference](../api/skill-store.md) -- complete endpoint documentation
- [OpenClaw Integration Guide](./openclaw-integration.md) -- deploying and connecting to OpenClaw
- [Database Schema](../schema.md) -- full database schema documentation
- [OpenClaw Hooks](https://docs.openclaw.ai/hooks) -- how schedule webhooks integrate with the gateway
