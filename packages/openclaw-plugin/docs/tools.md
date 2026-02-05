# Tool Reference

This document describes all tools provided by the OpenClaw Projects Plugin.

## Memory Tools

### memory_recall

Search memories by semantic similarity using pgvector embeddings.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query (1-500 characters) |
| limit | integer | No | Maximum results (default: 5, max: 20) |
| category | string | No | Filter by category |
| minScore | number | No | Minimum similarity score (0-1, default: 0.7) |

**Returns:**

```typescript
{
  memories: Array<{
    id: string;
    content: string;
    category: string;
    createdAt: string;
    similarity: number;
  }>;
  query: string;
  count: number;
}
```

**Example:**

```
Agent: Let me check your preferences...
[memory_recall] query: "color theme preference"
Result: { memories: [{ content: "User prefers dark mode", similarity: 0.92 }] }
```

### memory_store

Store a new memory for later recall.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| content | string | Yes | Memory content (1-2000 characters) |
| category | string | No | Category: preference, fact, decision, context |
| importance | integer | No | Importance level (1-10, default: 5) |

**Returns:**

```typescript
{
  id: string;
  content: string;
  category: string;
  stored: boolean;
}
```

**Categories:**

- `preference` - User likes/dislikes, defaults
- `fact` - Known information about user or domain
- `decision` - Past decisions and rationale
- `context` - Situational context for ongoing work

### memory_forget

Delete a specific memory by ID.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| memoryId | string | Yes | UUID of the memory to delete |
| reason | string | No | Reason for deletion (for audit) |

**Returns:**

```typescript
{
  deleted: boolean;
  memoryId: string;
}
```

## Project Tools

### project_list

List projects with optional filtering.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| status | string | No | Filter by status: active, archived, completed |
| limit | integer | No | Maximum results (default: 20) |
| offset | integer | No | Pagination offset |

**Returns:**

```typescript
{
  projects: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    createdAt: string;
  }>;
  total: number;
}
```

### project_get

Get a specific project by ID with full details.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| projectId | string | Yes | UUID of the project |

**Returns:**

```typescript
{
  id: string;
  title: string;
  description: string;
  status: string;
  progress: number;
  todoCount: number;
  completedTodoCount: number;
  createdAt: string;
  updatedAt: string;
}
```

### project_create

Create a new project.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| title | string | Yes | Project title (1-200 characters) |
| description | string | No | Project description |

**Returns:**

```typescript
{
  id: string;
  title: string;
  created: boolean;
}
```

### project_update

Update an existing project.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| projectId | string | Yes | UUID of the project |
| title | string | No | New title |
| description | string | No | New description |
| status | string | No | New status |

**Returns:**

```typescript
{
  id: string;
  updated: boolean;
}
```

## Todo Tools

### todo_list

List todos with optional filtering.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| projectId | string | No | Filter by project |
| status | string | No | Filter by status: pending, in_progress, completed, blocked |
| dueToday | boolean | No | Only show items due today |
| overdue | boolean | No | Only show overdue items |
| limit | integer | No | Maximum results (default: 50) |

**Returns:**

```typescript
{
  todos: Array<{
    id: string;
    title: string;
    status: string;
    priority: number;
    dueDate: string | null;
    projectId: string | null;
  }>;
  total: number;
}
```

### todo_get

Get a specific todo by ID.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| todoId | string | Yes | UUID of the todo |

**Returns:**

