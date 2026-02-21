/**
 * OpenAPI path definitions for webhooks and notifications.
 * Routes: GET /api/webhooks/outbox, POST /api/webhooks/:id/retry,
 *         GET /api/webhooks/status, POST /api/webhooks/process,
 *         POST /api/webhooks/:webhook_id,
 *         GET /api/notifications, GET /api/notifications/unread-count,
 *         POST /api/notifications/:id/read, POST /api/notifications/read-all,
 *         DELETE /api/notifications/:id,
 *         GET /api/notifications/preferences, PATCH /api/notifications/preferences,
 *         POST /api/projects/:id/webhooks, GET /api/projects/:id/webhooks,
 *         DELETE /api/projects/:id/webhooks/:webhook_id,
 *         GET /api/projects/:id/events
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, ref, uuidParam } from '../helpers.ts';

export function webhooksNotificationsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Webhooks', description: 'Webhook outbox management and processing' },
      { name: 'Notifications', description: 'User notification management and preferences' },
      { name: 'ProjectWebhooks', description: 'Per-project webhook ingestion endpoints' },
    ],
    schemas: {
      WebhookOutboxEntry: {
        type: 'object',
        required: ['id', 'kind', 'payload', 'status', 'created_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the webhook outbox entry',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          kind: {
            type: 'string',
            description: 'Type of webhook event (e.g. work_item.created, reminder.fired)',
            example: 'work_item.created',
          },
          payload: {
            type: 'object',
            description: 'Webhook event payload containing event-specific data',
            properties: {
              event_type: {
                type: 'string',
                description: 'The type of event that triggered this webhook',
                example: 'work_item.created',
              },
              resource_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the resource that triggered the event',
                example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
              },
              resource_type: {
                type: 'string',
                description: 'Type of resource (e.g. work_item, reminder)',
                example: 'work_item',
              },
              timestamp: {
                type: 'string',
                format: 'date-time',
                description: 'When the event occurred',
                example: '2026-02-21T14:30:00Z',
              },
              data: {
                type: 'object',
                description: 'Event-specific data payload',
                additionalProperties: true,
              },
            },
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'HTTP headers for the webhook request (sensitive values are redacted in responses)',
            example: { 'Content-Type': 'application/json', 'Authorization': '[REDACTED]' },
          },
          status: {
            type: 'string',
            enum: ['pending', 'failed', 'dispatched'],
            description: 'Current dispatch status of the webhook',
            example: 'pending',
          },
          dispatched_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the webhook was successfully dispatched, or null if not yet dispatched',
            example: '2026-02-21T14:31:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the outbox entry was created',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      WebhookOutboxResponse: {
        type: 'object',
        required: ['entries', 'total', 'limit', 'offset'],
        properties: {
          entries: {
            type: 'array',
            items: { $ref: '#/components/schemas/WebhookOutboxEntry' },
            description: 'List of webhook outbox entries',
          },
          total: {
            type: 'integer',
            description: 'Total number of entries matching the query',
            example: 42,
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of entries returned',
            example: 50,
          },
          offset: {
            type: 'integer',
            description: 'Number of entries skipped',
            example: 0,
          },
        },
      },
      WebhookStatusResponse: {
        type: 'object',
        required: ['configured', 'has_token', 'timeout_seconds', 'stats'],
        properties: {
          configured: {
            type: 'boolean',
            description: 'Whether the webhook system is configured with a gateway URL',
            example: true,
          },
          gateway_url: {
            type: 'string',
            nullable: true,
            description: 'URL of the OpenClaw gateway that receives webhooks',
            example: 'https://hooks.example.com/webhook/abc123',
          },
          has_token: {
            type: 'boolean',
            description: 'Whether a bearer token is configured for webhook authentication',
            example: true,
          },
          default_model: {
            type: 'string',
            nullable: true,
            description: 'Default AI model used for webhook processing',
            example: 'gpt-4',
          },
          timeout_seconds: {
            type: 'integer',
            description: 'Timeout in seconds for webhook HTTP requests',
            example: 30,
          },
          stats: {
            type: 'object',
            description: 'Aggregate counts of outbox entries by status',
            properties: {
              pending: {
                type: 'integer',
                description: 'Number of webhooks waiting to be dispatched',
                example: 5,
              },
              failed: {
                type: 'integer',
                description: 'Number of webhooks that failed to dispatch',
                example: 2,
              },
              dispatched: {
                type: 'integer',
                description: 'Number of webhooks successfully dispatched',
                example: 150,
              },
            },
          },
        },
      },
      WebhookProcessResult: {
        type: 'object',
        required: ['status', 'processed', 'succeeded', 'failed', 'skipped'],
        properties: {
          status: {
            type: 'string',
            description: 'Overall processing status',
            example: 'completed',
          },
          processed: {
            type: 'integer',
            description: 'Total number of webhooks attempted',
            example: 10,
          },
          succeeded: {
            type: 'integer',
            description: 'Number of webhooks successfully dispatched',
            example: 8,
          },
          failed: {
            type: 'integer',
            description: 'Number of webhooks that failed during dispatch',
            example: 1,
          },
          skipped: {
            type: 'integer',
            description: 'Number of webhooks skipped (e.g. already dispatched)',
            example: 1,
          },
        },
      },
      Notification: {
        type: 'object',
        required: ['id', 'notification_type', 'title', 'message', 'created_at', 'namespace'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the notification',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          notification_type: {
            type: 'string',
            description: 'Type of notification (e.g. task_due, mention, assignment)',
            example: 'task_due',
          },
          title: {
            type: 'string',
            description: 'Short title for the notification',
            example: 'Task deadline approaching',
          },
          message: {
            type: 'string',
            description: 'Full notification message body',
            example: 'Your task "Submit building permit" is due in 2 hours.',
          },
          work_item_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'UUID of the related work item, if applicable',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          actor_email: {
            type: 'string',
            nullable: true,
            description: 'Email of the user or agent that triggered the notification',
            example: 'bob@example.com',
          },
          metadata: {
            type: 'object',
            nullable: true,
            description: 'Additional context data for the notification',
            properties: {
              work_item_title: {
                type: 'string',
                description: 'Title of the related work item',
                example: 'Submit building permit',
              },
              due_date: {
                type: 'string',
                format: 'date-time',
                description: 'Due date of the related work item',
                example: '2026-02-21T17:00:00Z',
              },
              priority: {
                type: 'string',
                description: 'Priority level of the related work item',
                example: 'high',
              },
            },
            additionalProperties: true,
          },
          read_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the notification was read, or null if unread',
            example: '2026-02-21T15:00:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the notification was created',
            example: '2026-02-21T14:30:00Z',
          },
          namespace: {
            type: 'string',
            description: 'Namespace the notification belongs to',
            example: 'default',
          },
        },
      },
      NotificationPreferences: {
        type: 'object',
        description: 'Map of notification type names to per-type preference settings',
        additionalProperties: {
          type: 'object',
          properties: {
            in_app: {
              type: 'boolean',
              description: 'Whether to show in-app notifications for this type',
              example: true,
            },
            email: {
              type: 'boolean',
              description: 'Whether to send email notifications for this type',
              example: false,
            },
          },
        },
        example: {
          task_due: { in_app: true, email: true },
          mention: { in_app: true, email: false },
          assignment: { in_app: true, email: true },
        },
      },
      ProjectWebhook: {
        type: 'object',
        required: ['id', 'project_id', 'label', 'token', 'is_active', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the project webhook',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          project_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the project this webhook belongs to',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          user_email: {
            type: 'string',
            nullable: true,
            description: 'Email address associated with this webhook, if set',
            example: 'alice@example.com',
          },
          label: {
            type: 'string',
            description: 'Human-readable label for identifying this webhook',
            example: 'GitHub Push Events',
          },
          token: {
            type: 'string',
            description: 'Bearer token for authenticating incoming webhook requests',
            example: 'whk_a1b2c3d4e5f6g7h8i9j0',
          },
          is_active: {
            type: 'boolean',
            description: 'Whether this webhook endpoint is currently active',
            example: true,
          },
          last_received: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp of the most recent webhook payload received',
            example: '2026-02-21T14:30:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the webhook was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the webhook was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      ProjectEvent: {
        type: 'object',
        required: ['id', 'project_id', 'event_type', 'raw_payload', 'created_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the project event',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          project_id: {
            type: 'string',
            format: 'uuid',
            description: 'UUID of the project this event belongs to',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          webhook_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'UUID of the webhook that received this event, or null for system events',
            example: 'b2c3d4e5-6789-01ab-cdef-2345678901bc',
          },
          user_email: {
            type: 'string',
            nullable: true,
            description: 'Email of the user associated with this event',
            example: 'alice@example.com',
          },
          event_type: {
            type: 'string',
            description: 'Type of the event (e.g. push, pull_request, deployment)',
            example: 'push',
          },
          summary: {
            type: 'string',
            nullable: true,
            description: 'Human-readable summary of the event',
            example: 'Pushed 3 commits to main branch',
          },
          raw_payload: {
            type: 'object',
            description: 'Full raw payload from the external webhook source',
            properties: {
              action: {
                type: 'string',
                description: 'Action that occurred in the external system',
                example: 'push',
              },
              repository: {
                type: 'string',
                description: 'Repository or source the event originated from',
                example: 'troykelly/openclaw-projects',
              },
              sender: {
                type: 'string',
                description: 'User or system that triggered the event',
                example: 'troykelly',
              },
              ref: {
                type: 'string',
                description: 'Git reference (branch or tag) for the event',
                example: 'refs/heads/main',
              },
            },
            additionalProperties: true,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the event was recorded',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
    },
    paths: {
      '/api/webhooks/outbox': {
        get: {
          operationId: 'listWebhookOutbox',
          summary: 'List webhook outbox entries',
          description: 'Returns paginated webhook outbox entries, optionally filtered by status or kind. Headers are redacted to prevent credential leakage.',
          tags: ['Webhooks'],
          parameters: [
            {
              name: 'status',
              in: 'query',
              description: 'Filter entries by dispatch status',
              schema: { type: 'string', enum: ['pending', 'failed', 'dispatched'] },
              example: 'pending',
            },
            {
              name: 'kind',
              in: 'query',
              description: 'Filter entries by webhook event kind',
              schema: { type: 'string' },
              example: 'work_item.created',
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of entries to return (max 100)',
              schema: { type: 'integer', default: 50, maximum: 100 },
              example: 50,
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of entries to skip for pagination',
              schema: { type: 'integer', default: 0 },
              example: 0,
            },
          ],
          responses: {
            '200': jsonResponse('Webhook outbox entries', ref('WebhookOutboxResponse')),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/webhooks/{id}/retry': {
        post: {
          operationId: 'retryWebhook',
          summary: 'Retry a failed webhook',
          description: 'Re-queues a failed or pending webhook for dispatch.',
          tags: ['Webhooks'],
          parameters: [uuidParam('id', 'Webhook outbox entry ID')],
          responses: {
            '200': jsonResponse('Webhook queued for retry', {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  description: 'Indicates the webhook has been re-queued',
                  example: 'queued',
                },
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'UUID of the re-queued webhook outbox entry',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/webhooks/status': {
        get: {
          operationId: 'getWebhookStatus',
          summary: 'Get webhook configuration status',
          description: 'Returns the current webhook system configuration and aggregate stats for pending, failed, and dispatched entries.',
          tags: ['Webhooks'],
          responses: {
            '200': jsonResponse('Webhook configuration status', ref('WebhookStatusResponse')),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/webhooks/process': {
        post: {
          operationId: 'processWebhooks',
          summary: 'Manually trigger webhook processing',
          description: 'Processes pending webhooks up to the specified limit. Returns stats on processed, succeeded, failed, and skipped entries.',
          tags: ['Webhooks'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              limit: {
                type: 'integer',
                description: 'Maximum number of webhooks to process in this batch (max 1000)',
                default: 100,
                example: 100,
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Processing results', ref('WebhookProcessResult')),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/webhooks/{webhook_id}': {
        post: {
          operationId: 'ingestProjectWebhook',
          summary: 'Public webhook ingestion endpoint',
          description: 'Receives external webhook payloads authenticated by bearer token. Creates a project event from the payload.',
          tags: ['ProjectWebhooks'],
          parameters: [uuidParam('webhook_id', 'Project webhook ID')],
          requestBody: jsonBody({
            type: 'object',
            description: 'Webhook payload from the external source. Any JSON object is accepted.',
            properties: {
              summary: {
                type: 'string',
                description: 'Optional human-readable summary of the event',
                example: 'Pushed 3 commits to main branch',
              },
              action: {
                type: 'string',
                description: 'Optional action type describing what happened',
                example: 'push',
              },
            },
            additionalProperties: true,
          }),
          responses: {
            '201': jsonResponse('Event created', ref('ProjectEvent')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
      '/api/notifications': {
        get: {
          operationId: 'listNotifications',
          summary: 'List notifications',
          description: 'Returns paginated notifications for a user, optionally filtered to unread only. Supports namespace scoping.',
          tags: ['Notifications'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              description: 'Email address of the user to fetch notifications for',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
            {
              name: 'unread_only',
              in: 'query',
              description: 'When true, return only unread notifications',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'true',
            },
            {
              name: 'namespaces',
              in: 'query',
              description: 'Comma-separated list of namespaces to filter notifications by',
              schema: { type: 'string' },
              example: 'default,project-alpha',
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of notifications to return',
              schema: { type: 'integer', default: 50, maximum: 100 },
              example: 50,
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of notifications to skip for pagination',
              schema: { type: 'integer', default: 0 },
              example: 0,
            },
          ],
          responses: {
            '200': jsonResponse('Notifications list', {
              type: 'object',
              properties: {
                notifications: {
                  type: 'array',
                  items: ref('Notification'),
                  description: 'List of notifications matching the query',
                },
                unread_count: {
                  type: 'integer',
                  description: 'Total count of unread notifications for the user',
                  example: 7,
                },
              },
            }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
      '/api/notifications/unread-count': {
        get: {
          operationId: 'getUnreadNotificationCount',
          summary: 'Get unread notification count',
          description: 'Returns the count of unread, non-dismissed notifications for a user.',
          tags: ['Notifications'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              required: true,
              description: 'Email address of the user to count unread notifications for',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
            {
              name: 'namespaces',
              in: 'query',
              description: 'Comma-separated list of namespaces to filter by',
              schema: { type: 'string' },
              example: 'default,project-alpha',
            },
          ],
          responses: {
            '200': jsonResponse('Unread count', {
              type: 'object',
              properties: {
                unread_count: {
                  type: 'integer',
                  description: 'Number of unread, non-dismissed notifications',
                  example: 7,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/notifications/{id}/read': {
        post: {
          operationId: 'markNotificationRead',
          summary: 'Mark a notification as read',
          description: 'Sets the read_at timestamp on a notification. Idempotent if already read.',
          tags: ['Notifications'],
          parameters: [
            uuidParam('id', 'Notification ID'),
            {
              name: 'user_email',
              in: 'query',
              required: true,
              description: 'Email address of the user who owns the notification',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
          ],
          responses: {
            '200': jsonResponse('Marked as read', {
              type: 'object',
              properties: {
                success: {
                  type: 'boolean',
                  description: 'Whether the operation was successful',
                  example: true,
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/notifications/read-all': {
        post: {
          operationId: 'markAllNotificationsRead',
          summary: 'Mark all notifications as read',
          description: 'Marks all unread, non-dismissed notifications as read for the specified user.',
          tags: ['Notifications'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              required: true,
              description: 'Email address of the user to mark all notifications as read for',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
          ],
          responses: {
            '200': jsonResponse('Marked count', {
              type: 'object',
              properties: {
                marked_count: {
                  type: 'integer',
                  description: 'Number of notifications that were marked as read',
                  example: 7,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/notifications/{id}': {
        delete: {
          operationId: 'dismissNotification',
          summary: 'Dismiss a notification',
          description: 'Soft-deletes a notification by setting dismissed_at. The notification will no longer appear in listings.',
          tags: ['Notifications'],
          parameters: [
            uuidParam('id', 'Notification ID'),
            {
              name: 'user_email',
              in: 'query',
              required: true,
              description: 'Email address of the user who owns the notification',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
          ],
          responses: {
            '200': jsonResponse('Dismissed', {
              type: 'object',
              properties: {
                success: {
                  type: 'boolean',
                  description: 'Whether the dismissal was successful',
                  example: true,
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/notifications/preferences': {
        get: {
          operationId: 'getNotificationPreferences',
          summary: 'Get notification preferences',
          description: 'Returns per-type notification preferences for the user, with defaults applied for types not yet configured.',
          tags: ['Notifications'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              required: true,
              description: 'Email address of the user to fetch preferences for',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
          ],
          responses: {
            '200': jsonResponse('Notification preferences', {
              type: 'object',
              properties: {
                preferences: {
                  ...ref('NotificationPreferences'),
                  description: 'Map of notification type to preference settings',
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
        patch: {
          operationId: 'updateNotificationPreferences',
          summary: 'Update notification preferences',
          description: 'Updates per-type notification preferences. Each key is a notification type with in_app and email toggles.',
          tags: ['Notifications'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              required: true,
              description: 'Email address of the user to update preferences for',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
          ],
          requestBody: jsonBody({
            type: 'object',
            description: 'Map of notification type to preference settings. Each key is a notification type name.',
            additionalProperties: {
              type: 'object',
              properties: {
                in_app: {
                  type: 'boolean',
                  description: 'Whether to show in-app notifications for this type',
                  example: true,
                },
                email: {
                  type: 'boolean',
                  description: 'Whether to send email notifications for this type',
                  example: false,
                },
              },
            },
            example: {
              task_due: { in_app: true, email: true },
              mention: { in_app: true, email: false },
            },
          }),
          responses: {
            '200': jsonResponse('Updated', {
              type: 'object',
              properties: {
                success: {
                  type: 'boolean',
                  description: 'Whether the preferences were updated successfully',
                  example: true,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/projects/{id}/webhooks': {
        post: {
          operationId: 'createProjectWebhook',
          summary: 'Create a project webhook',
          description: 'Creates a new webhook endpoint for a project with a generated bearer token.',
          tags: ['ProjectWebhooks'],
          parameters: [uuidParam('id', 'Project ID')],
          requestBody: jsonBody({
            type: 'object',
            required: ['label'],
            properties: {
              label: {
                type: 'string',
                description: 'Human-readable label for identifying this webhook',
                example: 'GitHub Push Events',
              },
              user_email: {
                type: 'string',
                description: 'Optional email to associate with the webhook for audit purposes',
                example: 'alice@example.com',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Webhook created', ref('ProjectWebhook')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        get: {
          operationId: 'listProjectWebhooks',
          summary: 'List project webhooks',
          description: 'Returns all webhooks configured for a project.',
          tags: ['ProjectWebhooks'],
          parameters: [uuidParam('id', 'Project ID')],
          responses: {
            '200': jsonResponse('Webhook list', {
              type: 'array',
              items: ref('ProjectWebhook'),
              description: 'List of webhooks configured for the project',
            }),
            ...errorResponses(401, 403, 404, 500),
          },
        },
      },
      '/api/projects/{id}/webhooks/{webhook_id}': {
        delete: {
          operationId: 'deleteProjectWebhook',
          summary: 'Delete a project webhook',
          description: 'Permanently removes a webhook endpoint from a project.',
          tags: ['ProjectWebhooks'],
          parameters: [
            uuidParam('id', 'Project ID'),
            uuidParam('webhook_id', 'Webhook ID'),
          ],
          responses: {
            '204': { description: 'Webhook deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/projects/{id}/events': {
        get: {
          operationId: 'listProjectEvents',
          summary: 'List project events',
          description: 'Returns paginated event log for a project, including webhook-triggered events.',
          tags: ['ProjectWebhooks'],
          parameters: [
            uuidParam('id', 'Project ID'),
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of events to return (max 200)',
              schema: { type: 'integer', default: 50, maximum: 200 },
              example: 50,
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of events to skip for pagination',
              schema: { type: 'integer', default: 0 },
              example: 0,
            },
          ],
          responses: {
            '200': jsonResponse('Project events', {
              type: 'object',
              properties: {
                events: {
                  type: 'array',
                  items: ref('ProjectEvent'),
                  description: 'List of project events ordered by creation time',
                },
              },
            }),
            ...errorResponses(401, 403, 404, 500),
          },
        },
      },
    },
  };
}
