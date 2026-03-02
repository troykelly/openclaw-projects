---
name: openclaw-projects
description: Project management, memory storage, and communications backend for OpenClaw agents
metadata:
  openclaw:
    emoji: "📋"
    requires:
      env:
        - OPENCLAW_PROJECTS_URL
        - OPENCLAW_API_TOKEN
---

# openclaw-projects

A backend service for managing projects, tasks, memories, and communications. Designed as the persistent storage and coordination layer for OpenClaw agents.

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENCLAW_PROJECTS_URL` | Base URL of the openclaw-projects instance | `https://projects.example.com` |
| `OPENCLAW_API_TOKEN` | Shared secret for API authentication | (from 1Password or file) |

### Authentication

All API requests require a Bearer token:

```bash
curl -H "Authorization: Bearer $OPENCLAW_API_TOKEN" \
     "$OPENCLAW_PROJECTS_URL/work-items"
```

Alternative secret sources:
- `OPENCLAW_API_TOKEN_COMMAND` - Execute command (e.g., `op read 'op://Vault/secret'`)
- `OPENCLAW_API_TOKEN_FILE` - Read from file

---

## Quick Actions

### Add an item to a list

```bash
POST $OPENCLAW_PROJECTS_URL/work-items
Content-Type: application/json
Authorization: Bearer $OPENCLAW_API_TOKEN

{
  "title": "Asparagus",
  "parent_work_item_id": "<shopping-list-uuid>",
  "kind": "issue"
}
```

### Set a reminder

```bash
POST $OPENCLAW_PROJECTS_URL/work-items
Content-Type: application/json

{
  "title": "Call the dentist",
  "not_before": "2026-02-05T09:00:00Z",
  "kind": "issue"
}
```

The `not_before` date triggers a hook to OpenClaw when the time arrives.

### Store a memory

```bash
POST $OPENCLAW_PROJECTS_URL/memory
Content-Type: application/json

{
  "memory_type": "preference",
  "title": "Communication style",
  "content": "User prefers async communication over meetings"
}
```

### Search memories

```bash
GET $OPENCLAW_PROJECTS_URL/memory?search=notification+preferences
```

### Create a project with hierarchy

```bash
# Create project
POST $OPENCLAW_PROJECTS_URL/work-items
{
  "title": "Tiny Home Build",
  "kind": "project",
  "description": "Build a tiny home on wheels"
}

# Create epic under project
POST $OPENCLAW_PROJECTS_URL/work-items
{
  "title": "Electrical System",
  "kind": "epic",
  "parent_work_item_id": "<project-uuid>"
}

# Create issue under epic
POST $OPENCLAW_PROJECTS_URL/work-items
{
  "title": "Install solar panels",
  "kind": "issue",
  "parent_work_item_id": "<epic-uuid>"
}
```

---

## API Reference

### Work Items

Work items are the core data model - representing projects, epics, initiatives, issues, and tasks in a hierarchical structure.

#### Create Work Item

```
POST /work-items
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Title of the work item |
| `kind` | string | No | `project`, `epic`, `initiative`, `issue` (default: `issue`) |
| `description` | string | No | Detailed description (markdown supported) |
| `parent_work_item_id` | uuid | No | Parent item for hierarchy |
| `status` | string | No | `backlog`, `todo`, `in_progress`, `done`, `cancelled` |
| `not_before` | timestamp | No | Don't show/remind before this time |
| `not_after` | timestamp | No | Deadline |
| `estimated_effort_minutes` | integer | No | Effort estimate |

**Response:** Created work item with `id`, `created_at`, etc.

#### List Work Items

```
GET /work-items
```

Returns flat list of all work items.

#### Get Work Item Tree

```
GET /work-items/tree
```

Query params:
- `root_id` - Start from specific item
- `max_depth` - Limit tree depth

Returns hierarchical structure with children nested.

#### Get Single Work Item

```
GET /work-items/:id
```

Returns full work item with all fields.

#### Update Work Item

```
PUT /work-items/:id
```

All fields are optional - only include fields to update.

#### Update Work Item Status

```
PATCH /work-items/:id/status
```

```json
{ "status": "in_progress" }
```

#### Update Work Item Dates

```
PATCH /work-items/:id/dates
```

```json
{
  "not_before": "2026-02-10T09:00:00Z",
  "not_after": "2026-02-15T17:00:00Z"
}
```

#### Delete Work Item

```
DELETE /work-items/:id
```

### Work Item Hierarchy

#### Reparent Work Item

```
PATCH /work-items/:id/reparent
```

```json
{ "new_parent_id": "<new-parent-uuid>" }
```

#### Reorder Work Item

```
PATCH /work-items/:id/reorder
```

```json
{ "after_id": "<sibling-uuid>" }
```

### Work Item Rollups

```
GET /work-items/:id/rollup
```

Returns aggregated data from children:
- Total estimated effort
- Completion percentage
- Status breakdown

---

### Memories

Store and retrieve contextual memories for agents.

#### Create Memory

```
POST /memory
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `memory_type` | string | Yes | `preference`, `fact`, `decision`, `context` |
| `title` | string | Yes | Short title |
| `content` | string | Yes | Full content |
| `work_item_id` | uuid | No | Link to work item |
| `contact_id` | uuid | No | Link to contact |

