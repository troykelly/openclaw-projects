/**
 * OpenAPI path definitions for work item CRUD and sub-resources.
 * Routes: /api/work-items, /api/work-items/tree, /api/work-items/{id},
 *         and all sub-resource endpoints (status, hierarchy, reparent, reorder,
 *         dates, rollup, activity, todos, comments, presence, contacts,
 *         memories, attachments, communications, emails, calendar, related-entities).
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  ref,
  uuidParam,
  paginationParams,
  errorResponses,
  jsonBody,
  jsonResponse,
  listEnvelope,
  namespaceParam,
} from '../helpers.ts';

export function workItemsPaths(): OpenApiDomainModule {
  const workItemIdParam = uuidParam('id', 'Work item UUID');

  return {
    tags: [
      { name: 'Work Items', description: 'Hierarchical task and project management (projects, initiatives, epics, issues, tasks)' },
      { name: 'Work Item Todos', description: 'Checklist items attached to work items' },
      { name: 'Work Item Comments', description: 'Threaded comments and reactions on work items' },
      { name: 'Work Item Presence', description: 'Real-time user presence on work items' },
      { name: 'Work Item Contacts', description: 'Contact associations with work items' },
      { name: 'Work Item Memories', description: 'Contextual memories attached to work items' },
      { name: 'Work Item Attachments', description: 'File attachments on work items' },
      { name: 'Work Item Communications', description: 'Email and calendar event links on work items' },
    ],

    schemas: {
      WorkItemKind: {
        type: 'string',
        enum: ['project', 'initiative', 'epic', 'issue', 'task'],
        description: 'Hierarchy level of the work item',
        example: 'project',
      },
      WorkItemStatus: {
        type: 'string',
        description: 'Current status of the work item (e.g. backlog, open, in_progress, done, blocked)',
        example: 'in_progress',
      },
      WorkItemPriority: {
        type: 'string',
        enum: ['P0', 'P1', 'P2', 'P3', 'P4'],
        description: 'Priority level from P0 (critical) to P4 (lowest)',
        example: 'P0',
      },
      WorkItemSummary: {
        type: 'object',
        required: ['id', 'title', 'status', 'kind', 'created_at', 'updated_at', 'namespace'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Short title summarising the work item', example: 'Implement user authentication' },
          status: { $ref: '#/components/schemas/WorkItemStatus', description: 'Current workflow status' },
          priority: { $ref: '#/components/schemas/WorkItemPriority', description: 'Priority ranking of the work item' },
          task_type: { type: 'string', description: 'Legacy task type classifier (use kind instead)', example: 'feature' },
          kind: { $ref: '#/components/schemas/WorkItemKind', description: 'Hierarchy level of the work item' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent work item, or null if top-level', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the work item was created', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'Timestamp of the last update to the work item', example: '2026-02-21T15:00:00Z' },
          estimate_minutes: { type: 'integer', nullable: true, description: 'Estimated effort in minutes', example: 120 },
          actual_minutes: { type: 'integer', nullable: true, description: 'Actual effort spent in minutes', example: 90 },
          namespace: { type: 'string', description: 'Namespace scope for multi-tenant isolation', example: 'org-acme' },
        },
      },
      WorkItem: {
        type: 'object',
        required: ['id', 'title', 'status', 'kind', 'created_at', 'updated_at', 'namespace'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Short title summarising the work item', example: 'Implement user authentication' },
          description: { type: 'string', nullable: true, description: 'Detailed description of the work item in markdown', example: 'Add JWT-based auth flow with refresh tokens' },
          status: { $ref: '#/components/schemas/WorkItemStatus', description: 'Current workflow status' },
          priority: { $ref: '#/components/schemas/WorkItemPriority', description: 'Priority ranking of the work item' },
          task_type: { type: 'string', description: 'Legacy task type classifier (use kind instead)', example: 'feature' },
          kind: { $ref: '#/components/schemas/WorkItemKind', description: 'Hierarchy level of the work item' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent work item, or null if top-level', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the work item was created', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'Timestamp of the last update to the work item', example: '2026-02-21T15:00:00Z' },
          not_before: { type: 'string', format: 'date-time', nullable: true, description: 'Reminder / start date — the earliest date the item should be worked on', example: '2026-03-01T09:00:00Z' },
          not_after: { type: 'string', format: 'date-time', nullable: true, description: 'Deadline / end date — the latest date the item should be completed', example: '2026-03-15T17:00:00Z' },
          estimate_minutes: { type: 'integer', nullable: true, description: 'Estimated effort in minutes', example: 120 },
          actual_minutes: { type: 'integer', nullable: true, description: 'Actual effort spent in minutes', example: 90 },
          deleted_at: { type: 'string', format: 'date-time', nullable: true, description: 'Timestamp of soft deletion, or null if active', example: null },
          namespace: { type: 'string', description: 'Namespace scope for multi-tenant isolation', example: 'org-acme' },
          children_count: { type: 'integer', description: 'Number of direct child work items', example: 3 },
          parent: {
            type: 'object',
            nullable: true,
            description: 'Summary of the parent work item, if any',
            required: ['id', 'title', 'kind'],
            properties: {
              id: { type: 'string', format: 'uuid', description: 'Parent work item UUID', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
              title: { type: 'string', description: 'Parent work item title', example: 'Authentication Epic' },
              kind: { type: 'string', description: 'Hierarchy level of the parent', example: 'epic' },
            },
          },
          dependencies: {
            type: 'array',
            description: 'List of work items that block or are blocked by this item',
            items: {
              type: 'object',
              required: ['id', 'title', 'direction'],
              properties: {
                id: { type: 'string', format: 'uuid', description: 'Dependency work item UUID', example: 'b2c3d4e5-6789-01ab-cdef-234567890abc' },
                title: { type: 'string', description: 'Title of the dependency work item', example: 'Set up database schema' },
                kind: { type: 'string', description: 'Hierarchy level of the dependency', example: 'task' },
                status: { type: 'string', description: 'Current status of the dependency', example: 'done' },
                direction: { type: 'string', enum: ['blocks', 'blocked_by'], description: 'Whether this item blocks or is blocked by the dependency', example: 'blocks' },
              },
            },
          },
          attachments: {
            type: 'array',
            description: 'Linked entities (memories and contacts) attached to this work item',
            items: {
              type: 'object',
              required: ['id', 'type', 'title', 'linked_at'],
              properties: {
                id: { type: 'string', format: 'uuid', description: 'Attached entity UUID', example: 'c3d4e5f6-7890-12ab-cdef-345678901234' },
                type: { type: 'string', enum: ['memory', 'contact'], description: 'Type of the attached entity', example: 'memory' },
                title: { type: 'string', description: 'Display title for the attachment', example: 'Auth design decision' },
                subtitle: { type: 'string', nullable: true, description: 'Optional secondary text for display', example: 'JWT with 15-min access tokens' },
                linked_at: { type: 'string', format: 'date-time', description: 'When the entity was linked to this work item', example: '2026-02-21T14:30:00Z' },
              },
            },
          },
        },
      },
      WorkItemCreate: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Title of the work item (required)', example: 'Implement user authentication' },
          description: { type: 'string', nullable: true, description: 'Detailed description in markdown', example: 'Add JWT-based auth flow with refresh tokens' },
          kind: { $ref: '#/components/schemas/WorkItemKind', description: 'Hierarchy level (defaults to task if omitted)' },
          type: { type: 'string', description: 'Alias for kind (client compatibility)', example: 'task' },
          item_type: { type: 'string', description: 'Alias for kind (OpenClaw plugin compatibility)', example: 'task' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent work item', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          estimate_minutes: { type: 'integer', nullable: true, minimum: 0, maximum: 525600, description: 'Estimated effort in minutes (max 1 year)', example: 120 },
          actual_minutes: { type: 'integer', nullable: true, minimum: 0, maximum: 525600, description: 'Actual effort in minutes (max 1 year)', example: 90 },
          recurrence_rule: { type: 'string', description: 'RFC 5545 RRULE string for recurring items', example: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
          recurrence_natural: { type: 'string', description: 'Natural language recurrence description', example: 'every weekday' },
          recurrence_end: { type: 'string', format: 'date-time', description: 'When recurrence stops generating new instances', example: '2026-12-31T23:59:59Z' },
          not_before: { type: 'string', format: 'date-time', nullable: true, description: 'Reminder / start date', example: '2026-03-01T09:00:00Z' },
          not_after: { type: 'string', format: 'date-time', nullable: true, description: 'Deadline / end date', example: '2026-03-15T17:00:00Z' },
        },
      },
      WorkItemUpdate: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Updated title for the work item', example: 'Implement OAuth2 authentication' },
          description: { type: 'string', nullable: true, description: 'Updated description in markdown', example: 'Switch to OAuth2 with PKCE flow' },
          status: { type: 'string', description: 'New status value', example: 'in_progress' },
          priority: { type: 'string', description: 'New priority value (P0-P4)', example: 'P1' },
          task_type: { type: 'string', description: 'Legacy task type classifier', example: 'feature' },
          not_before: { type: 'string', format: 'date-time', nullable: true, description: 'Reminder / start date', example: '2026-03-01T09:00:00Z' },
          not_after: { type: 'string', format: 'date-time', nullable: true, description: 'Deadline / end date', example: '2026-03-15T17:00:00Z' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'New parent work item UUID, or null to make top-level', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          estimate_minutes: { type: 'integer', nullable: true, minimum: 0, maximum: 525600, description: 'Estimated effort in minutes (max 1 year)', example: 180 },
          actual_minutes: { type: 'integer', nullable: true, minimum: 0, maximum: 525600, description: 'Actual effort in minutes (max 1 year)', example: 150 },
        },
      },
      TreeItem: {
        type: 'object',
        required: ['id', 'title', 'kind', 'status', 'level', 'children_count'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the tree node work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Title of the work item', example: 'Implement user authentication' },
          kind: { type: 'string', description: 'Hierarchy level (project, initiative, epic, issue, task)', example: 'epic' },
          status: { type: 'string', description: 'Current workflow status', example: 'in_progress' },
          priority: { type: 'string', description: 'Priority ranking (P0-P4)', example: 'P1' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent node, or null for root nodes', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          level: { type: 'integer', description: 'Depth level in the tree (0 = root)', example: 1 },
          children_count: { type: 'integer', description: 'Number of direct children', example: 5 },
          children: { type: 'array', description: 'Nested child tree items (recursive)', items: { $ref: '#/components/schemas/TreeItem' } },
        },
      },
      WorkItemActivity: {
        type: 'object',
        required: ['id', 'type', 'work_item_id', 'description', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the activity entry', example: 'e4f5a6b7-8901-23cd-ef45-678901234567' },
          type: { type: 'string', description: 'Type of activity (e.g. status_change, update, create)', example: 'status_change' },
          work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item this activity belongs to', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          work_item_title: { type: 'string', description: 'Title of the work item at the time of the activity', example: 'Implement user authentication' },
          actor_email: { type: 'string', nullable: true, description: 'Email address of the user or agent who performed the action', example: 'alice@example.com' },
          description: { type: 'string', description: 'Human-readable description of the activity', example: 'Status changed from open to in_progress' },
          created_at: { type: 'string', format: 'date-time', description: 'When the activity occurred', example: '2026-02-21T14:30:00Z' },
        },
      },
      WorkItemRollup: {
        type: 'object',
        required: ['work_item_id'],
        properties: {
          work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item these metrics roll up for', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          total_estimate_minutes: { type: 'integer', nullable: true, description: 'Sum of estimated minutes across all descendants', example: 480 },
          total_actual_minutes: { type: 'integer', nullable: true, description: 'Sum of actual minutes across all descendants', example: 360 },
        },
      },
      Todo: {
        type: 'object',
        required: ['id', 'text', 'completed', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the todo item', example: 'f5a6b7c8-9012-34de-f567-890123456789' },
          text: { type: 'string', description: 'Text content of the checklist item', example: 'Write unit tests for login endpoint' },
          completed: { type: 'boolean', description: 'Whether the checklist item is completed', example: false },
          created_at: { type: 'string', format: 'date-time', description: 'When the todo was created', example: '2026-02-21T14:30:00Z' },
          completed_at: { type: 'string', format: 'date-time', nullable: true, description: 'When the todo was marked as completed, or null if incomplete', example: null },
        },
      },
      TodoCreate: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', description: 'Text content for the new checklist item', example: 'Write unit tests for login endpoint' },
        },
      },
      TodoUpdate: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Updated text content for the checklist item', example: 'Write integration tests for login endpoint' },
          completed: { type: 'boolean', description: 'Set to true to mark as completed, false to re-open', example: true },
        },
      },
      Comment: {
        type: 'object',
        required: ['id', 'work_item_id', 'user_email', 'content', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the comment', example: 'a6b7c8d9-0123-45ef-6789-012345678901' },
          work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item this comment belongs to', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent comment for threaded replies, or null for top-level comments', example: null },
          user_email: { type: 'string', format: 'email', description: 'Email of the comment author', example: 'alice@example.com' },
          content: { type: 'string', description: 'Comment body text, may contain @mentions', example: 'Looks good! @bob can you review the token refresh logic?' },
          mentions: { type: 'array', items: { type: 'string' }, description: 'List of @mentioned user identifiers extracted from content', example: ['bob'] },
          edited_at: { type: 'string', format: 'date-time', nullable: true, description: 'Timestamp of the last edit, or null if never edited', example: null },
          created_at: { type: 'string', format: 'date-time', description: 'When the comment was posted', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'Timestamp of the last update (includes edits and reactions)', example: '2026-02-21T14:30:00Z' },
          reactions: {
            type: 'object',
            additionalProperties: { type: 'integer' },
            description: 'Map of emoji to reaction count across all users',
            example: { '+1': 3, 'heart': 1 },
          },
        },
      },
      CommentCreate: {
        type: 'object',
        required: ['user_email', 'content'],
        properties: {
          user_email: { type: 'string', format: 'email', description: 'Email of the user posting the comment', example: 'alice@example.com' },
          content: { type: 'string', description: 'Comment body text, may contain @mentions', example: 'Looks good! @bob can you review the token refresh logic?' },
          parent_id: { type: 'string', format: 'uuid', description: 'Parent comment UUID for threaded replies', example: 'a6b7c8d9-0123-45ef-6789-012345678901' },
        },
      },
      CommentUpdate: {
        type: 'object',
        required: ['user_email', 'content'],
        properties: {
          user_email: { type: 'string', format: 'email', description: 'Email of the user editing the comment (must be original author)', example: 'alice@example.com' },
          content: { type: 'string', description: 'Updated comment body text', example: 'Updated: Looks great! @bob the token refresh logic is solid.' },
        },
      },
      ReactionToggle: {
        type: 'object',
        required: ['user_email', 'emoji'],
        properties: {
          user_email: { type: 'string', format: 'email', description: 'Email of the user toggling the reaction', example: 'alice@example.com' },
          emoji: { type: 'string', description: 'Emoji character or shortcode to toggle', example: '+1' },
        },
      },
      PresenceUser: {
        type: 'object',
        required: ['email', 'last_seen_at'],
        properties: {
          email: { type: 'string', format: 'email', description: 'Email of the user with active presence', example: 'alice@example.com' },
          last_seen_at: { type: 'string', format: 'date-time', description: 'Timestamp of the last heartbeat from this user', example: '2026-02-21T14:30:00Z' },
          cursor_position: {
            type: 'object',
            nullable: true,
            description: 'Optional cursor position for collaborative editing',
            properties: {
              section: { type: 'string', description: 'Section or field the user is focused on', example: 'description' },
              offset: { type: 'integer', description: 'Character offset within the section', example: 42 },
            },
          },
        },
      },
      PresenceUpdate: {
        type: 'object',
        required: ['user_email'],
        properties: {
          user_email: { type: 'string', format: 'email', description: 'Email of the user sending the presence heartbeat', example: 'alice@example.com' },
          cursor_position: {
            type: 'object',
            description: 'Optional cursor position for collaborative editing',
            properties: {
              section: { type: 'string', description: 'Section or field the user is focused on', example: 'description' },
              offset: { type: 'integer', description: 'Character offset within the section', example: 42 },
            },
          },
        },
      },
      WorkItemContactLink: {
        type: 'object',
        required: ['contact_id', 'display_name', 'relationship', 'created_at'],
        properties: {
          contact_id: { type: 'string', format: 'uuid', description: 'UUID of the linked contact', example: 'b7c8d9e0-1234-56ab-cdef-789012345678' },
          display_name: { type: 'string', description: 'Display name of the linked contact', example: 'Alice Johnson' },
          relationship: { type: 'string', enum: ['owner', 'assignee', 'stakeholder', 'reviewer'], description: 'Role of the contact relative to the work item', example: 'owner' },
          created_at: { type: 'string', format: 'date-time', description: 'When the link was created', example: '2026-02-21T14:30:00Z' },
        },
      },
      WorkItemContactCreate: {
        type: 'object',
        required: ['contact_id', 'relationship'],
        properties: {
          contact_id: { type: 'string', format: 'uuid', description: 'UUID of the contact to link', example: 'b7c8d9e0-1234-56ab-cdef-789012345678' },
          relationship: { type: 'string', enum: ['owner', 'assignee', 'stakeholder', 'reviewer'], description: 'Role of the contact relative to the work item', example: 'owner' },
        },
      },
      WorkItemMemory: {
        type: 'object',
        required: ['id', 'title', 'content', 'type', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the memory', example: 'c8d9e0f1-2345-67ab-cdef-890123456789' },
          title: { type: 'string', description: 'Title of the memory entry', example: 'Auth design decision' },
          content: { type: 'string', description: 'Full content of the memory in markdown', example: 'Decided to use JWT with 15-minute access tokens and 7-day refresh tokens.' },
          type: { type: 'string', enum: ['note', 'decision', 'context', 'reference'], description: 'Category of the memory', example: 'note' },
          created_at: { type: 'string', format: 'date-time', description: 'When the memory was created', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'When the memory was last updated', example: '2026-02-21T15:00:00Z' },
        },
      },
      WorkItemMemoryCreate: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string', description: 'Title for the new memory entry', example: 'Auth design decision' },
          content: { type: 'string', description: 'Full content of the memory in markdown', example: 'Decided to use JWT with 15-minute access tokens and 7-day refresh tokens.' },
          type: { type: 'string', enum: ['note', 'decision', 'context', 'reference'], default: 'note', description: 'Category of the memory (defaults to note)', example: 'note' },
        },
      },
      WorkItemAttachment: {
        type: 'object',
        required: ['id', 'original_filename', 'content_type', 'size_bytes', 'created_at', 'attached_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the file attachment', example: 'd9e0f1a2-3456-78ab-cdef-901234567890' },
          original_filename: { type: 'string', description: 'Original filename when the file was uploaded', example: 'auth-flow-diagram.png' },
          content_type: { type: 'string', description: 'MIME type of the file', example: 'image/png' },
          size_bytes: { type: 'integer', description: 'File size in bytes', example: 245760 },
          created_at: { type: 'string', format: 'date-time', description: 'When the file was uploaded', example: '2026-02-21T14:30:00Z' },
          attached_at: { type: 'string', format: 'date-time', description: 'When the file was attached to this work item', example: '2026-02-21T14:35:00Z' },
          attached_by: { type: 'string', nullable: true, description: 'Email of the user who attached the file, or null if system-attached', example: 'alice@example.com' },
        },
      },
      WorkItemAttachmentCreate: {
        type: 'object',
        required: ['file_id'],
        properties: {
          file_id: { type: 'string', format: 'uuid', description: 'UUID of the previously uploaded file to attach', example: 'd9e0f1a2-3456-78ab-cdef-901234567890' },
        },
      },
      LinkedEmail: {
        type: 'object',
        required: ['id', 'has_attachments', 'is_read'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the email message', example: 'e0f1a2b3-4567-89ab-cdef-012345678901' },
          subject: { type: 'string', nullable: true, description: 'Email subject line', example: 'Re: Auth implementation plan' },
          from: { type: 'string', nullable: true, description: 'Sender email address', example: 'bob@example.com' },
          to: { type: 'string', nullable: true, description: 'Recipient email address(es)', example: 'alice@example.com' },
          date: { type: 'string', format: 'date-time', nullable: true, description: 'Date the email was sent', example: '2026-02-20T10:15:00Z' },
          snippet: { type: 'string', nullable: true, description: 'Preview snippet of the email body', example: 'Hey Alice, I reviewed the auth design and have some suggestions...' },
          body: { type: 'string', nullable: true, description: 'Full email body text', example: 'Hey Alice, I reviewed the auth design and have some suggestions for the token refresh logic...' },
          has_attachments: { type: 'boolean', description: 'Whether the email has file attachments', example: false },
          is_read: { type: 'boolean', description: 'Whether the email has been read', example: true },
        },
      },
      LinkedCalendarEvent: {
        type: 'object',
        required: ['id', 'is_all_day'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the calendar event', example: 'f1a2b3c4-5678-90ab-cdef-123456789012' },
          title: { type: 'string', nullable: true, description: 'Title of the calendar event', example: 'Auth Sprint Planning' },
          description: { type: 'string', nullable: true, description: 'Description of the calendar event', example: 'Review auth implementation progress and plan next steps' },
          start_time: { type: 'string', format: 'date-time', nullable: true, description: 'Start time of the event', example: '2026-02-22T09:00:00Z' },
          end_time: { type: 'string', format: 'date-time', nullable: true, description: 'End time of the event', example: '2026-02-22T10:00:00Z' },
          is_all_day: { type: 'boolean', description: 'Whether this is an all-day event', example: false },
          location: { type: 'string', nullable: true, description: 'Event location or meeting room', example: 'Conference Room A' },
          attendees: {
            type: 'array',
            description: 'List of event attendees',
            items: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', description: 'Attendee email address', example: 'alice@example.com' },
                name: { type: 'string', description: 'Attendee display name', example: 'Alice Johnson' },
                status: { type: 'string', description: 'RSVP status (accepted, declined, tentative, needsAction)', example: 'accepted' },
              },
            },
          },
          organizer: {
            type: 'object',
            nullable: true,
            description: 'Event organizer details',
            properties: {
              email: { type: 'string', description: 'Organizer email address', example: 'alice@example.com' },
              name: { type: 'string', description: 'Organizer display name', example: 'Alice Johnson' },
            },
          },
          meeting_link: { type: 'string', nullable: true, description: 'URL for joining the meeting (Teams, Zoom, etc.)', example: 'https://meet.example.com/auth-sprint' },
        },
      },
      CommunicationCreate: {
        type: 'object',
        required: ['thread_id'],
        properties: {
          thread_id: { type: 'string', format: 'uuid', description: 'UUID of the external communication thread to link', example: 'a2b3c4d5-6789-01ab-cdef-234567890123' },
          message_id: { type: 'string', format: 'uuid', nullable: true, description: 'Optional specific message UUID within the thread', example: 'b3c4d5e6-7890-12ab-cdef-345678901234' },
          action: { type: 'string', enum: ['reply_required', 'follow_up'], description: 'Action context for the linked communication', example: 'reply_required' },
        },
      },
      RelatedEntities: {
        type: 'object',
        required: ['work_item_id'],
        properties: {
          work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item these related entities belong to', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          contacts: {
            type: 'object',
            description: 'Contacts related to this work item via direct links or through memories',
            properties: {
              direct: {
                type: 'array',
                description: 'Contacts directly linked to this work item',
                items: {
                  type: 'object',
                  required: ['contact_id', 'display_name', 'relationship'],
                  properties: {
                    contact_id: { type: 'string', format: 'uuid', description: 'Contact UUID', example: 'b7c8d9e0-1234-56ab-cdef-789012345678' },
                    display_name: { type: 'string', description: 'Contact display name', example: 'Alice Johnson' },
                    relationship: { type: 'string', description: 'Relationship role', example: 'assignee' },
                  },
                },
              },
              via_memory: {
                type: 'array',
                description: 'Contacts discovered through linked memories',
                items: {
                  type: 'object',
                  required: ['contact_id', 'display_name', 'memory_id'],
                  properties: {
                    contact_id: { type: 'string', format: 'uuid', description: 'Contact UUID', example: 'c8d9e0f1-2345-67ab-cdef-890123456789' },
                    display_name: { type: 'string', description: 'Contact display name', example: 'Bob Smith' },
                    memory_id: { type: 'string', format: 'uuid', description: 'Memory UUID that links this contact', example: 'd9e0f1a2-3456-78ab-cdef-901234567890' },
                  },
                },
              },
            },
          },
          memories: {
            type: 'object',
            description: 'Memories related to this work item via direct links or semantic similarity',
            properties: {
              direct: {
                type: 'array',
                description: 'Memories directly linked to this work item',
                items: {
                  type: 'object',
                  required: ['id', 'title', 'type'],
                  properties: {
                    id: { type: 'string', format: 'uuid', description: 'Memory UUID', example: 'c8d9e0f1-2345-67ab-cdef-890123456789' },
                    title: { type: 'string', description: 'Memory title', example: 'Auth design decision' },
                    type: { type: 'string', description: 'Memory type (note, decision, context, reference)', example: 'decision' },
                  },
                },
              },
              semantically_similar: {
                type: 'array',
                description: 'Memories found via pgvector semantic similarity search',
                items: {
                  type: 'object',
                  required: ['id', 'title', 'type', 'similarity'],
                  properties: {
                    id: { type: 'string', format: 'uuid', description: 'Memory UUID', example: 'e0f1a2b3-4567-89ab-cdef-012345678901' },
                    title: { type: 'string', description: 'Memory title', example: 'Token rotation strategy' },
                    type: { type: 'string', description: 'Memory type', example: 'decision' },
                    similarity: { type: 'number', description: 'Cosine similarity score (0-1)', example: 0.85 },
                  },
                },
              },
            },
          },
          threshold_used: { type: 'number', description: 'The similarity threshold that was applied for semantic matches', example: 0.6 },
        },
      },
      CalendarEntry: {
        type: 'object',
        required: ['id', 'title', 'status', 'kind', 'priority', 'type'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'UUID of the work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Title of the work item', example: 'Implement user authentication' },
          description: { type: 'string', nullable: true, description: 'Description of the work item', example: 'Add JWT-based auth flow with refresh tokens' },
          status: { type: 'string', description: 'Current workflow status', example: 'in_progress' },
          kind: { type: 'string', description: 'Hierarchy level (project, initiative, epic, issue, task)', example: 'task' },
          start_date: { type: 'string', format: 'date-time', nullable: true, description: 'Start date (not_before) of the work item', example: '2026-03-01T09:00:00Z' },
          end_date: { type: 'string', format: 'date-time', nullable: true, description: 'Deadline (not_after) of the work item', example: '2026-03-15T17:00:00Z' },
          priority: { type: 'string', description: 'Priority ranking (P0-P4)', example: 'P1' },
          type: { type: 'string', description: 'Calendar entry type', example: 'work_item_deadline' },
        },
      },
    },

    paths: {
      // ==================== Collection routes ====================
      '/api/work-items': {
        get: {
          operationId: 'listWorkItems',
          summary: 'List work items',
          description: 'Returns work items ordered by creation date descending. Soft-deleted items are excluded by default.',
          tags: ['Work Items'],
          parameters: [
            namespaceParam(),
            {
              name: 'include_deleted',
              in: 'query',
              description: 'Include soft-deleted items in results',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
            {
              name: 'status',
              in: 'query',
              description: 'Filter by status. Use "active" as a meta-status to exclude completed/closed/done/cancelled items.',
              schema: { type: 'string' },
              example: 'active',
            },
            {
              name: 'kind',
              in: 'query',
              description: 'Filter by work item kind (project, initiative, epic, issue, task). Alias for item_type.',
              schema: { type: 'string' },
              example: 'task',
            },
            {
              name: 'item_type',
              in: 'query',
              description: 'Filter by work item kind. Deprecated — use `kind` instead.',
              schema: { type: 'string' },
              deprecated: true,
            },
            {
              name: 'parent_id',
              in: 'query',
              description: 'Filter by parent work item ID. Alias for parent_work_item_id.',
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'parent_work_item_id',
              in: 'query',
              description: 'Filter by parent work item ID. Deprecated — use `parent_id` instead.',
              schema: { type: 'string', format: 'uuid' },
              deprecated: true,
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of results to return (1–200, default 50).',
              schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
              example: 50,
            },
          ],
          responses: {
            '200': jsonResponse('List of work items', {
              type: 'object',
              properties: {
                items: { type: 'array', description: 'Array of work item summaries', items: ref('WorkItemSummary') },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
        post: {
          operationId: 'createWorkItem',
          summary: 'Create a work item',
          description: 'Creates a new work item. Validates hierarchy constraints (e.g. epic must have initiative parent). Generates embedding for semantic search.',
          tags: ['Work Items'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('WorkItemCreate')),
          responses: {
            '201': jsonResponse('Created work item', ref('WorkItem')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/work-items/tree': {
        get: {
          operationId: 'getWorkItemTree',
          summary: 'Get hierarchical work item tree',
          description: 'Returns work items in a hierarchical tree structure using a recursive CTE. Optionally starts from a specific root item.',
          tags: ['Work Items'],
          parameters: [
            namespaceParam(),
            {
              name: 'root_id',
              in: 'query',
              description: 'UUID of the root item. If omitted, returns all top-level items.',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
            {
              name: 'depth',
              in: 'query',
              description: 'Maximum tree depth (default: 10, max: 20)',
              schema: { type: 'integer', default: 10, maximum: 20 },
              example: 10,
            },
          ],
          responses: {
            '200': jsonResponse('Tree of work items', {
              type: 'object',
              properties: {
                items: { type: 'array', description: 'Array of top-level tree items with nested children', items: ref('TreeItem') },
              },
            }),
            ...errorResponses(401, 403, 404, 500),
          },
        },
      },

      '/api/work-items/calendar': {
        get: {
          operationId: 'listWorkItemsCalendar',
          summary: 'List work items as calendar entries',
          description: 'Returns work items that have a deadline (not_after) formatted for calendar display.',
          tags: ['Work Items'],
          parameters: [
            namespaceParam(),
            {
              name: 'start_date',
              in: 'query',
              description: 'Filter entries with deadline on or after this date',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-01T00:00:00Z',
            },
            {
              name: 'end_date',
              in: 'query',
              description: 'Filter entries with deadline on or before this date',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-03-31T23:59:59Z',
            },
            {
              name: 'kind',
              in: 'query',
              description: 'Filter by work item kind',
              schema: { type: 'string' },
              example: 'task',
            },
            {
              name: 'status',
              in: 'query',
              description: 'Filter by status',
              schema: { type: 'string' },
              example: 'in_progress',
            },
          ],
          responses: {
            '200': jsonResponse('Calendar entries', {
              type: 'object',
              properties: {
                entries: { type: 'array', description: 'Array of work items formatted as calendar entries', items: ref('CalendarEntry') },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },

      // ==================== Single item routes ====================
      '/api/work-items/{id}': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'getWorkItem',
          summary: 'Get a work item',
          description: 'Returns a single work item with parent info, dependencies, and linked attachments (memories and contacts).',
          tags: ['Work Items'],
          parameters: [
            {
              name: 'include_deleted',
              in: 'query',
              description: 'Include soft-deleted items in results',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
          ],
          responses: {
            '200': jsonResponse('Work item details', ref('WorkItem')),
            ...errorResponses(401, 404, 500),
          },
        },
        put: {
          operationId: 'updateWorkItem',
          summary: 'Update a work item',
          description: 'Full update of a work item. Validates hierarchy constraints and re-generates embedding on title/description change.',
          tags: ['Work Items'],
          requestBody: jsonBody(ref('WorkItemUpdate')),
          responses: {
            '200': jsonResponse('Updated work item', ref('WorkItem')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteWorkItem',
          summary: 'Delete a work item',
          description: 'Soft-deletes a work item by default. Pass permanent=true for hard delete.',
          tags: ['Work Items'],
          parameters: [
            {
              name: 'permanent',
              in: 'query',
              description: 'If true, permanently delete instead of soft-delete',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
          ],
          responses: {
            '204': { description: 'Work item deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/restore': {
        parameters: [workItemIdParam],
        post: {
          operationId: 'restoreWorkItem',
          summary: 'Restore a soft-deleted work item',
          description: 'Restores a previously soft-deleted work item by clearing its deleted_at timestamp.',
          tags: ['Work Items'],
          responses: {
            '200': jsonResponse('Restored work item', {
              type: 'object',
              required: ['restored', 'id', 'title'],
              properties: {
                restored: { type: 'boolean', description: 'Whether the restore operation succeeded', example: true },
                id: { type: 'string', format: 'uuid', description: 'UUID of the restored work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                title: { type: 'string', description: 'Title of the restored work item', example: 'Implement user authentication' },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // ==================== Patch operations ====================
      '/api/work-items/{id}/status': {
        parameters: [workItemIdParam],
        patch: {
          operationId: 'updateWorkItemStatus',
          summary: 'Update work item status',
          description: 'Changes the status of a work item and records a status_change activity.',
          tags: ['Work Items'],
          requestBody: jsonBody({
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', description: 'New status value to set', example: 'in_progress' },
            },
          }),
          responses: {
            '200': jsonResponse('Updated work item', {
              type: 'object',
              required: ['id', 'title', 'status', 'updated_at'],
              properties: {
                id: { type: 'string', format: 'uuid', description: 'UUID of the updated work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                title: { type: 'string', description: 'Title of the work item', example: 'Implement user authentication' },
                status: { type: 'string', description: 'New status after the update', example: 'in_progress' },
                priority: { type: 'string', description: 'Current priority of the work item', example: 'P1' },
                updated_at: { type: 'string', format: 'date-time', description: 'Timestamp of the status change', example: '2026-02-21T15:00:00Z' },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/hierarchy': {
        parameters: [workItemIdParam],
        patch: {
          operationId: 'updateWorkItemHierarchy',
          summary: 'Change work item kind and parent',
          description: 'Updates the hierarchy level (kind) and optionally the parent of a work item. Validates hierarchy constraints.',
          tags: ['Work Items'],
          requestBody: jsonBody({
            type: 'object',
            required: ['kind'],
            properties: {
              kind: { $ref: '#/components/schemas/WorkItemKind', description: 'New hierarchy level for the work item' },
              parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'New parent work item UUID, or null to make top-level', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
            },
          }),
          responses: {
            '200': jsonResponse('Updated work item', ref('WorkItem')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/reparent': {
        parameters: [workItemIdParam],
        patch: {
          operationId: 'reparentWorkItem',
          summary: 'Move work item to a new parent',
          description: 'Reparents a work item under a new parent, optionally positioning it after a specific sibling. Validates hierarchy constraints and prevents self-reparenting.',
          tags: ['Work Items'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              new_parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'New parent ID, or null to make top-level', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
              after_id: { type: 'string', format: 'uuid', nullable: true, description: 'Sibling ID to position after in new parent', example: 'b2c3d4e5-6789-01ab-cdef-234567890abc' },
            },
          }),
          responses: {
            '200': jsonResponse('Reparented work item', {
              type: 'object',
              required: ['ok', 'item'],
              properties: {
                ok: { type: 'boolean', description: 'Whether the reparent operation succeeded', example: true },
                item: ref('WorkItemSummary'),
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/reorder': {
        parameters: [workItemIdParam],
        patch: {
          operationId: 'reorderWorkItem',
          summary: 'Reorder work item among siblings',
          description: 'Changes the sort position of a work item relative to its siblings. Provide exactly one of after_id or before_id.',
          tags: ['Work Items'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              after_id: { type: 'string', format: 'uuid', nullable: true, description: 'Position after this sibling (null = move to first)', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
              before_id: { type: 'string', format: 'uuid', nullable: true, description: 'Position before this sibling (null = move to last)', example: 'b2c3d4e5-6789-01ab-cdef-234567890abc' },
            },
          }),
          responses: {
            '200': jsonResponse('Reordered work item', {
              type: 'object',
              required: ['ok', 'item'],
              properties: {
                ok: { type: 'boolean', description: 'Whether the reorder operation succeeded', example: true },
                item: {
                  type: 'object',
                  required: ['id', 'title', 'status', 'sort_order', 'updated_at'],
                  properties: {
                    id: { type: 'string', format: 'uuid', description: 'UUID of the reordered work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                    title: { type: 'string', description: 'Title of the work item', example: 'Implement user authentication' },
                    status: { type: 'string', description: 'Current status of the work item', example: 'in_progress' },
                    sort_order: { type: 'integer', description: 'New sort position among siblings', example: 3 },
                    updated_at: { type: 'string', format: 'date-time', description: 'Timestamp of the reorder', example: '2026-02-21T15:00:00Z' },
                  },
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/dates': {
        parameters: [workItemIdParam],
        patch: {
          operationId: 'updateWorkItemDates',
          summary: 'Update work item dates',
          description: 'Updates the start date (not_before) and/or end date (not_after) of a work item. Dates must be in YYYY-MM-DD format. Schedules or clears reminder jobs.',
          tags: ['Work Items'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              start_date: { type: 'string', format: 'date', nullable: true, description: 'Start/reminder date (YYYY-MM-DD)', example: '2026-03-01' },
              end_date: { type: 'string', format: 'date', nullable: true, description: 'End/deadline date (YYYY-MM-DD)', example: '2026-03-15' },
            },
          }),
          responses: {
            '200': jsonResponse('Updated dates', {
              type: 'object',
              required: ['ok', 'item'],
              properties: {
                ok: { type: 'boolean', description: 'Whether the date update succeeded', example: true },
                item: {
                  type: 'object',
                  required: ['id', 'updated_at'],
                  properties: {
                    id: { type: 'string', format: 'uuid', description: 'UUID of the updated work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                    start_date: { type: 'string', format: 'date', nullable: true, description: 'Updated start date', example: '2026-03-01' },
                    end_date: { type: 'string', format: 'date', nullable: true, description: 'Updated end date', example: '2026-03-15' },
                    updated_at: { type: 'string', format: 'date-time', description: 'Timestamp of the update', example: '2026-02-21T15:00:00Z' },
                  },
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // ==================== Rollup & Activity ====================
      '/api/work-items/{id}/rollup': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'getWorkItemRollup',
          summary: 'Get rollup metrics for a work item',
          description: 'Returns aggregated estimate and actual minutes from the appropriate rollup view based on the work item kind.',
          tags: ['Work Items'],
          responses: {
            '200': jsonResponse('Rollup metrics', ref('WorkItemRollup')),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/activity': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemActivity',
          summary: 'List activity for a work item',
          description: 'Returns activity entries (status changes, updates, etc.) for a work item ordered by most recent first.',
          tags: ['Work Items'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum results (default: 50, max: 100)',
              schema: { type: 'integer', default: 50, maximum: 100 },
              example: 50,
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of results to skip',
              schema: { type: 'integer', default: 0 },
              example: 0,
            },
          ],
          responses: {
            '200': jsonResponse('Activity entries', {
              type: 'object',
              properties: {
                items: { type: 'array', description: 'Array of activity entries', items: ref('WorkItemActivity') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // ==================== Todos ====================
      '/api/work-items/{id}/todos': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemTodos',
          summary: 'List todos for a work item',
          description: 'Returns all checklist items for a work item ordered by creation date.',
          tags: ['Work Item Todos'],
          responses: {
            '200': jsonResponse('Todo list', {
              type: 'object',
              properties: {
                todos: { type: 'array', description: 'Array of checklist items', items: ref('Todo') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'createWorkItemTodo',
          summary: 'Create a todo',
          description: 'Adds a new checklist item to a work item.',
          tags: ['Work Item Todos'],
          requestBody: jsonBody(ref('TodoCreate')),
          responses: {
            '201': jsonResponse('Created todo', ref('Todo')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/todos/{todo_id}': {
        parameters: [
          workItemIdParam,
          uuidParam('todo_id', 'Todo UUID'),
        ],
        patch: {
          operationId: 'updateWorkItemTodo',
          summary: 'Update a todo',
          description: 'Updates the text and/or completion status of a todo. Setting completed to true sets completed_at; false clears it.',
          tags: ['Work Item Todos'],
          requestBody: jsonBody(ref('TodoUpdate')),
          responses: {
            '200': jsonResponse('Updated todo', ref('Todo')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteWorkItemTodo',
          summary: 'Delete a todo',
          description: 'Permanently removes a checklist item from a work item.',
          tags: ['Work Item Todos'],
          responses: {
            '204': { description: 'Todo deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // ==================== Comments ====================
      '/api/work-items/{id}/comments': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemComments',
          summary: 'List comments on a work item',
          description: 'Returns all comments with reactions, ordered by creation date ascending (oldest first).',
          tags: ['Work Item Comments'],
          responses: {
            '200': jsonResponse('Comments', {
              type: 'object',
              properties: {
                comments: { type: 'array', description: 'Array of comments with reactions', items: ref('Comment') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'createWorkItemComment',
          summary: 'Create a comment',
          description: 'Adds a comment to a work item. Automatically extracts @mentions from content.',
          tags: ['Work Item Comments'],
          requestBody: jsonBody(ref('CommentCreate')),
          responses: {
            '201': jsonResponse('Created comment', ref('Comment')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/comments/{comment_id}': {
        parameters: [
          workItemIdParam,
          uuidParam('comment_id', 'Comment UUID'),
        ],
        put: {
          operationId: 'updateWorkItemComment',
          summary: 'Update a comment',
          description: 'Updates comment content. Only the comment author can edit. Sets edited_at timestamp.',
          tags: ['Work Item Comments'],
          requestBody: jsonBody(ref('CommentUpdate')),
          responses: {
            '200': jsonResponse('Updated comment', ref('Comment')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteWorkItemComment',
          summary: 'Delete a comment',
          description: 'Deletes a comment. Only the comment author can delete. Requires user_email query parameter.',
          tags: ['Work Item Comments'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              required: true,
              description: 'Email of the user requesting deletion (must be comment author)',
              schema: { type: 'string', format: 'email' },
              example: 'alice@example.com',
            },
          ],
          responses: {
            '200': jsonResponse('Deletion result', ref('SuccessMessage')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/comments/{comment_id}/reactions': {
        parameters: [
          workItemIdParam,
          uuidParam('comment_id', 'Comment UUID'),
        ],
        post: {
          operationId: 'toggleCommentReaction',
          summary: 'Toggle a reaction on a comment',
          description: 'Adds a reaction if it does not exist, or removes it if it does (toggle behavior).',
          tags: ['Work Item Comments'],
          requestBody: jsonBody(ref('ReactionToggle')),
          responses: {
            '201': jsonResponse('Reaction added', {
              type: 'object',
              required: ['action'],
              properties: { action: { type: 'string', enum: ['added'], description: 'Indicates the reaction was added', example: 'added' } },
            }),
            '200': jsonResponse('Reaction removed', {
              type: 'object',
              required: ['action'],
              properties: { action: { type: 'string', enum: ['removed'], description: 'Indicates the reaction was removed', example: 'removed' } },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // ==================== Presence ====================
      '/api/work-items/{id}/presence': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'getWorkItemPresence',
          summary: 'Get active users viewing a work item',
          description: 'Returns users with recent presence (within the last 5 minutes).',
          tags: ['Work Item Presence'],
          responses: {
            '200': jsonResponse('Active users', {
              type: 'object',
              properties: {
                users: { type: 'array', description: 'Array of users currently viewing this work item', items: ref('PresenceUser') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'updateWorkItemPresence',
          summary: 'Update user presence on a work item',
          description: 'Upserts the user presence record with the current timestamp and optional cursor position.',
          tags: ['Work Item Presence'],
          requestBody: jsonBody(ref('PresenceUpdate')),
          responses: {
            '200': jsonResponse('Presence updated', ref('SuccessMessage')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'removeWorkItemPresence',
          summary: 'Remove user presence from a work item',
          description: 'Removes the presence record for a user. Requires user_email query parameter.',
          tags: ['Work Item Presence'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              required: true,
              description: 'Email of the user to remove',
              schema: { type: 'string', format: 'email' },
              example: 'alice@example.com',
            },
          ],
          responses: {
            '200': jsonResponse('Presence removed', ref('SuccessMessage')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // ==================== Contacts ====================
      '/api/work-items/{id}/contacts': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemContacts',
          summary: 'List contacts linked to a work item',
          description: 'Returns all contacts linked to a work item with their relationship roles.',
          tags: ['Work Item Contacts'],
          responses: {
            '200': jsonResponse('Linked contacts', {
              type: 'object',
              properties: {
                contacts: { type: 'array', description: 'Array of contact links with relationship roles', items: ref('WorkItemContactLink') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'linkContactToWorkItem',
          summary: 'Link a contact to a work item',
          description: 'Creates a relationship between a contact and a work item. Returns 409 if already linked.',
          tags: ['Work Item Contacts'],
          requestBody: jsonBody(ref('WorkItemContactCreate')),
          responses: {
            '201': jsonResponse('Contact linked', {
              type: 'object',
              required: ['work_item_id', 'contact_id', 'relationship', 'contact_name'],
              properties: {
                work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                contact_id: { type: 'string', format: 'uuid', description: 'UUID of the linked contact', example: 'b7c8d9e0-1234-56ab-cdef-789012345678' },
                relationship: { type: 'string', description: 'Relationship role of the contact', example: 'assignee' },
                contact_name: { type: 'string', description: 'Display name of the linked contact', example: 'Alice Johnson' },
              },
            }),
            ...errorResponses(400, 401, 404, 409, 500),
          },
        },
      },

      '/api/work-items/{id}/contacts/{contact_id}': {
        parameters: [
          workItemIdParam,
          uuidParam('contact_id', 'Contact UUID'),
        ],
        delete: {
          operationId: 'unlinkContactFromWorkItem',
          summary: 'Unlink a contact from a work item',
          description: 'Removes the relationship between a contact and a work item.',
          tags: ['Work Item Contacts'],
          responses: {
            '204': { description: 'Contact unlinked' },
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // ==================== Memories ====================
      '/api/work-items/{id}/memories': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemMemories',
          summary: 'List memories for a work item',
          description: 'Returns all contextual memories attached to a work item.',
          tags: ['Work Item Memories'],
          responses: {
            '200': jsonResponse('Memories', {
              type: 'object',
              properties: {
                memories: { type: 'array', description: 'Array of memory entries', items: ref('WorkItemMemory') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'createWorkItemMemory',
          summary: 'Create a memory for a work item',
          description: 'Attaches a new contextual memory to a work item. Generates an embedding for semantic search.',
          tags: ['Work Item Memories'],
          requestBody: jsonBody(ref('WorkItemMemoryCreate')),
          responses: {
            '201': jsonResponse('Created memory', ref('WorkItemMemory')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // ==================== Attachments ====================
      '/api/work-items/{id}/attachments': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemAttachments',
          summary: 'List file attachments on a work item',
          description: 'Returns all files attached to a work item with metadata.',
          tags: ['Work Item Attachments'],
          responses: {
            '200': jsonResponse('Attachments', {
              type: 'object',
              properties: {
                attachments: { type: 'array', description: 'Array of file attachments', items: ref('WorkItemAttachment') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'attachFileToWorkItem',
          summary: 'Attach a file to a work item',
          description: 'Links an existing file (uploaded via /api/files/upload) to a work item.',
          tags: ['Work Item Attachments'],
          requestBody: jsonBody(ref('WorkItemAttachmentCreate')),
          responses: {
            '201': jsonResponse('File attached', {
              type: 'object',
              required: ['work_item_id', 'file_id', 'attached'],
              properties: {
                work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                file_id: { type: 'string', format: 'uuid', description: 'UUID of the attached file', example: 'd9e0f1a2-3456-78ab-cdef-901234567890' },
                attached: { type: 'boolean', description: 'Whether the attachment was successful', example: true },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{work_item_id}/attachments/{file_id}': {
        parameters: [
          uuidParam('work_item_id', 'Work item UUID'),
          uuidParam('file_id', 'File attachment UUID'),
        ],
        delete: {
          operationId: 'removeAttachmentFromWorkItem',
          summary: 'Remove a file attachment from a work item',
          description: 'Unlinks a file from a work item. Does not delete the file itself.',
          tags: ['Work Item Attachments'],
          responses: {
            '204': { description: 'Attachment removed' },
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // ==================== Communications ====================
      '/api/work-items/{id}/communications': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemCommunications',
          summary: 'List communications linked to a work item',
          description: 'Returns emails and calendar events linked via external threads.',
          tags: ['Work Item Communications'],
          responses: {
            '200': jsonResponse('Communications', {
              type: 'object',
              properties: {
                emails: { type: 'array', description: 'Email messages linked to this work item', items: ref('LinkedEmail') },
                calendar_events: { type: 'array', description: 'Calendar events linked to this work item', items: ref('LinkedCalendarEvent') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'linkCommunicationToWorkItem',
          summary: 'Link a communication thread to a work item',
          description: 'Creates a link between an external communication thread and a work item.',
          tags: ['Work Item Communications'],
          requestBody: jsonBody(ref('CommunicationCreate')),
          responses: {
            '201': jsonResponse('Communication linked', {
              type: 'object',
              required: ['work_item_id', 'thread_id'],
              properties: {
                work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                thread_id: { type: 'string', format: 'uuid', description: 'UUID of the linked communication thread', example: 'a2b3c4d5-6789-01ab-cdef-234567890123' },
                message_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the specific message, if provided', example: 'b3c4d5e6-7890-12ab-cdef-345678901234' },
                action: { type: 'string', description: 'Action context for the link', example: 'reply_required' },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/communications/{comm_id}': {
        parameters: [
          workItemIdParam,
          uuidParam('comm_id', 'Communication thread UUID'),
        ],
        delete: {
          operationId: 'unlinkCommunicationFromWorkItem',
          summary: 'Unlink a communication from a work item',
          description: 'Removes the link between a communication thread and a work item.',
          tags: ['Work Item Communications'],
          responses: {
            '204': { description: 'Communication unlinked' },
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // ==================== Emails ====================
      '/api/work-items/{id}/emails': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemEmails',
          summary: 'List linked emails for a work item',
          description: 'Returns emails linked to a work item via the email channel, with parsed metadata.',
          tags: ['Work Item Communications'],
          responses: {
            '200': jsonResponse('Linked emails', {
              type: 'object',
              properties: {
                emails: { type: 'array', description: 'Array of linked email messages', items: ref('LinkedEmail') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'linkEmailToWorkItem',
          summary: 'Link an email to a work item',
          description: 'Associates an email message with a work item for tracking.',
          tags: ['Work Item Communications'],
          requestBody: jsonBody({
            type: 'object',
            required: ['email_id'],
            properties: {
              email_id: { type: 'string', format: 'uuid', description: 'UUID of the email message to link', example: 'e0f1a2b3-4567-89ab-cdef-012345678901' },
            },
          }),
          responses: {
            '201': jsonResponse('Email linked', {
              type: 'object',
              required: ['work_item_id', 'email_id'],
              properties: {
                work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                email_id: { type: 'string', format: 'uuid', description: 'UUID of the linked email', example: 'e0f1a2b3-4567-89ab-cdef-012345678901' },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/emails/{email_id}': {
        parameters: [
          workItemIdParam,
          uuidParam('email_id', 'Email message UUID'),
        ],
        delete: {
          operationId: 'unlinkEmailFromWorkItem',
          summary: 'Unlink an email from a work item',
          description: 'Removes the link between an email message and a work item.',
          tags: ['Work Item Communications'],
          responses: {
            '204': { description: 'Email unlinked' },
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // ==================== Calendar ====================
      '/api/work-items/{id}/calendar': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemCalendarEvents',
          summary: 'List linked calendar events for a work item',
          description: 'Returns calendar events linked to a work item, parsed from raw message data.',
          tags: ['Work Item Communications'],
          responses: {
            '200': jsonResponse('Calendar events', {
              type: 'object',
              properties: {
                events: { type: 'array', description: 'Array of linked calendar events', items: ref('LinkedCalendarEvent') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'linkCalendarEventToWorkItem',
          summary: 'Link a calendar event to a work item',
          description: 'Associates a calendar event with a work item for tracking.',
          tags: ['Work Item Communications'],
          requestBody: jsonBody({
            type: 'object',
            required: ['event_id'],
            properties: {
              event_id: { type: 'string', format: 'uuid', description: 'UUID of the calendar event to link', example: 'f1a2b3c4-5678-90ab-cdef-123456789012' },
            },
          }),
          responses: {
            '201': jsonResponse('Calendar event linked', {
              type: 'object',
              required: ['work_item_id', 'event_id'],
              properties: {
                work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                event_id: { type: 'string', format: 'uuid', description: 'UUID of the linked calendar event', example: 'f1a2b3c4-5678-90ab-cdef-123456789012' },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/calendar/{event_id}': {
        parameters: [
          workItemIdParam,
          uuidParam('event_id', 'Calendar event UUID'),
        ],
        delete: {
          operationId: 'unlinkCalendarEventFromWorkItem',
          summary: 'Unlink a calendar event from a work item',
          description: 'Removes the link between a calendar event and a work item.',
          tags: ['Work Item Communications'],
          responses: {
            '204': { description: 'Calendar event unlinked' },
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // ==================== Related Entities ====================
      '/api/work-items/{id}/related-entities': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'getWorkItemRelatedEntities',
          summary: 'Get related entities for a work item',
          description: 'Returns directly linked contacts and memories, contacts linked through memories, and semantically similar memories (using pgvector embeddings).',
          tags: ['Work Items'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of similar memories to return (default: 10, max: 50)',
              schema: { type: 'integer', default: 10, maximum: 50 },
              example: 10,
            },
            {
              name: 'threshold',
              in: 'query',
              description: 'Minimum similarity threshold for semantic matches (0-1, default: 0.6)',
              schema: { type: 'number', default: 0.6, minimum: 0, maximum: 1 },
              example: 0.6,
            },
          ],
          responses: {
            '200': jsonResponse('Related entities', ref('RelatedEntities')),
            ...errorResponses(401, 404, 500),
          },
        },
      },
    },
  };
}
