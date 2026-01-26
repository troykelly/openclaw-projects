# Database schema

This repo is migration-first. The authoritative schema is in `migrations/`.

## Work items (Issue #3)

Core tables:

- `work_item`
  - Generic task/issue/initiative record (higher-level typing comes in later issues).
- `work_item_participant`
  - People/agents involved in a work item. For now participants are stored as a string label.
- `work_item_dependency`
  - Directed dependency edges between work items (e.g. `kind='blocks'`).

Notes:

- IDs are UUIDv7 generated in Postgres via `new_uuid()`.
- Dependency edges disallow self-dependency (`work_item_id <> depends_on_work_item_id`).
