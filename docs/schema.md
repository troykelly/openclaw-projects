# Database schema

This repo is migration-first. The authoritative schema is in `migrations/`.

## Work items

### Core model (Issue #3)

Core tables:

- `work_item`
  - Generic task/issue/initiative record.
- `work_item_participant`
  - People/agents involved in a work item. For now participants are stored as a string label.
- `work_item_dependency`
  - Directed dependency edges between work items (e.g. `kind='blocks'`).

### Planning fields (Issue #4)

Adds to `work_item`:

- `priority` (`work_item_priority` enum: `P0..P4`)
- `task_type` (`work_item_task_type` enum: `general|coding|admin|ops|research|meeting`)
- `not_before` / `not_after` scheduling window with check constraint (`not_before <= not_after` when both are set)

### Estimates + hierarchy (Issue #28)

Adds to `work_item`:

- `estimate_minutes` (int, nullable)
- `actual_minutes` (int, nullable)
- `work_item_kind` (`work_item_kind` enum: `project|initiative|epic|issue|task`, default `issue`)
- `parent_work_item_id` (self-referential FK for hierarchy, nullable)

Constraints:

- `estimate_minutes` and `actual_minutes` must be between 0 and 525,600 minutes when set.
- `parent_work_item_id` may not reference the same row.

Rollup views (include descendants):

- `work_item_rollup_project`
- `work_item_rollup_initiative`
- `work_item_rollup_epic`
- `work_item_rollup_issue`

Next-actionable query:

- `work_item_next_actionable_at(as_of timestamptz)` function
- `work_item_next_actionable` view (invokes the function with `now()`)

## Contacts (Issue #9)

- `contact`
  - `display_name`, optional `notes`
  - coarse trust flags: `allow_schedule`, `allow_auto_reply_safe_only`
- `contact_endpoint`
  - typed endpoints (`phone`, `email`, `telegram`, ...)
  - `normalized_value` is maintained by a DB trigger and is globally unique per `(endpoint_type, normalized_value)`
  - `allow_privileged_actions` is **never** allowed via `phone` endpoints (DB check constraint)

## External messages (Issue #10)

- `external_thread`
  - Links a contact endpoint to an external conversation/thread identifier (e.g. Twilio conversation SID, Telegram chat id)
  - Unique per `(channel, external_thread_key)`
- `external_message`
  - Messages within a thread (`direction`: `inbound|outbound`)
- `work_item_communication`
  - Subtype table attaching an actionable communication task to a thread/message
  - A trigger forces the parent `work_item.task_type = 'communication'`

## Skill Store (Epic #794)

### skill_store_item (Migration 050)

Persistent state storage for OpenClaw skills -- a namespaced key-value-plus-document store.

- `skill_store_item`
  - Scoped by `(skill_id, collection, key)` -- different from the memory table which is scoped by `(user_email, work_item_id, contact_id)`.
  - `skill_id` (text, NOT NULL): Self-declared skill identifier.
  - `collection` (text, NOT NULL, default `_default`): Logical grouping within a skill.
  - `key` (text, nullable): When set, enables upsert on `(skill_id, collection, key)`.
  - Content fields: `title`, `summary`, `content` (all text, nullable).
  - `data` (jsonb, default `{}`): Structured JSON payload with 1MB constraint.
  - Media fields: `media_url`, `media_type`, `source_url`.
  - `status` (`skill_store_item_status` enum: `active|archived|processing`, default `active`).
  - `tags` (text[], default `{}`): Classification tags with GIN index.
  - `priority` (integer, default 0).
  - `expires_at` (timestamptz, nullable): TTL expiration, auto-cleaned by pgcron every 15 minutes.
  - `pinned` (boolean, default false): Pinned items survive TTL cleanup.
  - Embedding columns: `embedding` (vector(1024)), `embedding_model`, `embedding_provider`, `embedding_status` (`complete|pending|failed`).
  - `search_vector` (tsvector): Auto-maintained by trigger from title (A), summary (B), content (C).
  - `user_email` (text, nullable): Multi-user isolation scope. NULL = shared.
  - `deleted_at` (timestamptz, nullable): Soft delete. Purged after 30 days.

Key indexes:
- Partial unique index on `(skill_id, collection, key)` WHERE `key IS NOT NULL AND deleted_at IS NULL`.
- GIN indexes on `tags`, `data` (jsonb_path_ops), and `search_vector`.
- HNSW index on `embedding` for cosine similarity search.

pgcron jobs:
- `skill_store_cleanup_expired`: Runs every 15 minutes, hard-deletes expired non-pinned items (max 5000 per batch).
- `skill_store_purge_soft_deleted`: Runs daily at 3:00 AM, hard-deletes items soft-deleted over 30 days ago.

### skill_store_schedule (Migration 051)

Recurring cron schedules for skill processing via webhooks.

- `skill_store_schedule`
  - `skill_id` (text, NOT NULL): Skill identifier.
  - `collection` (text, nullable): Optional scope to a specific collection.
  - `cron_expression` (text, NOT NULL): Standard 5-field cron. Minimum interval: 5 minutes (enforced by trigger).
  - `timezone` (text, NOT NULL, default `UTC`): IANA timezone for cron evaluation.
  - `webhook_url` (text, NOT NULL): URL called when schedule fires.
  - `webhook_headers` (jsonb, default `{}`): Headers sent with webhook request.
  - `payload_template` (jsonb, default `{}`): Template merged with runtime data.
  - `enabled` (boolean, default true).
  - `max_retries` (integer, default 5): Max consecutive failures before auto-disabling.
  - `last_run_status` (text, nullable): `success|failed|skipped`, NULL = never run or currently running.
  - `last_run_at`, `next_run_at` (timestamptz, nullable).

Constraints:
- Unique index on `(skill_id, collection, cron_expression)`.
- DB trigger `validate_cron_frequency` rejects expressions firing more than every 5 minutes.

pgcron jobs:
- `skill_store_schedule_enqueue`: Runs every minute, finds due schedules and enqueues `internal_job` entries with idempotency keys.

### skill_store_activity (Migration 052)

Activity log for skill store operations (for the activity feed).

- `skill_store_activity`
  - `activity_type` (`skill_store_activity_type` enum: `item_created|item_updated|item_deleted|item_archived|items_bulk_created|items_bulk_deleted|schedule_triggered|schedule_paused|schedule_resumed|collection_deleted`).
  - `skill_id` (text, NOT NULL).
  - `collection` (text, nullable).
  - `description` (text, NOT NULL): Human-readable description.
  - `metadata` (jsonb, default `{}`): Additional context (e.g., item_id, count).
  - `read_at` (timestamptz, nullable): For read/unread tracking.

---

Notes:

- IDs are UUIDv7 generated in Postgres via `new_uuid()`.
- Dependency edges disallow self-dependency (`work_item_id <> depends_on_work_item_id`).