#### List/Search Memories

```
GET /memory
```

Query params:
- `search` - Text search
- `memory_type` - Filter by type
- `work_item_id` - Filter by linked work item
- `contact_id` - Filter by linked contact

#### Update Memory

```
PUT /memory/:id
```

#### Delete Memory

```
DELETE /memory/:id
```

#### Memories for Work Item

```
GET /work-items/:id/memories
POST /work-items/:id/memories
```

---

### Contacts

Manage people and their communication endpoints.

#### Create Contact

```
POST /contacts
```

```json
{
  "displayName": "Jane Doe",
  "notes": "Met at conference",
  "contactKind": "person"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `displayName` | string | Yes | Contact display name |
| `notes` | string | No | Free-text notes |
| `contactKind` | string | No | `person` (default), `organisation`, `group`, or `agent` |

**Contact Kinds:**
- `person` — Individual human contact (default)
- `organisation` — Company, business, or institution
- `group` — Household, family, team, or collective (e.g., "The Kelly Household")
- `agent` — AI agent or automated system

#### List Contacts

```
GET /contacts
```

Query params:
- `search` - Search by name/email/phone
- `contact_kind` - Filter by kind: `person`, `organisation`, `group`, `agent` (comma-separated for multiple)
- `limit` - Results per page (default: 50, max: 100)
- `offset` - Pagination offset

#### Get Contact

```
GET /contacts/:id
```

Returns contact with all endpoints and `contact_kind`.

#### Update Contact

```
PATCH /contacts/:id
```

Supports updating `contactKind` along with other fields.

#### Delete Contact

```
DELETE /contacts/:id
```

#### Add Contact Endpoint

```
POST /contacts/:id/endpoints
```

```json
{
  "type": "telegram",
  "value": "@janedoe"
}
```

Endpoint types: `email`, `phone`, `telegram`, `whatsapp`, `slack`, `discord`

#### Contact's Work Items

```
GET /contacts/:id/work-items
```

#### Link Contact to Work Item

```
POST /work-items/:id/contacts
```

```json
{ "contact_id": "<contact-uuid>" }
```

---

### Todos (Subtasks)

Simple checklist items within work items.

#### List Todos

```
GET /work-items/:id/todos
```

#### Create Todo

```
POST /work-items/:id/todos
```

```json
{
  "title": "Buy screws",
  "completed": false
}
```

#### Update Todo

```
PATCH /work-items/:id/todos/:todoId
```

```json
{ "completed": true }
```

#### Delete Todo

```
DELETE /work-items/:id/todos/:todoId
```

---

### Comments

Threaded comments on work items.

#### List Comments

```
GET /work-items/:id/comments
```

#### Create Comment

```
POST /work-items/:id/comments
```

```json
{
  "content": "This looks good! @jane what do you think?",
  "parent_id": "<optional-parent-comment-id>"
}
```

#### Update Comment

```
PUT /work-items/:id/comments/:commentId
```

#### Delete Comment

```
DELETE /work-items/:id/comments/:commentId
```

#### React to Comment

```
POST /work-items/:id/comments/:commentId/reactions
```

```json
{ "emoji": "👍" }
```

---

### Activity Feed

Track all changes across the system.

#### Get Activity

```
GET /activity
```

Query params:
- `limit` - Number of items (default: 50)
- `offset` - Pagination offset
- `project_id` - Filter by project
- `action_type` - Filter by action (`created`, `updated`, `deleted`)
- `since` - ISO timestamp, only newer items

#### Activity Stream (SSE)

```
GET /activity/stream
```

Real-time Server-Sent Events for live updates.

#### Mark Activity Read

```
POST /activity/:id/read
POST /activity/read-all
```

---

### Notifications

User notifications from agent actions and system events.

#### List Notifications

```
GET /notifications
```

Query params:
- `unread_only` - Boolean
- `limit`, `offset` - Pagination

#### Unread Count

```
GET /notifications/unread-count
```

#### Mark Read

```
POST /notifications/:id/read
POST /notifications/read-all
```

#### Dismiss Notification

```
DELETE /notifications/:id
```

#### Notification Preferences

```
GET /notifications/preferences
PATCH /notifications/preferences
```

---

### Search

Global search across all entities.

```
GET /search
```

Query params:
- `q` - Search query
- `types` - Comma-separated: `work_item`, `contact`, `memory`

---

### Timeline

Visual timeline of work items with dates.

```
GET /timeline
```

Query params:
- `start` - Start date
- `end` - End date
- `kind` - Filter by work item kind

```
GET /work-items/:id/timeline
```

Timeline for specific item and descendants.

---

### Analytics

Project health and progress metrics.

```
GET /analytics/project-health
GET /analytics/velocity
GET /analytics/effort
GET /analytics/burndown/:id
GET /analytics/overdue
GET /analytics/blocked
GET /analytics/activity-summary
```

---

### Dependencies

Track dependencies between work items.

#### List Dependencies

```
GET /work-items/:id/dependencies
```

#### Add Dependency

```
POST /work-items/:id/dependencies
```

```json
{
  "depends_on_id": "<other-work-item-uuid>",
  "dependency_type": "blocks"
}
```

Types: `blocks`, `relates_to`, `duplicates`

#### Dependency Graph

```
GET /work-items/:id/dependency-graph
```

Returns full graph of connected items.

---

### Links

External links attached to work items.

#### List Links

```
GET /work-items/:id/links
```

#### Add Link

```
POST /work-items/:id/links
```

```json
{
  "url": "https://github.com/org/repo/issues/123",
  "title": "GitHub Issue #123",
  "link_type": "github_issue"
}
```

---

### Bulk Operations

Batch updates for efficiency.

```
PATCH /work-items/bulk
```

```json
{
  "ids": ["uuid1", "uuid2", "uuid3"],
  "updates": {
    "status": "done"
  }
}
```

---

### External Messages

Ingest messages from external sources (SMS, email).

```
POST /ingest/external-message
```

```json
{
  "source": "twilio",
  "from": "+1234567890",
  "to": "+0987654321",
  "body": "Message content",
  "external_id": "SM123456"
}
```

---

### Health Checks

```
GET /health              # Basic health
GET /health/live     # Kubernetes liveness
GET /health/ready    # Kubernetes readiness (checks DB)
GET /health          # Detailed status with components
```

---

## Common Workflows

### Personal Task Management

1. **Create a shopping list:**
   ```
   POST /work-items
   { "title": "Shopping List", "kind": "project" }
   ```

2. **Add items:**
   ```
   POST /work-items
   { "title": "Milk", "parent_work_item_id": "<list-id>", "kind": "issue" }
   ```

3. **Check off item:**
   ```
   PATCH /work-items/:id/status
   { "status": "done" }
   ```

### Reminders

1. **Create reminder:**
   ```
   POST /work-items
   {
     "title": "Take medication",
     "not_before": "2026-02-02T08:00:00Z",
     "kind": "issue"
   }
   ```

2. **OpenClaw receives hook when time arrives** (via pgcron)

### Memory-Assisted Context

1. **Store preference:**
   ```
   POST /memory
   {
     "memory_type": "preference",
     "title": "Timezone",
     "content": "User is in Australia/Melbourne timezone"
   }
   ```

2. **Retrieve for context:**
   ```
   GET /memory?search=timezone
   ```

### Project Planning

1. **Create project structure:**
   - Project → Epic → Initiative → Issue → Todo

2. **Track effort:**
   - Set `estimated_effort_minutes` on items
   - GET `/work-items/:project-id/rollup` for totals

3. **Monitor progress:**
   - GET `/analytics/velocity` for throughput
   - GET `/analytics/burndown/:id` for burndown

---

## Data Model

### Work Item Kinds

| Kind | Description | Typical Use |
|------|-------------|-------------|
| `project` | Top-level container | Major initiatives, life areas |
| `epic` | Large feature/goal | Multi-week efforts |
| `initiative` | Group of related work | Sprint or milestone |
| `issue` | Specific task | Day-level work items |

### Work Item Statuses

| Status | Description |
|--------|-------------|
| `backlog` | Not yet scheduled |
| `todo` | Ready to start |
| `in_progress` | Currently being worked |
| `done` | Completed |
| `cancelled` | Won't be done |

### Memory Types

| Type | Description | Example |
|------|-------------|---------|
| `preference` | User likes/dislikes | "Prefers morning meetings" |
| `fact` | Known information | "Birthday is March 15" |
| `decision` | Past decisions | "Chose React over Vue for frontend" |
| `context` | Situational context | "Working on home renovation" |

---

## Installation

### Via ClawHub (when available)

```bash
clawhub install openclaw-projects
```

### Manual

```bash
git clone https://github.com/troykelly/openclaw-projects ~/.openclaw/skills/openclaw-projects
```

### Configuration

Add to your shell profile or `.env`:

```bash
export OPENCLAW_PROJECTS_URL="https://your-instance.example.com"
export OPENCLAW_API_TOKEN_COMMAND="op read 'op://Vault/openclaw-projects/secret'"
```

---

## References

- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [OpenClaw Skills](https://docs.openclaw.ai/tools/skills)
- [OpenClaw Hooks](https://docs.openclaw.ai/hooks)
- [openclaw-projects Repository](https://github.com/troykelly/openclaw-projects)
