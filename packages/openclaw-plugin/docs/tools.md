# Tool Reference

This document describes all 27 tools provided by the OpenClaw Projects Plugin. Parameter names, types, constraints, and descriptions match the JSON Schema definitions in `register-openclaw.ts`.

## Memory Tools

### memory_recall

Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string | Yes | | Search query for semantic memory search (1-1000 chars) |
| limit | integer | No | 5 | Maximum number of memories to return (1-20) |
| category | string | No | | Filter by memory category: `preference`, `fact`, `decision`, `context`, `other` |
| tags | array of string | No | | Filter by tags for categorical queries (e.g., `["music", "food"]`). Each tag: 1-100 chars |
| relationship_id | string (uuid) | No | | Scope search to a specific relationship between contacts |

### memory_store

Store a new memory for future reference. Use when the user shares important preferences, facts, or decisions.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| content | string | Yes | | Memory content to store (1-10000 chars) |
| category | string | No | `fact` | Memory category: `preference`, `fact`, `decision`, `context`, `other` |
| importance | number | No | 0.5 | Importance score (0-1) |
| tags | array of string | No | | Tags for structured retrieval (e.g., `["music", "work", "food"]`). Each tag: 1-100 chars |
| relationship_id | string (uuid) | No | | Scope memory to a specific relationship between contacts |

**Categories:**

- `preference` - User likes/dislikes, defaults
- `fact` - Known information about user or domain
- `decision` - Past decisions and rationale
- `context` - Situational context for ongoing work
- `other` - Anything that does not fit the above

### memory_forget

Remove a memory by ID or search query. Use when information is outdated or the user requests deletion.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| memoryId | string (uuid) | No | ID of the memory to forget |
| query | string | No | Search query to find memories to forget |

> At least one of `memoryId` or `query` should be provided.

## Project Tools

### project_list

List projects for the user. Use to see what projects exist or filter by status.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| status | string | No | `active` | Filter by project status: `active`, `completed`, `archived`, `all` |
| limit | integer | No | 10 | Maximum number of projects to return (1-50) |

### project_get

Get details about a specific project. Use when you need full project information.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| projectId | string (uuid) | Yes | Project ID to retrieve |

### project_create

Create a new project. Use when the user wants to start tracking a new initiative.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| name | string | Yes | | Project name (1-200 chars) |
| description | string | No | | Project description (max 5000 chars) |
| status | string | No | `active` | Initial project status: `active`, `completed`, `archived` |

## Todo Tools

### todo_list

List todos, optionally filtered by project or status. Use to see pending tasks.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| projectId | string (uuid) | No | | Filter by project ID |
| status | string | No | `pending` | Filter by todo status: `pending`, `in_progress`, `completed`, `all` |
| limit | integer | No | 20 | Maximum number of todos to return (1-100) |

### todo_create

Create a new todo item. Use when the user wants to track a task.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| title | string | Yes | | Todo title (1-500 chars) |
| description | string | No | | Todo description (max 5000 chars) |
| projectId | string (uuid) | No | | Project to add the todo to |
| priority | string | No | `medium` | Todo priority: `low`, `medium`, `high`, `urgent` |
| dueDate | string (date-time) | No | | Due date in ISO 8601 format |

### todo_complete

Mark a todo as complete. Use when a task is done.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| todoId | string (uuid) | Yes | Todo ID to mark as complete |

## Contact Tools

### contact_search

Search contacts by name, email, or other fields. Use to find people.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string | Yes | | Search query for contacts (1-500 chars) |
| limit | integer | No | 10 | Maximum number of contacts to return (1-50) |

### contact_get

Get details about a specific contact. Use when you need full contact information.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| contactId | string (uuid) | Yes | Contact ID to retrieve |

### contact_create

Create a new contact. Use when the user mentions someone new to track.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Contact name (1-200 chars) |
| email | string (email) | No | Contact email address |
| phone | string | No | Contact phone number |
| notes | string | No | Notes about the contact (max 5000 chars) |

## Relationship Tools

### relationship_set

Record a relationship between two people, groups, or organisations. Examples: "Troy is Alex's partner", "Sam is a member of The Kelly Household", "Troy works for Acme Corp". The system handles directionality and type matching automatically.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| contact_a | string | Yes | Name or ID of the first contact (1-200 chars) |
| contact_b | string | Yes | Name or ID of the second contact (1-200 chars) |
| relationship | string | Yes | Description of the relationship, e.g. `partner`, `parent of`, `member of`, `works for` (1-200 chars) |
| notes | string | No | Optional context about this relationship (max 2000 chars) |

