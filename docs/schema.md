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

Notes:

- IDs are UUIDv7 generated in Postgres via `new_uuid()`.
- Dependency edges disallow self-dependency (`work_item_id <> depends_on_work_item_id`).