```typescript
{
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  dueDate: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### todo_create

Create a new todo item.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| title | string | Yes | Todo title (1-500 characters) |
| description | string | No | Detailed description |
| projectId | string | No | Parent project UUID |
| priority | integer | No | Priority level (1-5, default: 3) |
| dueDate | string | No | Due date (ISO 8601 format) |

**Returns:**

```typescript
{
  id: string;
  title: string;
  created: boolean;
}
```

### todo_update

Update an existing todo.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| todoId | string | Yes | UUID of the todo |
| title | string | No | New title |
| description | string | No | New description |
| status | string | No | New status |
| priority | integer | No | New priority |
| dueDate | string | No | New due date |

**Returns:**

```typescript
{
  id: string;
  updated: boolean;
}
```

## Contact Tools

### contact_search

Search for contacts by name or other attributes.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query |
| limit | integer | No | Maximum results (default: 10) |

**Returns:**

```typescript
{
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  }>;
  count: number;
}
```

### contact_get

Get full details for a specific contact.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| contactId | string | Yes | UUID of the contact |

**Returns:**

```typescript
{
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  endpoints: Array<{
    type: string;
    value: string;
  }>;
  createdAt: string;
}
```

## Messaging Tools

### sms_send

Send an SMS message via Twilio.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| to | string | Yes | Phone number in E.164 format (e.g., +15551234567) |
| body | string | Yes | Message content (1-1600 characters) |
| idempotencyKey | string | No | Unique key to prevent duplicate sends |

**Returns:**

```typescript
{
  messageId: string;
  threadId: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
}
```

**Requirements:**

- Twilio credentials must be configured
- Phone number must be valid E.164 format
- Message body limited to 1600 characters (SMS limit)

### email_send

Send an email via Postmark.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| to | string | Yes | Recipient email address |
| subject | string | Yes | Email subject (1-998 characters) |
| body | string | Yes | Email body content |
| htmlBody | string | No | HTML version of body |

**Returns:**

```typescript
{
  messageId: string;
  threadId: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
}
```

**Requirements:**

- Postmark credentials must be configured
- From email must be verified in Postmark

### message_search

Search message history with semantic search.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query |
| channel | string | No | Filter by channel: sms, email, all |
| contactId | string | No | Filter by contact |
| limit | integer | No | Maximum results (default: 20) |

**Returns:**

```typescript
{
  messages: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    channel: 'sms' | 'email';
    content: string;
    contactId: string | null;
    createdAt: string;
    similarity: number;
  }>;
  count: number;
}
```

### thread_list

List message threads.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| channel | string | No | Filter by channel |
| contactId | string | No | Filter by contact |
| limit | integer | No | Maximum results (default: 20) |

**Returns:**

```typescript
{
  threads: Array<{
    id: string;
    channel: string;
    contactId: string | null;
    messageCount: number;
    lastMessageAt: string;
    preview: string;
  }>;
  total: number;
}
```

### thread_get

Get a specific thread with full message history.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| threadId | string | Yes | UUID of the thread |
| limit | integer | No | Maximum messages (default: 50) |

**Returns:**

```typescript
{
  id: string;
  channel: string;
  contactId: string | null;
  messages: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    content: string;
    createdAt: string;
    status: string;
  }>;
}
```

## File Tools

### file_share

Generate a shareable download link for a stored file. The link is time-limited and can optionally have a download limit.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| fileId | string | Yes | UUID of the file to share |
| expiresIn | integer | No | Link expiry time in seconds (default: 3600, min: 60, max: 604800) |
| maxDownloads | integer | No | Optional maximum number of downloads |

**Returns:**

```typescript
{
  url: string;          // The shareable download URL
  shareToken: string;   // Token for reference/revocation
  expiresAt: string;    // ISO 8601 expiration timestamp
  expiresIn: number;    // Seconds until expiration
  filename: string;     // Original filename
  contentType: string;  // MIME type
  sizeBytes: number;    // File size in bytes
}
```

**Example:**

```
User: Can you share that PDF I uploaded?
Agent: Let me create a download link for that file...
[file_share] fileId: "550e8400-e29b-41d4-a716-446655440000", expiresIn: 86400
Result: Share link created for "report.pdf" (1.2 MB). Valid for 24 hours.
URL: https://api.example.com/api/files/shared/abc123xyz...
```

**Notes:**

- Links are database-backed tokens, not direct S3 presigned URLs
- SeaweedFS stays internal; the API proxies downloads
- Expired links return 403 Forbidden
- Revocation can be done via the API (not exposed via tool yet)

## Error Handling

All tools return errors in a consistent format:

```typescript
{
  error: {
    code: string;
    message: string;
  }
}
```

Common error codes:

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Invalid parameters |
| `NOT_FOUND` | Resource not found |
| `UNAUTHORIZED` | Authentication failed |
| `RATE_LIMITED` | Too many requests |
| `SERVICE_UNAVAILABLE` | Backend unavailable |
| `PROVIDER_ERROR` | External service error (Twilio/Postmark) |
