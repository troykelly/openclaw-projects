# Project Management — Agent Guide

This guide documents the happy paths for OpenClaw agents interacting with the
project management API. Each scenario includes the exact API calls and expected
behaviour.

---

## Work Item Hierarchy

```
project
  └── initiative
        └── epic
              └── issue (can also be standalone / triage)
                    └── task (any parent except list)

list (top-level only, contains todos)
```

**Rules:**
- `project` — no parent allowed
- `initiative` — parent must be `project` (or null for top-level)
- `epic` — parent **must** be `initiative`
- `issue` — parent must be `epic` (or null for standalone/triage)
- `task` — any parent allowed except `list`
- `list` — no parent, no children; content managed via todo endpoints

---

## Agent Happy Paths

### HP-A1: Create a project with full hierarchy

```http
POST /work-items
{ "kind": "project", "title": "Renovation" }
# → 201  { "id": "<project_id>", ... }

POST /work-items
{ "kind": "initiative", "title": "Phase 1", "parent_id": "<project_id>" }
# → 201  { "id": "<initiative_id>", ... }

POST /work-items
{ "kind": "epic", "title": "Plumbing", "parent_id": "<initiative_id>" }
# → 201  { "id": "<epic_id>", ... }

POST /work-items
{ "kind": "issue", "title": "Get quote", "parent_id": "<epic_id>" }
# → 201  { "id": "<issue_id>", ... }
```

### HP-A2: Add item to existing project

```http
# Find the project
GET /work-items?kind=project

# Walk the tree to find the right parent
GET /work-items/tree?root_id=<project_id>

# Create the issue under the appropriate epic
POST /work-items
{ "kind": "issue", "title": "New task", "parent_id": "<epic_id>" }
```

### HP-A3: Create a shopping list

Lists are lightweight containers. Items are managed via the todo sub-resource.

```http
POST /work-items
{ "kind": "list", "title": "Groceries" }
# → 201  { "id": "<list_id>", ... }

POST /work-items/<list_id>/todos
{ "text": "Asparagus" }
# → 201  { "id": "<todo_id>", "text": "Asparagus", "sort_order": ..., "priority": "P2", ... }

POST /work-items/<list_id>/todos
{ "text": "Milk" }
```

### HP-A4: Quick standalone issue (triage)

Issues without a parent appear in the triage view.

```http
POST /work-items
{ "kind": "issue", "title": "Call dentist" }
# → 201  No parent → appears in triage

# Retrieve all triage items
GET /work-items?scope=triage
# → 200  { "items": [ { "title": "Call dentist", "kind": "issue", ... } ] }
```

### HP-A5: Move item from triage to project

```http
PATCH /work-items/<issue_id>/reparent
{ "new_parent_id": "<epic_id>" }
# → 200  Item is now under the epic
```

### HP-A6: Set reminder on todo

When `not_before` is set, pgcron fires a hook to OpenClaw at the specified time.

```http
PATCH /work-items/<list_id>/todos/<todo_id>
{ "not_before": "2026-03-10T09:00:00Z" }
# → 200  { "not_before": "2026-03-10T09:00:00.000Z", ... }

# At 09:00 on March 10, the reminder.todo.not_before job fires
# and delivers a webhook to /hooks/agent with the todo context.
```

Setting `not_after` triggers a deadline-approaching nudge via `/hooks/wake`:

```http
PATCH /work-items/<list_id>/todos/<todo_id>
{ "not_after": "2026-03-15T17:00:00Z" }
# pgcron fires nudge.todo.not_after when within 24 hours of deadline
```

### HP-A7: Get project overview

```http
GET /work-items/tree?root_id=<project_id>
# → 200  Hierarchical tree of all descendants

GET /work-items/<project_id>/rollup
# → 200  Aggregated progress (issue counts by status)
```

### HP-A8: List vs Project — when to use which

| Use case | Kind | Why |
|----------|------|-----|
| Shopping, packing, daily habits | `list` | Simple checklist. Items are text-only todos. No hierarchy. |
| Software project, renovation, events | `project` | Structured work with phases, epics, issues. Full hierarchy. Estimates, dependencies, assignments. |
| Quick one-off task | `issue` (standalone) | Appears in triage. Can be moved to a project later. |

---

## Human Happy Paths (Web UI)

### HP-H1: First-time user creates a project

1. Click "+ New" in sidebar, select "Project"
2. Enter title and optional description
3. Project appears in sidebar under "Projects"
4. Click project — empty state prompts "Add Initiative"
5. Create initiative, then epic, then issues

### HP-H2: Quick task from anywhere

1. Press Cmd+K (command palette) or click "+ New"
2. Type task title, press Enter
3. Issue created in Triage
4. Later: drag or use move dialog to assign to a project epic

### HP-H3: Shopping list

1. Click "+ New" then "List", enter "Shopping"
2. List appears under "Lists" in sidebar
3. Click list, type items inline, press Enter to add
4. Check off completed items

### HP-H4: Navigate a project

1. Click project name in sidebar — tree expands
2. Click initiative/epic — main area shows child items
3. Switch views: List | Board | Tree | Calendar
4. Click issue — detail panel opens

### HP-H5: Drag-drop reorder

1. Drag issues within list view to reorder (updates `sort_order`)
2. Drag between board columns to change status
3. Drag between epics to reparent (with confirmation dialog)

### HP-H6: View project progress

1. Click project — see progress bar (X/Y issues complete)
2. Initiative-level rollup shows epic progress
3. Calendar view shows upcoming deadlines (`not_before`, `not_after`)

---

## Todo Fields Reference

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Todo item text (required on create) |
| `completed` | boolean | Whether the item is done |
| `sort_order` | integer | Display order (lower = first) |
| `not_before` | timestamp | Reminder date — pgcron fires hook |
| `not_after` | timestamp | Deadline — pgcron fires nudge |
| `priority` | P0-P4 | Priority level (default P2) |
| `completed_at` | timestamp | When marked complete (auto-set) |
| `updated_at` | timestamp | Last modification time (auto-set) |

## Reorder Endpoint

```http
POST /work-items/<list_id>/todos/reorder
{
  "items": [
    { "todo_id": "<id1>", "sort_order": 100 },
    { "todo_id": "<id2>", "sort_order": 200 },
    { "todo_id": "<id3>", "sort_order": 300 }
  ]
}
# → 200  { "ok": true }
```

## Real-time Events

Todo mutations emit events scoped to the parent work item:

| Mutation | Event |
|----------|-------|
| Create todo | `todo:created` |
| Update todo | `todo:updated` |
| Delete todo | `todo:deleted` |
| Reorder todos | `todo:reordered` |

Subscribe to these events via the SSE/WebSocket real-time connection to
receive live updates when viewing a list.