### relationship_query

Query a contact's relationships. Returns all relationships including family, partners, group memberships, professional connections, etc. Handles directional relationships automatically.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| contact | string | Yes | Name or ID of the contact to query (1-200 chars) |
| type_filter | string | No | Filter by relationship type (max 200 chars) |

## Messaging Tools

### sms_send

Send an SMS message to a phone number. Use when you need to notify someone via text message. Requires the recipient phone number in E.164 format (e.g., +15551234567).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| to | string | Yes | Recipient phone number in E.164 format (e.g., +15551234567). Pattern: `^\+[1-9]\d{1,14}$` |
| body | string | Yes | SMS message body (1-1600 chars) |
| idempotencyKey | string | No | Optional key to prevent duplicate sends |

**Requirements:**

- Twilio credentials must be configured (`twilioAccountSid`, `twilioAuthToken`, `twilioPhoneNumber`)
- Phone number must be valid E.164 format
- Message body limited to 1600 characters

### email_send

Send an email message. Use when you need to communicate via email. Requires the recipient email address, subject, and body.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| to | string (email) | Yes | Recipient email address |
| subject | string | Yes | Email subject line (1-998 chars) |
| body | string | Yes | Plain text email body (min 1 char) |
| htmlBody | string | No | Optional HTML email body |
| threadId | string | No | Optional thread ID for replies |
| idempotencyKey | string | No | Optional unique key to prevent duplicate sends |

**Requirements:**

- Postmark credentials must be configured (`postmarkToken`, `postmarkFromEmail`)
- From email must be verified in Postmark

### message_search

Search message history semantically. Use when you need to find past conversations, messages about specific topics, or communications with contacts. Supports filtering by channel (SMS/email) and contact.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string | Yes | | Search query - semantic matching (min 1 char) |
| channel | string | No | `all` | Filter by channel type: `sms`, `email`, `all` |
| contactId | string (uuid) | No | | Filter by contact ID |
| limit | integer | No | 10 | Maximum results to return (1-100) |
| includeThread | boolean | No | false | Include full thread context |

### thread_list

List message threads (conversations). Use to see recent conversations with contacts. Can filter by channel (SMS/email) or contact.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| channel | string | No | | Filter by channel type: `sms`, `email` |
| contactId | string (uuid) | No | | Filter by contact ID |
| limit | integer | No | 20 | Maximum threads to return (1-100) |

### thread_get

Get a thread with its message history. Use to view the full conversation in a thread.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| threadId | string | Yes | | Thread ID to retrieve |
| messageLimit | integer | No | 50 | Maximum messages to return (1-200) |

## File Tools

### file_share

Generate a shareable download link for a file. Use when you need to share a file with someone outside the system. The link is time-limited and can be configured with an expiry time and optional download limit.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| fileId | string (uuid) | Yes | | The file ID to create a share link for |
| expiresIn | integer | No | 3600 | Link expiry time in seconds (60-604800) |
| maxDownloads | integer | No | | Optional maximum number of downloads (min 1) |

**Notes:**

- Links are database-backed tokens, not direct S3 presigned URLs
- SeaweedFS stays internal; the API proxies downloads
- Expired links return 403 Forbidden

## Skill Store Tools

The skill store is a key-value and searchable data store for persisting skill state, configuration, cached results, or any structured data. Items belong to a `skill_id` and are optionally grouped by `collection`.

### skill_store_put

Store or update data in the skill store. Use for persisting skill state, configuration, cached results, or any structured data. When a key is provided, existing items with the same (skill_id, collection, key) are updated.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| skill_id | string | Yes | Identifier for the skill (1-100 chars, alphanumeric/hyphens/underscores). Pattern: `^[a-zA-Z0-9_-]+$` |
| collection | string | No | Collection name for grouping items (max 200 chars, default: `_default`) |
| key | string | No | Unique key within the collection for upsert behavior (max 500 chars) |
| title | string | No | Human-readable title (max 500 chars) |
| summary | string | No | Brief summary of the item (max 2000 chars) |
| content | string | No | Full text content (max 50000 chars) |
| data | object | No | Arbitrary JSON data payload (max 1MB serialized) |
| media_url | string (uri) | No | URL to associated media |
| media_type | string | No | MIME type of associated media (max 100 chars) |
| source_url | string (uri) | No | URL of the original source |
| tags | array of string | No | Tags for categorization (max 50 items, each max 100 chars) |
| priority | integer | No | Priority value (0-100) |
| expires_at | string (date-time) | No | Expiry date in ISO 8601 format |
| pinned | boolean | No | Whether the item is pinned |
| user_email | string (email) | No | Email of the user who owns this item |

