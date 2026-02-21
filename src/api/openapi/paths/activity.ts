/**
 * OpenAPI path definitions for activity feed and global search endpoints.
 * Routes: GET /api/activity, POST /api/activity/read-all,
 *         GET /api/activity/stream, POST /api/activity/:id/read,
 *         GET /api/search
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonResponse, uuidParam } from '../helpers.ts';

export function activityPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Activity', description: 'Activity feed with real-time streaming and read tracking' },
      { name: 'Search', description: 'Unified full-text and semantic search across all entity types' },
    ],
    schemas: {
      ActivityItem: {
        type: 'object',
        required: ['id', 'type', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the activity item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          type: { type: 'string', description: 'Activity type indicating what action occurred (e.g. created, updated, deleted, commented)', example: 'created' },
          work_item_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the related work item, if applicable', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          work_item_title: { type: 'string', nullable: true, description: 'Title of the related work item for display purposes', example: 'Implement user authentication' },
          entity_type: { type: 'string', nullable: true, description: 'Type of entity this activity relates to (e.g. task, issue, epic, skill_store)', example: 'task' },
          actor_email: { type: 'string', nullable: true, description: 'Email address of the user or agent that performed the action', example: 'alice@example.com' },
          description: { type: 'string', nullable: true, description: 'Human-readable description of the activity', example: 'Created task "Implement user authentication"' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the activity occurred', example: '2026-02-21T14:30:00Z' },
          read_at: { type: 'string', format: 'date-time', nullable: true, description: 'Timestamp when the activity was marked as read, null if unread', example: '2026-02-21T15:00:00Z' },
        },
      },
      SearchResult: {
        type: 'object',
        required: ['query', 'search_type', 'results', 'total'],
        properties: {
          query: { type: 'string', description: 'The original search query string', example: 'authentication flow' },
          search_type: { type: 'string', enum: ['text', 'semantic', 'hybrid'], description: 'The type of search that was performed', example: 'hybrid' },
          results: {
            type: 'array',
            description: 'List of search result items ranked by relevance',
            items: {
              type: 'object',
              required: ['id', 'type', 'title', 'score'],
              properties: {
                id: { type: 'string', description: 'Unique identifier of the matched entity', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                type: { type: 'string', description: 'Entity type of the result (work_item, contact, memory, message)', example: 'work_item' },
                title: { type: 'string', description: 'Title or display name of the matched entity', example: 'Implement OAuth2 authentication' },
                snippet: { type: 'string', nullable: true, description: 'Text snippet showing the matching content with context', example: '...implementing the OAuth2 authentication flow for third-party...' },
                score: { type: 'number', description: 'Relevance score combining text and semantic similarity (0-1)', example: 0.87 },
                created_at: { type: 'string', format: 'date-time', description: 'Creation timestamp of the matched entity', example: '2026-02-21T14:30:00Z' },
              },
            },
          },
          facets: {
            type: 'object',
            description: 'Count of results grouped by entity type for filtering',
            properties: {
              work_item: { type: 'integer', description: 'Number of work item results', example: 12 },
              contact: { type: 'integer', description: 'Number of contact results', example: 3 },
              memory: { type: 'integer', description: 'Number of memory results', example: 7 },
              message: { type: 'integer', description: 'Number of message results', example: 5 },
            },
          },
          total: { type: 'integer', description: 'Total number of results across all entity types', example: 27 },
        },
      },
    },
    paths: {
      '/api/activity': {
        get: {
          operationId: 'listActivity',
          summary: 'List activity feed',
          description: 'Returns the activity feed with optional filtering by action type, entity type, project, and date. Supports both page-based and offset-based pagination. Includes skill store activity when entity_type is not filtered.',
          tags: ['Activity'],
          parameters: [
            { name: 'limit', in: 'query', description: 'Maximum number of results to return (max 100)', schema: { type: 'integer', default: 50, maximum: 100 }, example: 25 },
            { name: 'offset', in: 'query', description: 'Number of results to skip for offset-based pagination', schema: { type: 'integer', default: 0 }, example: 0 },
            { name: 'page', in: 'query', description: 'Page number for page-based pagination (alternative to offset)', schema: { type: 'integer' }, example: 1 },
            { name: 'action_type', in: 'query', description: 'Filter by activity action type (e.g. created, updated, deleted)', schema: { type: 'string' }, example: 'created' },
            { name: 'entity_type', in: 'query', description: 'Filter by entity type (work_item_kind value or "skill_store")', schema: { type: 'string' }, example: 'task' },
            { name: 'project_id', in: 'query', description: 'Filter to activities within a project and its descendants', schema: { type: 'string', format: 'uuid' }, example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            { name: 'since', in: 'query', description: 'Only return activity occurring after this timestamp', schema: { type: 'string', format: 'date-time' }, example: '2026-02-20T00:00:00Z' },
          ],
          responses: {
            '200': jsonResponse('Activity feed', {
              type: 'object',
              required: ['items'],
              properties: {
                items: { type: 'array', items: { $ref: '#/components/schemas/ActivityItem' }, description: 'List of activity items' },
                pagination: {
                  type: 'object',
                  nullable: true,
                  description: 'Pagination metadata, present when the page parameter is used',
                  properties: {
                    page: { type: 'integer', description: 'Current page number', example: 1 },
                    limit: { type: 'integer', description: 'Number of items per page', example: 50 },
                    total: { type: 'integer', description: 'Total number of activity items matching the filters', example: 150 },
                    has_more: { type: 'boolean', description: 'Whether there are more pages available', example: true },
                  },
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/activity/read-all': {
        post: {
          operationId: 'markAllActivityRead',
          summary: 'Mark all activity as read',
          description: 'Sets read_at timestamp on all unread activity items.',
          tags: ['Activity'],
          responses: {
            '200': jsonResponse('Read result', {
              type: 'object',
              required: ['marked'],
              properties: {
                marked: { type: 'integer', description: 'Number of activity items marked as read', example: 15 },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/activity/stream': {
        get: {
          operationId: 'streamActivity',
          summary: 'Real-time activity stream (SSE)',
          description: 'Server-Sent Events stream of recent activity. Sends a heartbeat event followed by the 20 most recent activity items. Optionally filter by project.',
          tags: ['Activity'],
          parameters: [
            { name: 'project_id', in: 'query', description: 'Filter stream to a project and its descendants', schema: { type: 'string', format: 'uuid' }, example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          ],
          responses: {
            '200': {
              description: 'SSE event stream',
              content: {
                'text/event-stream': {
                  schema: {
                    type: 'string',
                    description: 'Server-Sent Events: "heartbeat" with timestamp, then "activity" events with ActivityItem JSON',
                    example: 'event: heartbeat\ndata: {"time":"2026-02-21T14:30:00Z"}\n\nevent: activity\ndata: {"id":"...","type":"created",...}\n\n',
                  },
                },
              },
            },
          },
        },
      },
      '/api/activity/{id}/read': {
        post: {
          operationId: 'markActivityRead',
          summary: 'Mark a single activity as read',
          description: 'Sets the read_at timestamp on a specific activity item. Idempotent: preserves the original read_at if already set.',
          tags: ['Activity'],
          parameters: [uuidParam('id', 'Activity item UUID')],
          responses: {
            '204': { description: 'Activity marked as read' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/api/search': {
        get: {
          operationId: 'globalSearch',
          summary: 'Unified search',
          description: 'Full-text search across work items, contacts, memories, and messages. Supports optional semantic search via pgvector embeddings. Rate-limited to 30 requests per minute.',
          tags: ['Search'],
          parameters: [
            { name: 'q', in: 'query', required: true, description: 'Search query string', schema: { type: 'string' }, example: 'authentication flow' },
            { name: 'types', in: 'query', description: 'Comma-separated entity types to search (work_item, contact, memory, message)', schema: { type: 'string' }, example: 'work_item,memory' },
            { name: 'limit', in: 'query', description: 'Maximum number of results to return (max 100)', schema: { type: 'integer', default: 20, maximum: 100 }, example: 20 },
            { name: 'offset', in: 'query', description: 'Number of results to skip', schema: { type: 'integer', default: 0 }, example: 0 },
            { name: 'semantic', in: 'query', description: 'Enable semantic search using pgvector embeddings (default true)', schema: { type: 'string', enum: ['true', 'false'], default: 'true' }, example: 'true' },
            { name: 'semantic_weight', in: 'query', description: 'Weight for semantic vs text results (0 = text only, 1 = semantic only, default 0.5)', schema: { type: 'number', minimum: 0, maximum: 1, default: 0.5 }, example: 0.5 },
            { name: 'date_from', in: 'query', description: 'Filter results created after this date', schema: { type: 'string', format: 'date-time' }, example: '2026-01-01T00:00:00Z' },
            { name: 'date_to', in: 'query', description: 'Filter results created before this date', schema: { type: 'string', format: 'date-time' }, example: '2026-02-21T23:59:59Z' },
          ],
          responses: {
            '200': jsonResponse('Search results', { $ref: '#/components/schemas/SearchResult' }),
            ...errorResponses(401, 429, 500),
          },
        },
      },
    },
  };
}
