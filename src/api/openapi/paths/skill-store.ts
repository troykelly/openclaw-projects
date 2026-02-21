/**
 * OpenAPI path definitions for the Skill Store domain.
 *
 * Covers skill store items CRUD (create/upsert, get, list, update, delete),
 * bulk operations, by-key lookup, archiving, collections, aggregate queries,
 * schedules (CRUD + trigger/pause/resume), and admin endpoints (embeddings,
 * stats, skills list/detail/quota, purge).
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  ref,
  uuidParam,
  paginationParams,
  errorResponses,
  jsonBody,
  jsonResponse,
  namespaceParam,
} from '../helpers.ts';

export function skillStorePaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Skill Store Items', description: 'Skill store item CRUD, bulk operations, and by-key lookup' },
      { name: 'Skill Store Collections', description: 'Collection listing, aggregation, and deletion' },
      { name: 'Skill Store Schedules', description: 'Cron-based schedule management with webhook delivery' },
      { name: 'Admin - Skill Store', description: 'Admin endpoints for skill store stats, skills, quotas, and embeddings' },
    ],

    schemas: {
      SkillStoreItem: {
        type: 'object',
        required: ['id', 'skill_id', 'collection', 'status', 'pinned', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the skill store item',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          skill_id: {
            type: 'string',
            description: 'Identifier of the skill that owns this item',
            example: 'weather-forecast',
          },
          collection: {
            type: 'string',
            description: 'Collection name for grouping items within a skill',
            example: 'daily-reports',
          },
          key: {
            type: 'string',
            nullable: true,
            description: 'Optional unique key within skill_id+collection for upsert lookups',
            example: 'sydney-2026-02-21',
          },
          title: {
            type: 'string',
            nullable: true,
            description: 'Human-readable title of the item',
            example: 'Sydney Weather Report - Feb 21',
          },
          summary: {
            type: 'string',
            nullable: true,
            description: 'Brief summary of the item content',
            example: 'Sunny, 28C, low humidity. UV index high.',
          },
          content: {
            type: 'string',
            nullable: true,
            description: 'Full text content of the item',
            example: 'Detailed weather report for Sydney on February 21, 2026. Temperature: 28C...',
          },
          data: {
            type: 'object',
            description: 'Arbitrary structured JSON data attached to the item (max 1MB)',
            properties: {
              temperature: {
                type: 'number',
                description: 'Example domain-specific data field',
                example: 28,
              },
              humidity: {
                type: 'number',
                description: 'Example domain-specific data field',
                example: 45,
              },
              conditions: {
                type: 'string',
                description: 'Example domain-specific data field',
                example: 'sunny',
              },
            },
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization and filtering',
            example: ['weather', 'sydney', 'daily'],
          },
          priority: {
            type: 'integer',
            nullable: true,
            description: 'Priority level for ordering (higher = more important)',
            example: 5,
          },
          status: {
            type: 'string',
            enum: ['active', 'archived', 'processing'],
            description: 'Current status of the item',
            example: 'active',
          },
          media_url: {
            type: 'string',
            nullable: true,
            description: 'URL to associated media (image, document, etc.)',
            example: 'https://cdn.example.com/weather/sydney-2026-02-21.png',
          },
          media_type: {
            type: 'string',
            nullable: true,
            description: 'MIME type of the associated media',
            example: 'image/png',
          },
          source_url: {
            type: 'string',
            nullable: true,
            description: 'Original source URL where the data was obtained',
            example: 'https://api.weather.gov/sydney/forecast',
          },
          expires_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'When the item expires and should be considered stale',
            example: '2026-02-22T00:00:00Z',
          },
          pinned: {
            type: 'boolean',
            description: 'Whether the item is pinned for priority display',
            example: false,
          },
          namespace: {
            type: 'string',
            nullable: true,
            description: 'Namespace scope for multi-tenant isolation',
            example: 'home',
          },
          embedding_status: {
            type: 'string',
            nullable: true,
            description: 'Status of the embedding generation (complete, pending, failed)',
            example: 'complete',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the item was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the item was last updated',
            example: '2026-02-21T15:00:00Z',
          },
          deleted_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the item was soft-deleted, null if active',
            example: null,
          },
        },
      },

      SkillStoreItemCreateInput: {
        type: 'object',
        required: ['skill_id'],
        properties: {
          skill_id: {
            type: 'string',
            description: 'Identifier of the skill owning this item',
            example: 'weather-forecast',
          },
          collection: {
            type: 'string',
            default: '_default',
            description: 'Collection name for grouping items (defaults to _default)',
            example: 'daily-reports',
          },
          key: {
            type: 'string',
            description: 'Optional unique key within skill_id+collection. If provided and matching item exists, performs upsert.',
            example: 'sydney-2026-02-21',
          },
          title: {
            type: 'string',
            description: 'Human-readable title',
            example: 'Sydney Weather Report - Feb 21',
          },
          summary: {
            type: 'string',
            description: 'Brief summary of the content',
            example: 'Sunny, 28C, low humidity.',
          },
          content: {
            type: 'string',
            description: 'Full text content',
            example: 'Detailed weather report for Sydney...',
          },
          data: {
            type: 'object',
            description: 'Arbitrary structured JSON data (max 1MB)',
            properties: {
              temperature: {
                type: 'number',
                description: 'Example domain-specific data field',
                example: 28,
              },
              conditions: {
                type: 'string',
                description: 'Example domain-specific data field',
                example: 'sunny',
              },
            },
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization',
            example: ['weather', 'sydney'],
          },
          priority: {
            type: 'integer',
            description: 'Priority level (higher = more important)',
            example: 5,
          },
          media_url: {
            type: 'string',
            description: 'URL to associated media',
            example: 'https://cdn.example.com/weather/sydney.png',
          },
          media_type: {
            type: 'string',
            description: 'MIME type of associated media',
            example: 'image/png',
          },
          source_url: {
            type: 'string',
            description: 'Original source URL',
            example: 'https://api.weather.gov/sydney/forecast',
          },
          expires_at: {
            type: 'string',
            format: 'date-time',
            description: 'Expiration timestamp',
            example: '2026-02-22T00:00:00Z',
          },
          pinned: {
            type: 'boolean',
            default: false,
            description: 'Pin the item for priority display',
            example: false,
          },
        },
      },

      SkillStoreItemUpdateInput: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            nullable: true,
            description: 'Updated title (set to null to clear)',
            example: 'Updated Sydney Report',
          },
          summary: {
            type: 'string',
            nullable: true,
            description: 'Updated summary (set to null to clear)',
            example: 'Updated forecast: partly cloudy, 25C.',
          },
          content: {
            type: 'string',
            nullable: true,
            description: 'Updated full content (set to null to clear)',
            example: 'Revised weather report...',
          },
          data: {
            type: 'object',
            description: 'Updated structured data (replaces existing data)',
            properties: {
              temperature: {
                type: 'number',
                description: 'Example updated data field',
                example: 25,
              },
              conditions: {
                type: 'string',
                description: 'Example updated data field',
                example: 'partly-cloudy',
              },
            },
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated tags (replaces existing tags)',
            example: ['weather', 'sydney', 'updated'],
          },
          priority: {
            type: 'integer',
            nullable: true,
            description: 'Updated priority (set to null to clear)',
            example: 3,
          },
          media_url: {
            type: 'string',
            nullable: true,
            description: 'Updated media URL',
            example: 'https://cdn.example.com/weather/sydney-updated.png',
          },
          media_type: {
            type: 'string',
            nullable: true,
            description: 'Updated media MIME type',
            example: 'image/png',
          },
          source_url: {
            type: 'string',
            nullable: true,
            description: 'Updated source URL',
            example: 'https://api.weather.gov/sydney/forecast/v2',
          },
          status: {
            type: 'string',
            enum: ['active', 'archived', 'processing'],
            description: 'Updated item status',
            example: 'active',
          },
          expires_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Updated expiration (set to null to remove expiration)',
            example: '2026-02-23T00:00:00Z',
          },
          pinned: {
            type: 'boolean',
            description: 'Updated pinned status',
            example: true,
          },
        },
      },

      SkillStoreBulkDeleteInput: {
        type: 'object',
        required: ['skill_id'],
        description: 'At least one filter (collection, tags, or status) is required in addition to skill_id',
        properties: {
          skill_id: {
            type: 'string',
            description: 'Skill identifier to scope the deletion',
            example: 'weather-forecast',
          },
          collection: {
            type: 'string',
            description: 'Delete items in this collection only',
            example: 'daily-reports',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Delete items matching all of these tags',
            example: ['outdated', 'stale'],
          },
          status: {
            type: 'string',
            enum: ['active', 'archived', 'processing'],
            description: 'Delete items with this status only',
            example: 'archived',
          },
        },
      },

      SkillStoreCollection: {
        type: 'object',
        required: ['collection', 'count'],
        properties: {
          collection: {
            type: 'string',
            description: 'Collection name',
            example: 'daily-reports',
          },
          count: {
            type: 'integer',
            description: 'Number of items in the collection',
            example: 42,
          },
          latest_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp of the most recently updated item in the collection',
            example: '2026-02-21T15:00:00Z',
          },
        },
      },

      SkillStoreSchedule: {
        type: 'object',
        required: ['id', 'skill_id', 'cron_expression', 'webhook_url', 'enabled', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the schedule',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          skill_id: {
            type: 'string',
            description: 'Identifier of the skill this schedule belongs to',
            example: 'weather-forecast',
          },
          collection: {
            type: 'string',
            nullable: true,
            description: 'Optional collection scope for the schedule',
            example: 'daily-reports',
          },
          cron_expression: {
            type: 'string',
            description: 'Standard 5-field cron expression (minimum 5-minute interval)',
            example: '0 */6 * * *',
          },
          timezone: {
            type: 'string',
            description: 'IANA timezone for the cron schedule (defaults to UTC)',
            example: 'Australia/Sydney',
          },
          webhook_url: {
            type: 'string',
            format: 'uri',
            description: 'URL to deliver webhook payloads to when the schedule fires',
            example: 'https://hooks.openclaw.ai/skills/weather-forecast/trigger',
          },
          webhook_headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'HTTP headers to include in webhook requests (redacted in responses)',
            example: { 'Authorization': 'Bearer ***', 'Content-Type': 'application/json' },
          },
          payload_template: {
            type: 'object',
            description: 'Template object for the webhook payload body',
            properties: {
              action: {
                type: 'string',
                description: 'Action identifier for the webhook handler',
                example: 'refresh',
              },
              skill_id: {
                type: 'string',
                description: 'Skill ID included in the payload',
                example: 'weather-forecast',
              },
              collection: {
                type: 'string',
                description: 'Collection scope included in the payload',
                example: 'daily-reports',
              },
            },
          },
          enabled: {
            type: 'boolean',
            description: 'Whether the schedule is currently active',
            example: true,
          },
          max_retries: {
            type: 'integer',
            description: 'Maximum number of retry attempts on webhook failure (0-20, default 5)',
            example: 5,
          },
          last_run_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp of the last execution',
            example: '2026-02-21T12:00:00Z',
          },
          next_run_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp of the next scheduled execution',
            example: '2026-02-21T18:00:00Z',
          },
          last_run_status: {
            type: 'string',
            nullable: true,
            description: 'Status of the last execution (success, failed, timeout)',
            example: 'success',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the schedule was created',
            example: '2026-02-20T10:00:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the schedule was last updated',
            example: '2026-02-21T12:00:00Z',
          },
        },
      },

      SkillStoreScheduleCreateInput: {
        type: 'object',
        required: ['skill_id', 'cron_expression', 'webhook_url'],
        properties: {
          skill_id: {
            type: 'string',
            description: 'Identifier of the skill to create the schedule for',
            example: 'weather-forecast',
          },
          collection: {
            type: 'string',
            nullable: true,
            description: 'Optional collection scope for the schedule',
            example: 'daily-reports',
          },
          cron_expression: {
            type: 'string',
            description: 'Standard 5-field cron expression (minimum 5-minute interval)',
            example: '0 */6 * * *',
          },
          timezone: {
            type: 'string',
            default: 'UTC',
            description: 'IANA timezone for the cron schedule',
            example: 'Australia/Sydney',
          },
          webhook_url: {
            type: 'string',
            format: 'uri',
            description: 'URL to deliver webhooks to (must use HTTPS in production)',
            example: 'https://hooks.openclaw.ai/skills/weather-forecast/trigger',
          },
          webhook_headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'HTTP headers to include in webhook requests',
            example: { 'Authorization': 'Bearer sk-abc123' },
          },
          payload_template: {
            type: 'object',
            description: 'Template for the webhook payload body',
            properties: {
              action: {
                type: 'string',
                description: 'Action identifier',
                example: 'refresh',
              },
              skill_id: {
                type: 'string',
                description: 'Skill ID to include',
                example: 'weather-forecast',
              },
            },
          },
          enabled: {
            type: 'boolean',
            default: true,
            description: 'Whether the schedule should be active immediately',
            example: true,
          },
          max_retries: {
            type: 'integer',
            description: 'Maximum retry attempts on failure (0-20, default 5)',
            example: 5,
          },
        },
      },

      SkillStoreScheduleUpdateInput: {
        type: 'object',
        properties: {
          cron_expression: {
            type: 'string',
            description: 'Updated cron expression',
            example: '0 */12 * * *',
          },
          timezone: {
            type: 'string',
            description: 'Updated IANA timezone',
            example: 'UTC',
          },
          webhook_url: {
            type: 'string',
            format: 'uri',
            description: 'Updated webhook URL',
            example: 'https://hooks.openclaw.ai/skills/weather-forecast/trigger-v2',
          },
          webhook_headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Updated webhook headers',
            example: { 'Authorization': 'Bearer sk-new-token' },
          },
          payload_template: {
            type: 'object',
            description: 'Updated payload template',
            properties: {
              action: {
                type: 'string',
                description: 'Updated action identifier',
                example: 'full-refresh',
              },
            },
          },
          enabled: {
            type: 'boolean',
            description: 'Updated enabled status',
            example: false,
          },
          max_retries: {
            type: 'integer',
            description: 'Updated max retry count',
            example: 3,
          },
        },
      },

      SkillStoreStats: {
        type: 'object',
        required: ['total_items', 'by_status', 'by_skill', 'storage_estimate'],
        properties: {
          total_items: {
            type: 'integer',
            description: 'Total number of items across all skills',
            example: 1500,
          },
          by_status: {
            type: 'object',
            description: 'Item count breakdown by status',
            required: ['active', 'archived', 'processing'],
            properties: {
              active: {
                type: 'integer',
                description: 'Number of active items',
                example: 1200,
              },
              archived: {
                type: 'integer',
                description: 'Number of archived items',
                example: 250,
              },
              processing: {
                type: 'integer',
                description: 'Number of items currently being processed',
                example: 50,
              },
            },
          },
          by_skill: {
            type: 'array',
            description: 'Item count breakdown by skill',
            items: {
              type: 'object',
              required: ['skill_id', 'count'],
              properties: {
                skill_id: {
                  type: 'string',
                  description: 'Skill identifier',
                  example: 'weather-forecast',
                },
                count: {
                  type: 'integer',
                  description: 'Number of items for this skill',
                  example: 365,
                },
              },
            },
          },
          storage_estimate: {
            type: 'object',
            description: 'Estimated storage usage',
            required: ['total_bytes'],
            properties: {
              total_bytes: {
                type: 'integer',
                description: 'Estimated total storage in bytes',
                example: 52428800,
              },
            },
          },
        },
      },

      SkillStoreSkillDetail: {
        type: 'object',
        required: ['skill_id', 'total_items', 'by_status', 'collections', 'embedding_status', 'schedules'],
        properties: {
          skill_id: {
            type: 'string',
            description: 'Skill identifier',
            example: 'weather-forecast',
          },
          total_items: {
            type: 'integer',
            description: 'Total number of items for this skill',
            example: 365,
          },
          by_status: {
            type: 'object',
            description: 'Item count breakdown by status for this skill',
            required: ['active', 'archived', 'processing'],
            properties: {
              active: {
                type: 'integer',
                description: 'Number of active items',
                example: 300,
              },
              archived: {
                type: 'integer',
                description: 'Number of archived items',
                example: 60,
              },
              processing: {
                type: 'integer',
                description: 'Number of items being processed',
                example: 5,
              },
            },
          },
          collections: {
            type: 'array',
            description: 'Collections within this skill with item counts',
            items: {
              type: 'object',
              required: ['collection', 'count'],
              properties: {
                collection: {
                  type: 'string',
                  description: 'Collection name',
                  example: 'daily-reports',
                },
                count: {
                  type: 'integer',
                  description: 'Number of items in this collection',
                  example: 180,
                },
              },
            },
          },
          embedding_status: {
            type: 'object',
            description: 'Embedding generation status for this skill',
            required: ['complete', 'pending', 'failed'],
            properties: {
              complete: {
                type: 'integer',
                description: 'Number of items with completed embeddings',
                example: 340,
              },
              pending: {
                type: 'integer',
                description: 'Number of items awaiting embedding generation',
                example: 20,
              },
              failed: {
                type: 'integer',
                description: 'Number of items with failed embeddings',
                example: 5,
              },
            },
          },
          schedules: {
            type: 'array',
            items: ref('SkillStoreSchedule'),
            description: 'Cron schedules associated with this skill',
          },
        },
      },
    },

    paths: {
      // ── Skill Store Items ───────────────────────────────────────────────
      '/api/skill-store/items': {
        post: {
          operationId: 'createSkillStoreItem',
          summary: 'Create or upsert a skill store item',
          description: 'If a key is provided and an item with the same skill_id+collection+key exists, it will be updated (upsert). Otherwise a new item is created. Quota checks apply.',
          tags: ['Skill Store Items'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('SkillStoreItemCreateInput')),
          responses: {
            '200': jsonResponse('Item upserted (existing key matched)', ref('SkillStoreItem')),
            '201': jsonResponse('Item created', ref('SkillStoreItem')),
            ...errorResponses(400, 401, 403, 429, 500),
          },
        },
        get: {
          operationId: 'listSkillStoreItems',
          summary: 'List skill store items with filters',
          tags: ['Skill Store Items'],
          parameters: [
            namespaceParam(),
            {
              name: 'skill_id',
              in: 'query',
              required: true,
              description: 'Filter items by skill identifier',
              schema: { type: 'string' },
              example: 'weather-forecast',
            },
            {
              name: 'collection',
              in: 'query',
              description: 'Filter by collection name',
              schema: { type: 'string' },
              example: 'daily-reports',
            },
            {
              name: 'status',
              in: 'query',
              description: 'Filter by item status',
              schema: { type: 'string', enum: ['active', 'archived', 'processing'] },
              example: 'active',
            },
            {
              name: 'tags',
              in: 'query',
              description: 'Comma-separated tags to filter by (items must contain all specified tags)',
              schema: { type: 'string' },
              example: 'weather,sydney',
            },
            {
              name: 'since',
              in: 'query',
              description: 'Only return items created at or after this timestamp',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-01T00:00:00Z',
            },
            {
              name: 'until',
              in: 'query',
              description: 'Only return items created at or before this timestamp',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-21T23:59:59Z',
            },
            {
              name: 'order_by',
              in: 'query',
              description: 'Field to order results by',
              schema: { type: 'string', enum: ['created_at', 'updated_at', 'title', 'priority'], default: 'created_at' },
              example: 'created_at',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Skill store items', {
              type: 'object',
              required: ['items', 'total', 'has_more'],
              properties: {
                items: {
                  type: 'array',
                  items: ref('SkillStoreItem'),
                  description: 'Array of skill store items matching the query',
                },
                total: {
                  type: 'integer',
                  description: 'Total number of items matching the filters',
                  example: 42,
                },
                has_more: {
                  type: 'boolean',
                  description: 'Whether there are more items beyond the current page',
                  example: true,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/skill-store/items/by-key': {
        get: {
          operationId: 'getSkillStoreItemByKey',
          summary: 'Get a skill store item by composite key (skill_id + collection + key)',
          tags: ['Skill Store Items'],
          parameters: [
            {
              name: 'skill_id',
              in: 'query',
              required: true,
              description: 'Skill identifier',
              schema: { type: 'string' },
              example: 'weather-forecast',
            },
            {
              name: 'collection',
              in: 'query',
              description: 'Collection name (defaults to _default)',
              schema: { type: 'string', default: '_default' },
              example: 'daily-reports',
            },
            {
              name: 'key',
              in: 'query',
              required: true,
              description: 'Unique item key within the skill_id+collection scope',
              schema: { type: 'string' },
              example: 'sydney-2026-02-21',
            },
          ],
          responses: {
            '200': jsonResponse('Skill store item', ref('SkillStoreItem')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/skill-store/items/bulk': {
        post: {
          operationId: 'bulkCreateSkillStoreItems',
          summary: 'Bulk create or upsert skill store items (max 100)',
          tags: ['Skill Store Items'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                items: ref('SkillStoreItemCreateInput'),
                maxItems: 100,
                description: 'Array of items to create or upsert (maximum 100 items per request)',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Bulk operation result', {
              type: 'object',
              required: ['items', 'created'],
              properties: {
                items: {
                  type: 'array',
                  items: ref('SkillStoreItem'),
                  description: 'Array of created or upserted items',
                },
                created: {
                  type: 'integer',
                  description: 'Number of new items created (vs. upserted)',
                  example: 15,
                },
              },
            }),
            ...errorResponses(400, 401, 429, 500),
          },
        },
        delete: {
          operationId: 'bulkDeleteSkillStoreItems',
          summary: 'Bulk soft-delete skill store items by filter',
          description: 'Requires skill_id and at least one additional filter (collection, tags, or status).',
          tags: ['Skill Store Items'],
          requestBody: jsonBody(ref('SkillStoreBulkDeleteInput')),
          responses: {
            '200': jsonResponse('Bulk delete result', {
              type: 'object',
              required: ['deleted'],
              properties: {
                deleted: {
                  type: 'integer',
                  description: 'Number of items soft-deleted',
                  example: 25,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/skill-store/items/{id}': {
        parameters: [uuidParam('id', 'Skill store item UUID')],
        get: {
          operationId: 'getSkillStoreItem',
          summary: 'Get a skill store item by UUID',
          tags: ['Skill Store Items'],
          parameters: [
            {
              name: 'include_deleted',
              in: 'query',
              description: 'When true, include soft-deleted items in the lookup',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
          ],
          responses: {
            '200': jsonResponse('Skill store item', ref('SkillStoreItem')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateSkillStoreItem',
          summary: 'Partially update a skill store item',
          tags: ['Skill Store Items'],
          requestBody: jsonBody(ref('SkillStoreItemUpdateInput')),
          responses: {
            '200': jsonResponse('Updated item', ref('SkillStoreItem')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteSkillStoreItem',
          summary: 'Soft or hard delete a skill store item',
          tags: ['Skill Store Items'],
          parameters: [
            {
              name: 'permanent',
              in: 'query',
              description: 'When true, permanently deletes instead of soft delete',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
          ],
          responses: {
            '204': { description: 'Item deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/skill-store/items/{id}/archive': {
        parameters: [uuidParam('id', 'Skill store item UUID')],
        post: {
          operationId: 'archiveSkillStoreItem',
          summary: 'Archive a skill store item (set status to archived)',
          tags: ['Skill Store Items'],
          responses: {
            '200': jsonResponse('Archived item', ref('SkillStoreItem')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // ── Skill Store Collections ─────────────────────────────────────────
      '/api/skill-store/collections': {
        get: {
          operationId: 'listSkillStoreCollections',
          summary: 'List collections with item counts for a skill',
          tags: ['Skill Store Collections'],
          parameters: [
            {
              name: 'skill_id',
              in: 'query',
              required: true,
              description: 'Skill identifier to list collections for',
              schema: { type: 'string' },
              example: 'weather-forecast',
            },
          ],
          responses: {
            '200': jsonResponse('Collections list', {
              type: 'object',
              required: ['collections'],
              properties: {
                collections: {
                  type: 'array',
                  items: ref('SkillStoreCollection'),
                  description: 'Array of collections with item counts',
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/skill-store/collections/{name}': {
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            description: 'Collection name to operate on',
            schema: { type: 'string' },
            example: 'daily-reports',
          },
        ],
        delete: {
          operationId: 'deleteSkillStoreCollection',
          summary: 'Soft-delete all items in a collection',
          tags: ['Skill Store Collections'],
          parameters: [
            {
              name: 'skill_id',
              in: 'query',
              required: true,
              description: 'Skill identifier that owns the collection',
              schema: { type: 'string' },
              example: 'weather-forecast',
            },
          ],
          responses: {
            '200': jsonResponse('Deletion result', {
              type: 'object',
              required: ['deleted'],
              properties: {
                deleted: {
                  type: 'integer',
                  description: 'Number of items soft-deleted from the collection',
                  example: 30,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/skill-store/aggregate': {
        get: {
          operationId: 'aggregateSkillStoreItems',
          summary: 'Run aggregate queries on skill store items',
          tags: ['Skill Store Collections'],
          parameters: [
            {
              name: 'skill_id',
              in: 'query',
              required: true,
              description: 'Skill identifier to aggregate items for',
              schema: { type: 'string' },
              example: 'weather-forecast',
            },
            {
              name: 'operation',
              in: 'query',
              required: true,
              description: 'Aggregation operation to perform',
              schema: { type: 'string', enum: ['count', 'count_by_tag', 'count_by_status', 'latest', 'oldest'] },
              example: 'count',
            },
            {
              name: 'collection',
              in: 'query',
              description: 'Restrict aggregation to a specific collection',
              schema: { type: 'string' },
              example: 'daily-reports',
            },
            {
              name: 'since',
              in: 'query',
              description: 'Start of the time range for aggregation',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-01T00:00:00Z',
            },
            {
              name: 'until',
              in: 'query',
              description: 'End of the time range for aggregation',
              schema: { type: 'string', format: 'date-time' },
              example: '2026-02-21T23:59:59Z',
            },
          ],
          responses: {
            '200': jsonResponse('Aggregation result', {
              type: 'object',
              required: ['result'],
              properties: {
                result: {
                  type: 'object',
                  description: 'Aggregation result. Structure depends on the operation.',
                  properties: {
                    count: {
                      type: 'integer',
                      description: 'Total count (for count operation)',
                      example: 42,
                    },
                    by_tag: {
                      type: 'object',
                      additionalProperties: { type: 'integer' },
                      description: 'Count per tag (for count_by_tag operation)',
                      example: { 'weather': 42, 'sydney': 30 },
                    },
                    by_status: {
                      type: 'object',
                      additionalProperties: { type: 'integer' },
                      description: 'Count per status (for count_by_status operation)',
                      example: { 'active': 35, 'archived': 7 },
                    },
                    item: ref('SkillStoreItem'),
                  },
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      // ── Skill Store Schedules ───────────────────────────────────────────
      '/api/skill-store/schedules': {
        post: {
          operationId: 'createSkillStoreSchedule',
          summary: 'Create a cron-based schedule with webhook delivery',
          tags: ['Skill Store Schedules'],
          requestBody: jsonBody(ref('SkillStoreScheduleCreateInput')),
          responses: {
            '201': jsonResponse('Schedule created', ref('SkillStoreSchedule')),
            ...errorResponses(400, 401, 409, 429, 500),
          },
        },
        get: {
          operationId: 'listSkillStoreSchedules',
          summary: 'List schedules for a skill',
          tags: ['Skill Store Schedules'],
          parameters: [
            {
              name: 'skill_id',
              in: 'query',
              required: true,
              description: 'Skill identifier to list schedules for',
              schema: { type: 'string' },
              example: 'weather-forecast',
            },
            {
              name: 'enabled',
              in: 'query',
              description: 'Filter by enabled state',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'true',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Schedules list', {
              type: 'object',
              required: ['schedules', 'total'],
              properties: {
                schedules: {
                  type: 'array',
                  items: ref('SkillStoreSchedule'),
                  description: 'Array of schedules for the skill',
                },
                total: {
                  type: 'integer',
                  description: 'Total number of schedules',
                  example: 3,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/skill-store/schedules/{id}': {
        parameters: [uuidParam('id', 'Schedule UUID')],
        patch: {
          operationId: 'updateSkillStoreSchedule',
          summary: 'Update a schedule',
          tags: ['Skill Store Schedules'],
          requestBody: jsonBody(ref('SkillStoreScheduleUpdateInput')),
          responses: {
            '200': jsonResponse('Updated schedule', ref('SkillStoreSchedule')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteSkillStoreSchedule',
          summary: 'Permanently delete a schedule',
          tags: ['Skill Store Schedules'],
          responses: {
            '204': { description: 'Schedule deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/skill-store/schedules/{id}/trigger': {
        parameters: [uuidParam('id', 'Schedule UUID')],
        post: {
          operationId: 'triggerSkillStoreSchedule',
          summary: 'Manually trigger a schedule (enqueues a job for immediate processing)',
          tags: ['Skill Store Schedules'],
          responses: {
            '202': jsonResponse('Job enqueued', {
              type: 'object',
              required: ['job_id', 'message'],
              properties: {
                job_id: {
                  type: 'string',
                  description: 'Unique identifier for the enqueued job',
                  example: 'job-abc123-def456',
                },
                message: {
                  type: 'string',
                  description: 'Human-readable confirmation message',
                  example: 'Schedule triggered. Job enqueued for immediate processing.',
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/skill-store/schedules/{id}/pause': {
        parameters: [uuidParam('id', 'Schedule UUID')],
        post: {
          operationId: 'pauseSkillStoreSchedule',
          summary: 'Pause a schedule (set enabled to false)',
          tags: ['Skill Store Schedules'],
          responses: {
            '200': jsonResponse('Paused schedule', ref('SkillStoreSchedule')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/skill-store/schedules/{id}/resume': {
        parameters: [uuidParam('id', 'Schedule UUID')],
        post: {
          operationId: 'resumeSkillStoreSchedule',
          summary: 'Resume a paused schedule (set enabled to true, recompute next_run_at)',
          tags: ['Skill Store Schedules'],
          responses: {
            '200': jsonResponse('Resumed schedule', ref('SkillStoreSchedule')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // ── Search ──────────────────────────────────────────────────────────
      '/api/skill-store/search': {
        post: {
          operationId: 'searchSkillStoreItems',
          summary: 'Full-text search across skill store items',
          tags: ['Skill Store Items'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['query'],
            properties: {
              query: { type: 'string', description: 'Full-text search query', example: 'weather forecast Sydney' },
              skill_id: { type: 'string', description: 'Restrict search to a specific skill', example: 'weather-forecast' },
              collection: { type: 'string', description: 'Restrict search to a specific collection', example: 'daily-reports' },
              limit: { type: 'integer', default: 20, minimum: 1, maximum: 100, description: 'Maximum results', example: 20 },
              offset: { type: 'integer', default: 0, minimum: 0, description: 'Pagination offset', example: 0 },
            },
          }),
          responses: {
            '200': jsonResponse('Search results', {
              type: 'object',
              required: ['items', 'total'],
              properties: {
                items: { type: 'array', items: ref('SkillStoreItem'), description: 'Items matching the search query' },
                total: { type: 'integer', description: 'Total number of matching items', example: 15 },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/skill-store/search/semantic': {
        post: {
          operationId: 'semanticSearchSkillStoreItems',
          summary: 'Semantic (vector) search across skill store items with full-text fallback',
          tags: ['Skill Store Items'],
          parameters: [namespaceParam()],
          requestBody: jsonBody({
            type: 'object',
            required: ['query'],
            properties: {
              query: { type: 'string', description: 'Natural language query for semantic search', example: 'What was the temperature in Sydney last week?' },
              skill_id: { type: 'string', description: 'Restrict search to a specific skill', example: 'weather-forecast' },
              collection: { type: 'string', description: 'Restrict search to a specific collection', example: 'daily-reports' },
              limit: { type: 'integer', default: 10, minimum: 1, maximum: 50, description: 'Maximum results', example: 10 },
              threshold: { type: 'number', default: 0.5, minimum: 0, maximum: 1, description: 'Minimum similarity threshold', example: 0.5 },
            },
          }),
          responses: {
            '200': jsonResponse('Semantic search results', {
              type: 'object',
              required: ['items', 'search_type'],
              properties: {
                items: {
                  type: 'array',
                  description: 'Items matching the semantic query, ordered by relevance',
                  items: {
                    allOf: [
                      ref('SkillStoreItem'),
                      {
                        type: 'object',
                        properties: {
                          similarity: { type: 'number', description: 'Cosine similarity score (0-1)', example: 0.87 },
                        },
                      },
                    ],
                  },
                },
                search_type: { type: 'string', enum: ['semantic', 'fulltext'], description: 'Which search method was used (falls back to fulltext if embeddings unavailable)', example: 'semantic' },
                total: { type: 'integer', description: 'Total number of matching items', example: 8 },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      // ── Admin — Skill Store Embeddings ──────────────────────────────────
      '/api/admin/skill-store/embeddings/status': {
        get: {
          operationId: 'getSkillStoreEmbeddingsStatus',
          summary: 'Get skill store embedding statistics',
          tags: ['Admin - Skill Store'],
          responses: {
            '200': jsonResponse('Embedding statistics', {
              type: 'object',
              required: ['total_items', 'embedded', 'pending', 'failed'],
              properties: {
                total_items: {
                  type: 'integer',
                  description: 'Total number of skill store items',
                  example: 1500,
                },
                embedded: {
                  type: 'integer',
                  description: 'Items with completed embeddings',
                  example: 1400,
                },
                pending: {
                  type: 'integer',
                  description: 'Items awaiting embedding generation',
                  example: 80,
                },
                failed: {
                  type: 'integer',
                  description: 'Items where embedding generation failed',
                  example: 20,
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },

      '/api/admin/skill-store/embeddings/backfill': {
        post: {
          operationId: 'backfillSkillStoreEmbeddings',
          summary: 'Backfill skill store item embeddings',
          tags: ['Admin - Skill Store'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              batch_size: {
                type: 'integer',
                description: 'Number of items per batch (1-1000, default 100)',
                example: 100,
              },
            },
          }),
          responses: {
            '202': jsonResponse('Backfill result', {
              type: 'object',
              required: ['status', 'enqueued', 'skipped'],
              properties: {
                status: {
                  type: 'string',
                  description: 'Status of the backfill operation',
                  example: 'started',
                },
                enqueued: {
                  type: 'integer',
                  description: 'Number of items enqueued for embedding generation',
                  example: 80,
                },
                skipped: {
                  type: 'integer',
                  description: 'Number of items skipped (already have embeddings)',
                  example: 1420,
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },

      // ── Admin — Skill Store Stats & Skills ──────────────────────────────
      '/api/admin/skill-store/stats': {
        get: {
          operationId: 'getSkillStoreStats',
          summary: 'Get global skill store statistics',
          tags: ['Admin - Skill Store'],
          responses: {
            '200': jsonResponse('Global stats', ref('SkillStoreStats')),
            ...errorResponses(401, 500),
          },
        },
      },

      '/api/admin/skill-store/skills': {
        get: {
          operationId: 'listSkillStoreSkills',
          summary: 'List all skill_ids with item and collection counts',
          tags: ['Admin - Skill Store'],
          responses: {
            '200': jsonResponse('Skills list', {
              type: 'object',
              required: ['skills'],
              properties: {
                skills: {
                  type: 'array',
                  description: 'Array of skills with their item and collection counts',
                  items: {
                    type: 'object',
                    required: ['skill_id', 'item_count', 'collection_count', 'last_activity'],
                    properties: {
                      skill_id: {
                        type: 'string',
                        description: 'Skill identifier',
                        example: 'weather-forecast',
                      },
                      item_count: {
                        type: 'integer',
                        description: 'Total number of items for this skill',
                        example: 365,
                      },
                      collection_count: {
                        type: 'integer',
                        description: 'Number of collections for this skill',
                        example: 3,
                      },
                      last_activity: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Timestamp of the most recent item activity',
                        example: '2026-02-21T15:00:00Z',
                      },
                    },
                  },
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },

      '/api/admin/skill-store/skills/{skill_id}': {
        parameters: [
          {
            name: 'skill_id',
            in: 'path',
            required: true,
            description: 'Skill identifier to get details for',
            schema: { type: 'string' },
            example: 'weather-forecast',
          },
        ],
        get: {
          operationId: 'getSkillStoreSkillDetail',
          summary: 'Get detailed view of a skill including collections, embedding status, and schedules',
          tags: ['Admin - Skill Store'],
          responses: {
            '200': jsonResponse('Skill detail', ref('SkillStoreSkillDetail')),
            ...errorResponses(401, 404, 500),
          },
        },
        delete: {
          operationId: 'purgeSkillStoreSkill',
          summary: 'Hard purge all data for a skill (items + schedules)',
          description: 'Requires X-Confirm-Delete: true header.',
          tags: ['Admin - Skill Store'],
          parameters: [
            {
              name: 'X-Confirm-Delete',
              in: 'header',
              required: true,
              description: 'Must be set to "true" to confirm the hard purge operation',
              schema: { type: 'string', enum: ['true'] },
              example: 'true',
            },
          ],
          responses: {
            '200': jsonResponse('Purge result', {
              type: 'object',
              required: ['skill_id', 'deleted_count', 'deleted_schedules'],
              properties: {
                skill_id: {
                  type: 'string',
                  description: 'Skill identifier that was purged',
                  example: 'weather-forecast',
                },
                deleted_count: {
                  type: 'integer',
                  description: 'Number of items permanently deleted',
                  example: 365,
                },
                deleted_schedules: {
                  type: 'integer',
                  description: 'Number of schedules permanently deleted',
                  example: 2,
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/admin/skill-store/skills/{skill_id}/quota': {
        parameters: [
          {
            name: 'skill_id',
            in: 'path',
            required: true,
            description: 'Skill identifier to check quota for',
            schema: { type: 'string' },
            example: 'weather-forecast',
          },
        ],
        get: {
          operationId: 'getSkillStoreSkillQuota',
          summary: 'Get quota usage versus limits for a skill',
          tags: ['Admin - Skill Store'],
          responses: {
            '200': jsonResponse('Quota usage', {
              type: 'object',
              required: ['skill_id', 'items_used', 'items_limit', 'storage_used_bytes', 'storage_limit_bytes', 'schedules_used', 'schedules_limit'],
              properties: {
                skill_id: {
                  type: 'string',
                  description: 'Skill identifier',
                  example: 'weather-forecast',
                },
                items_used: {
                  type: 'integer',
                  description: 'Number of items currently stored',
                  example: 365,
                },
                items_limit: {
                  type: 'integer',
                  description: 'Maximum number of items allowed',
                  example: 10000,
                },
                storage_used_bytes: {
                  type: 'integer',
                  description: 'Current storage usage in bytes',
                  example: 2097152,
                },
                storage_limit_bytes: {
                  type: 'integer',
                  description: 'Maximum storage allowed in bytes',
                  example: 104857600,
                },
                schedules_used: {
                  type: 'integer',
                  description: 'Number of active schedules',
                  example: 2,
                },
                schedules_limit: {
                  type: 'integer',
                  description: 'Maximum number of schedules allowed',
                  example: 10,
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
    },
  };
}