### skill_store_get

Retrieve an item from the skill store by ID or by composite key (skill_id + collection + key). Returns the full item including data payload.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string (uuid) | No | UUID of the item to retrieve |
| skill_id | string | No | Skill identifier (used with key for composite lookup, max 100 chars) |
| collection | string | No | Collection name (used with skill_id + key, max 200 chars) |
| key | string | No | Key within the collection (used with skill_id for composite lookup, max 500 chars) |

> Provide either `id` alone, or `skill_id` + `key` (with optional `collection`) for composite lookup.

### skill_store_list

List items in the skill store with filtering and pagination. Requires skill_id. Can filter by collection, status, tags, date range, and user email.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| skill_id | string | Yes | | Skill identifier (1-100 chars). Pattern: `^[a-zA-Z0-9_-]+$` |
| collection | string | No | | Filter by collection name (max 200 chars) |
| status | string | No | | Filter by item status: `active`, `archived`, `processing` |
| tags | array of string | No | | Filter by tags (each max 100 chars) |
| since | string (date-time) | No | | Only return items updated after this ISO 8601 date |
| limit | integer | No | 50 | Maximum number of items to return (1-200) |
| offset | integer | No | | Number of items to skip for pagination (min 0) |
| order_by | string | No | | Field to order results by: `created_at`, `updated_at`, `title`, `priority` |
| user_email | string (email) | No | | Filter by user email |

### skill_store_delete

Delete an item from the skill store by ID or by composite key (skill_id + collection + key). Performs a soft delete by default.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string (uuid) | No | UUID of the item to delete |
| skill_id | string | No | Skill identifier (used with key for composite lookup, max 100 chars) |
| collection | string | No | Collection name (used with skill_id + key, max 200 chars) |
| key | string | No | Key within the collection (used with skill_id for composite lookup, max 500 chars) |

> Provide either `id` alone, or `skill_id` + `key` (with optional `collection`) for composite lookup.

### skill_store_search

Search skill store items by text or semantic similarity. Use when looking for stored data, notes, or content by topic. Supports full-text search (default) and optional semantic/vector search with graceful fallback to text when embeddings are not available.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| skill_id | string | Yes | Skill identifier to search within (1-100 chars). Pattern: `^[a-zA-Z0-9_-]+$` |
| query | string | Yes | Search query text (min 1 char) |
| collection | string | No | Filter by collection name (max 200 chars) |
| tags | array of string | No | Filter by tags (each max 100 chars) |
| semantic | boolean | No | Use semantic/vector search instead of full-text |
| min_similarity | number | No | Minimum similarity threshold for semantic search (0-1) |
| limit | integer | No | Maximum number of results to return (1-200) |
| user_email | string (email) | No | Filter by user email |

### skill_store_collections

List all collections for a skill with item counts. Use to discover what data categories exist and how many items each collection contains.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| skill_id | string | Yes | Skill identifier to list collections for (1-100 chars). Pattern: `^[a-zA-Z0-9_-]+$` |
| user_email | string (email) | No | Filter by user email |

### skill_store_aggregate

Run simple aggregations on skill store items. Useful for understanding data volume, distribution, and boundaries. Operations: count, count_by_tag, count_by_status, latest, oldest.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| skill_id | string | Yes | Skill identifier to aggregate (1-100 chars). Pattern: `^[a-zA-Z0-9_-]+$` |
| collection | string | No | Filter by collection name (max 200 chars) |
| operation | string | Yes | Aggregation operation: `count`, `count_by_tag`, `count_by_status`, `latest`, `oldest` |
| since | string (date-time) | No | Only include items after this ISO 8601 date |
| until | string (date-time) | No | Only include items before this ISO 8601 date |
| user_email | string (email) | No | Filter by user email |

## Error Handling

All tools return errors in a consistent format:

```
Error: <error message>
```

Common error scenarios:

| Scenario | Description |
|----------|-------------|
| Validation error | Invalid parameters (wrong type, out of range, missing required) |
| Not found | Resource does not exist |
| Unauthorized | Authentication failed or user not permitted |
| Rate limited | Too many requests |
| Service unavailable | Backend API unreachable |
| Provider error | External service error (Twilio/Postmark) |
| Not configured | Required credentials missing (e.g., Twilio, Postmark) |
