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
- `work_item_kind` (`work_item_kind` enum: `project|initiative|epic|issue`, default `issue`)
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

Notes:

- IDs are UUIDv7 generated in Postgres via `new_uuid()`.
- Dependency edges disallow self-dependency (`work_item_id <> depends_on_work_item_id`).
