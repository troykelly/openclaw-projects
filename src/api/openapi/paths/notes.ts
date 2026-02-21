/**
 * OpenAPI path definitions for the Notes domain.
 *
 * Covers note CRUD, version history, sharing (user + link),
 * collaborative presence, full-text and semantic search,
 * similar notes, and admin embedding endpoints.
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

/** Reusable user_email query parameter required on most note routes. */
function userEmailQuery(required = true) {
  return {
    name: 'user_email',
    in: 'query' as const,
    required,
    description: 'Email of the authenticated user',
    schema: { type: 'string' as const },
    example: 'user@example.com',
  };
}

export function notesPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Notes', description: 'Rich-text notes with versioning, sharing, and search' },
      { name: 'Admin - Note Embeddings', description: 'Note embedding backfill and status' },
    ],

    schemas: {
      Note: {
        type: 'object',
        required: ['id', 'title', 'user_email', 'visibility', 'hide_from_agents', 'is_pinned', 'sort_order', 'version_number', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the note',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          title: {
            type: 'string',
            description: 'Title of the note',
            example: 'Meeting Notes - Sprint Planning',
          },
          content: {
            type: 'string',
            nullable: true,
            description: 'Rich-text content of the note in Markdown format',
            example: '# Sprint Planning\n\nDiscussed feature priorities for Q2...',
          },
          notebook_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'ID of the notebook this note belongs to, if any',
            example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
          },
          user_email: {
            type: 'string',
            description: 'Email of the note owner',
            example: 'user@example.com',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization and filtering',
            example: ['sprint', 'planning', 'q2'],
          },
          visibility: {
            type: 'string',
            enum: ['private', 'shared', 'public'],
            description: 'Visibility level controlling who can see the note',
            example: 'private',
          },
          hide_from_agents: {
            type: 'boolean',
            description: 'When true, AI agents will not see this note in search results',
            example: false,
          },
          summary: {
            type: 'string',
            nullable: true,
            description: 'AI-generated or manual summary of the note content',
            example: 'Sprint planning notes covering Q2 feature priorities and team assignments.',
          },
          is_pinned: {
            type: 'boolean',
            description: 'Whether the note is pinned to the top of lists',
            example: false,
          },
          sort_order: {
            type: 'integer',
            description: 'Manual sort order for display (lower values first)',
            example: 0,
          },
          version_number: {
            type: 'integer',
            description: 'Current version number of the note, incremented on each edit',
            example: 3,
          },
          namespace: {
            type: 'string',
            nullable: true,
            description: 'Namespace scope for multi-tenant isolation',
            example: 'home',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the note was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the note was last updated',
            example: '2026-02-21T15:00:00Z',
          },
          deleted_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the note was soft-deleted, null if active',
            example: null,
          },
        },
      },

      NoteCreateInput: {
        type: 'object',
        required: ['user_email', 'title'],
        properties: {
          user_email: {
            type: 'string',
            description: 'Email of the user creating the note',
            example: 'user@example.com',
          },
          title: {
            type: 'string',
            description: 'Title of the new note',
            example: 'Meeting Notes - Sprint Planning',
          },
          content: {
            type: 'string',
            description: 'Rich-text content in Markdown format',
            example: '# Sprint Planning\n\nDiscussed feature priorities...',
          },
          notebook_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the notebook to place this note in',
            example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization',
            example: ['sprint', 'planning'],
          },
          visibility: {
            type: 'string',
            enum: ['private', 'shared', 'public'],
            description: 'Visibility level for the note',
            example: 'private',
          },
          hide_from_agents: {
            type: 'boolean',
            description: 'When true, hide this note from AI agent search results',
            example: false,
          },
          summary: {
            type: 'string',
            description: 'Manual summary of the note',
            example: 'Key decisions from sprint planning session.',
          },
          is_pinned: {
            type: 'boolean',
            description: 'Pin the note to the top of lists',
            example: false,
          },
        },
      },

      NoteUpdateInput: {
        type: 'object',
        required: ['user_email'],
        properties: {
          user_email: {
            type: 'string',
            description: 'Email of the user performing the update',
            example: 'user@example.com',
          },
          title: {
            type: 'string',
            description: 'Updated title',
            example: 'Sprint Planning Notes - Q2 2026',
          },
          content: {
            type: 'string',
            description: 'Updated content in Markdown format',
            example: '# Sprint Planning Q2 2026\n\nRevised priorities...',
          },
          notebook_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Updated notebook ID (set to null to remove from notebook)',
            example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated tags (replaces existing tags)',
            example: ['sprint', 'q2-2026', 'updated'],
          },
          visibility: {
            type: 'string',
            enum: ['private', 'shared', 'public'],
            description: 'Updated visibility level',
            example: 'shared',
          },
          hide_from_agents: {
            type: 'boolean',
            description: 'Updated agent visibility setting',
            example: false,
          },
          summary: {
            type: 'string',
            nullable: true,
            description: 'Updated summary (set to null to clear)',
            example: 'Revised sprint planning notes with updated priorities.',
          },
          is_pinned: {
            type: 'boolean',
            description: 'Updated pinned status',
            example: true,
          },
          sort_order: {
            type: 'number',
            description: 'Updated sort order for display',
            example: 1,
          },
        },
      },

      NoteVersion: {
        type: 'object',
        required: ['version_number', 'title', 'created_at', 'changed_by'],
        properties: {
          version_number: {
            type: 'integer',
            description: 'Sequential version number',
            example: 2,
          },
          title: {
            type: 'string',
            description: 'Title of the note at this version',
            example: 'Meeting Notes - Sprint Planning',
          },
          content: {
            type: 'string',
            nullable: true,
            description: 'Content of the note at this version',
            example: '# Sprint Planning\n\nOriginal discussion points...',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when this version was created',
            example: '2026-02-21T14:30:00Z',
          },
          changed_by: {
            type: 'string',
            description: 'Email of the user who created this version',
            example: 'user@example.com',
          },
        },
      },

      NoteShare: {
        type: 'object',
        required: ['id', 'note_id', 'share_type', 'permission', 'created_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the share record',
            example: 'b1c2d3e4-5f6a-7b8c-9d0e-f1a2b3c4d5e6',
          },
          note_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the shared note',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          share_type: {
            type: 'string',
            enum: ['user', 'link'],
            description: 'Type of share — direct user share or shareable link',
            example: 'user',
          },
          email: {
            type: 'string',
            nullable: true,
            description: 'Email of the user the note is shared with (for user shares)',
            example: 'colleague@example.com',
          },
          permission: {
            type: 'string',
            enum: ['read', 'read_write'],
            description: 'Permission level granted to the share recipient',
            example: 'read',
          },
          token: {
            type: 'string',
            nullable: true,
            description: 'Share link token (for link shares)',
            example: 'abc123def456ghi789',
          },
          expires_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'When the share expires, null for no expiration',
            example: '2026-03-21T14:30:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the share was created',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },

      NotePresenceCollaborator: {
        type: 'object',
        required: ['user_email', 'last_seen'],
        properties: {
          user_email: {
            type: 'string',
            description: 'Email of the collaborator currently viewing the note',
            example: 'colleague@example.com',
          },
          cursor_position: {
            type: 'object',
            nullable: true,
            description: 'Current cursor position of the collaborator in the note',
            properties: {
              line: {
                type: 'integer',
                description: 'Line number of the cursor (0-based)',
                example: 12,
              },
              column: {
                type: 'integer',
                description: 'Column number of the cursor (0-based)',
                example: 34,
              },
            },
          },
          last_seen: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp of the last heartbeat from this collaborator',
            example: '2026-02-21T14:35:00Z',
          },
        },
      },

      CursorPosition: {
        type: 'object',
        required: ['line', 'column'],
        properties: {
          line: {
            type: 'integer',
            minimum: 0,
            description: 'Line number in the note content (0-based)',
            example: 12,
          },
          column: {
            type: 'integer',
            minimum: 0,
            description: 'Column number in the line (0-based)',
            example: 34,
          },
        },
      },
    },

    paths: {
      // ── Notes CRUD ───────────────────────────────────────────────────
      '/api/notes': {
        get: {
          operationId: 'listNotes',
          summary: 'List notes with filters and pagination',
          tags: ['Notes'],
          parameters: [
            userEmailQuery(),
            namespaceParam(),
            {
              name: 'notebook_id',
              in: 'query',
              description: 'Filter notes by notebook ID',
              schema: { type: 'string', format: 'uuid' },
              example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
            },
            {
              name: 'tags',
              in: 'query',
              description: 'Comma-separated tag filter (notes must contain all specified tags)',
              schema: { type: 'string' },
              example: 'sprint,planning',
            },
            {
              name: 'visibility',
              in: 'query',
              description: 'Filter by visibility level',
              schema: { type: 'string', enum: ['private', 'shared', 'public'] },
              example: 'private',
            },
            {
              name: 'search',
              in: 'query',
              description: 'Full-text search query applied to title and content',
              schema: { type: 'string' },
              example: 'sprint planning',
            },
            {
              name: 'is_pinned',
              in: 'query',
              description: 'Filter by pinned state',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'true',
            },
            {
              name: 'sort_by',
              in: 'query',
              description: 'Field to sort results by',
              schema: { type: 'string', enum: ['created_at', 'updated_at', 'title'] },
              example: 'updated_at',
            },
            {
              name: 'sort_order',
              in: 'query',
              description: 'Sort direction',
              schema: { type: 'string', enum: ['asc', 'desc'] },
              example: 'desc',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Paginated note list', {
              type: 'object',
              required: ['notes', 'total'],
              properties: {
                notes: {
                  type: 'array',
                  items: ref('Note'),
                  description: 'Array of notes matching the query',
                },
                total: {
                  type: 'integer',
                  description: 'Total number of notes matching the filters',
                  example: 42,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
        post: {
          operationId: 'createNote',
          summary: 'Create a new note',
          tags: ['Notes'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('NoteCreateInput')),
          responses: {
            '201': jsonResponse('Note created', ref('Note')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/notes/{id}': {
        parameters: [uuidParam('id', 'Note UUID')],
        get: {
          operationId: 'getNote',
          summary: 'Get a single note by ID',
          tags: ['Notes'],
          parameters: [
            userEmailQuery(),
            {
              name: 'include_versions',
              in: 'query',
              description: 'Include version history in the response',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
            {
              name: 'include_references',
              in: 'query',
              description: 'Include note references and backlinks',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
          ],
          responses: {
            '200': jsonResponse('Note details', ref('Note')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        put: {
          operationId: 'updateNote',
          summary: 'Update a note',
          tags: ['Notes'],
          requestBody: jsonBody(ref('NoteUpdateInput')),
          responses: {
            '200': jsonResponse('Updated note', ref('Note')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteNote',
          summary: 'Soft delete a note',
          tags: ['Notes'],
          parameters: [userEmailQuery()],
          responses: {
            '204': { description: 'Note deleted' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notes/{id}/restore': {
        parameters: [uuidParam('id', 'Note UUID')],
        post: {
          operationId: 'restoreNote',
          summary: 'Restore a soft-deleted note',
          tags: ['Notes'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email of the user performing the restore',
                example: 'user@example.com',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Restored note', ref('Note')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      // ── Version History ──────────────────────────────────────────────
      '/api/notes/{id}/versions': {
        parameters: [uuidParam('id', 'Note UUID')],
        get: {
          operationId: 'listNoteVersions',
          summary: 'List version history for a note',
          tags: ['Notes'],
          parameters: [
            userEmailQuery(),
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Version list', {
              type: 'object',
              required: ['versions', 'total'],
              properties: {
                versions: {
                  type: 'array',
                  items: ref('NoteVersion'),
                  description: 'Array of note versions, newest first',
                },
                total: {
                  type: 'integer',
                  description: 'Total number of versions for this note',
                  example: 5,
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/notes/{id}/versions/compare': {
        parameters: [uuidParam('id', 'Note UUID')],
        get: {
          operationId: 'compareNoteVersions',
          summary: 'Compare two versions of a note',
          tags: ['Notes'],
          parameters: [
            userEmailQuery(),
            {
              name: 'from',
              in: 'query',
              required: true,
              description: 'Source version number to compare from',
              schema: { type: 'integer' },
              example: 1,
            },
            {
              name: 'to',
              in: 'query',
              required: true,
              description: 'Target version number to compare to',
              schema: { type: 'integer' },
              example: 3,
            },
          ],
          responses: {
            '200': jsonResponse('Version comparison', {
              type: 'object',
              required: ['from_version', 'to_version', 'title_changed', 'content_diff'],
              properties: {
                from_version: {
                  type: 'integer',
                  description: 'Source version number',
                  example: 1,
                },
                to_version: {
                  type: 'integer',
                  description: 'Target version number',
                  example: 3,
                },
                title_changed: {
                  type: 'boolean',
                  description: 'Whether the title changed between versions',
                  example: true,
                },
                content_diff: {
                  type: 'string',
                  nullable: true,
                  description: 'Unified diff of content changes between versions',
                  example: '@@ -1,3 +1,4 @@\n # Sprint Planning\n+## Updated Section\n ...',
                },
                from_title: {
                  type: 'string',
                  description: 'Title at the source version',
                  example: 'Meeting Notes',
                },
                to_title: {
                  type: 'string',
                  description: 'Title at the target version',
                  example: 'Sprint Planning Notes - Q2',
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/notes/{id}/versions/{version_number}': {
        parameters: [
          uuidParam('id', 'Note UUID'),
          {
            name: 'version_number',
            in: 'path',
            required: true,
            description: 'Version number to retrieve',
            schema: { type: 'integer' },
            example: 2,
          },
        ],
        get: {
          operationId: 'getNoteVersion',
          summary: 'Get a specific version of a note',
          tags: ['Notes'],
          parameters: [userEmailQuery()],
          responses: {
            '200': jsonResponse('Version details', ref('NoteVersion')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/notes/{id}/versions/{version_number}/restore': {
        parameters: [
          uuidParam('id', 'Note UUID'),
          {
            name: 'version_number',
            in: 'path',
            required: true,
            description: 'Version number to restore the note to',
            schema: { type: 'integer' },
            example: 2,
          },
        ],
        post: {
          operationId: 'restoreNoteVersion',
          summary: 'Restore a note to a specific version',
          tags: ['Notes'],
          parameters: [userEmailQuery()],
          responses: {
            '200': jsonResponse('Restored note', ref('Note')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      // ── Note Sharing ─────────────────────────────────────────────────
      '/api/notes/{id}/share': {
        parameters: [uuidParam('id', 'Note UUID')],
        post: {
          operationId: 'shareNoteWithUser',
          summary: 'Share a note with a user by email',
          tags: ['Notes'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email', 'email'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email of the authenticated user (note owner)',
                example: 'user@example.com',
              },
              email: {
                type: 'string',
                description: 'Email of the user to share the note with',
                example: 'colleague@example.com',
              },
              permission: {
                type: 'string',
                enum: ['read', 'read_write'],
                default: 'read',
                description: 'Permission level to grant',
                example: 'read',
              },
              expires_at: {
                type: 'string',
                format: 'date-time',
                description: 'Optional expiration time for the share',
                example: '2026-03-21T14:30:00Z',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Share created', ref('NoteShare')),
            ...errorResponses(400, 401, 403, 404, 409, 500),
          },
        },
      },

      '/api/notes/{id}/share/link': {
        parameters: [uuidParam('id', 'Note UUID')],
        post: {
          operationId: 'createNoteShareLink',
          summary: 'Create a shareable link for a note',
          tags: ['Notes'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email of the authenticated user (note owner)',
                example: 'user@example.com',
              },
              permission: {
                type: 'string',
                enum: ['read', 'read_write'],
                default: 'read',
                description: 'Permission level for anyone with the link',
                example: 'read',
              },
              is_single_view: {
                type: 'boolean',
                description: 'When true, the link expires after one view',
                example: false,
              },
              max_views: {
                type: 'integer',
                description: 'Maximum number of times the link can be accessed',
                example: 10,
              },
              expires_at: {
                type: 'string',
                format: 'date-time',
                description: 'Expiration time for the share link',
                example: '2026-03-21T14:30:00Z',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Share link created', ref('NoteShare')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notes/{id}/shares': {
        parameters: [uuidParam('id', 'Note UUID')],
        get: {
          operationId: 'listNoteShares',
          summary: 'List all shares for a note',
          tags: ['Notes'],
          parameters: [userEmailQuery()],
          responses: {
            '200': jsonResponse('Shares list', {
              type: 'object',
              required: ['shares'],
              properties: {
                shares: {
                  type: 'array',
                  items: ref('NoteShare'),
                  description: 'Array of active shares for this note',
                },
              },
            }),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notes/{id}/shares/{share_id}': {
        parameters: [
          uuidParam('id', 'Note UUID'),
          uuidParam('share_id', 'Share UUID'),
        ],
        put: {
          operationId: 'updateNoteShare',
          summary: 'Update a note share',
          tags: ['Notes'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email of the authenticated user (note owner)',
                example: 'user@example.com',
              },
              permission: {
                type: 'string',
                enum: ['read', 'read_write'],
                description: 'Updated permission level',
                example: 'read_write',
              },
              expires_at: {
                type: 'string',
                format: 'date-time',
                nullable: true,
                description: 'Updated expiration time (set to null to remove expiration)',
                example: '2026-04-21T14:30:00Z',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Updated share', ref('NoteShare')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'revokeNoteShare',
          summary: 'Revoke a note share',
          tags: ['Notes'],
          parameters: [userEmailQuery()],
          responses: {
            '204': { description: 'Share revoked' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notes/shared-with-me': {
        get: {
          operationId: 'listNotesSharedWithMe',
          summary: 'List notes shared with the current user',
          tags: ['Notes'],
          parameters: [userEmailQuery()],
          responses: {
            '200': jsonResponse('Shared notes', {
              type: 'object',
              required: ['notes'],
              properties: {
                notes: {
                  type: 'array',
                  items: ref('Note'),
                  description: 'Array of notes shared with the current user',
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/shared/notes/{token}': {
        parameters: [
          {
            name: 'token',
            in: 'path',
            required: true,
            description: 'Share link token from the generated share URL',
            schema: { type: 'string' },
            example: 'abc123def456ghi789',
          },
        ],
        get: {
          operationId: 'accessSharedNote',
          summary: 'Access a shared note via link token',
          description: 'Public endpoint — no authentication required. Respects view limits and expiration.',
          tags: ['Notes'],
          security: [],
          responses: {
            '200': jsonResponse('Shared note content', ref('Note')),
            ...errorResponses(404, 410, 500),
          },
        },
      },

      // ── Note Presence ────────────────────────────────────────────────
      '/api/notes/{id}/presence': {
        parameters: [uuidParam('id', 'Note UUID')],
        post: {
          operationId: 'joinNotePresence',
          summary: 'Join note presence (start viewing)',
          tags: ['Notes'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email of the user joining presence',
                example: 'user@example.com',
              },
              cursor_position: ref('CursorPosition'),
            },
          }),
          responses: {
            '200': jsonResponse('Current collaborators', {
              type: 'object',
              required: ['collaborators'],
              properties: {
                collaborators: {
                  type: 'array',
                  items: ref('NotePresenceCollaborator'),
                  description: 'List of users currently viewing the note',
                },
              },
            }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
        delete: {
          operationId: 'leaveNotePresence',
          summary: 'Leave note presence (stop viewing)',
          description: 'User email is sent via the X-User-Email header.',
          tags: ['Notes'],
          parameters: [
            {
              name: 'X-User-Email',
              in: 'header',
              required: true,
              description: 'Email of the user leaving presence',
              schema: { type: 'string' },
              example: 'user@example.com',
            },
          ],
          responses: {
            '204': { description: 'Left presence' },
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'getNotePresence',
          summary: 'Get current viewers of a note',
          tags: ['Notes'],
          parameters: [
            {
              name: 'X-User-Email',
              in: 'header',
              required: true,
              description: 'Email of the requesting user',
              schema: { type: 'string' },
              example: 'user@example.com',
            },
          ],
          responses: {
            '200': jsonResponse('Current collaborators', {
              type: 'object',
              required: ['collaborators'],
              properties: {
                collaborators: {
                  type: 'array',
                  items: ref('NotePresenceCollaborator'),
                  description: 'List of users currently viewing the note',
                },
              },
            }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/notes/{id}/presence/cursor': {
        parameters: [uuidParam('id', 'Note UUID')],
        put: {
          operationId: 'updateNoteCursorPosition',
          summary: 'Update cursor position in a note',
          tags: ['Notes'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email', 'cursor_position'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email of the user updating their cursor',
                example: 'user@example.com',
              },
              cursor_position: ref('CursorPosition'),
            },
          }),
          responses: {
            '204': { description: 'Cursor position updated' },
            ...errorResponses(400, 401, 500),
          },
        },
      },

      // ── Note Search ──────────────────────────────────────────────────
      '/api/notes/search/semantic': {
        post: {
          operationId: 'searchNotesSemantic',
          summary: 'Semantic search for notes (legacy endpoint)',
          tags: ['Notes'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email', 'query'],
            properties: {
              user_email: {
                type: 'string',
                description: 'Email of the user performing the search',
                example: 'user@example.com',
              },
              query: {
                type: 'string',
                description: 'Natural language search query',
                example: 'What decisions did we make about the deployment pipeline?',
              },
              limit: {
                type: 'integer',
                default: 20,
                description: 'Maximum number of results to return',
                example: 10,
              },
              offset: {
                type: 'integer',
                default: 0,
                description: 'Number of results to skip for pagination',
                example: 0,
              },
              notebook_id: {
                type: 'string',
                format: 'uuid',
                description: 'Restrict search to notes in this notebook',
                example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter results to notes with these tags',
                example: ['sprint', 'planning'],
              },
            },
          }),
          responses: {
            '200': jsonResponse('Semantic search results', {
              type: 'object',
              required: ['results', 'total'],
              properties: {
                results: {
                  type: 'array',
                  description: 'Array of matching notes with similarity scores',
                  items: {
                    type: 'object',
                    properties: {
                      note: ref('Note'),
                      similarity: {
                        type: 'number',
                        description: 'Cosine similarity score between 0 and 1',
                        example: 0.87,
                      },
                    },
                  },
                },
                total: {
                  type: 'integer',
                  description: 'Total number of results found',
                  example: 5,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/notes/search': {
        get: {
          operationId: 'searchNotesFullText',
          summary: 'Search notes with privacy filtering',
          description: 'Supports hybrid (text + semantic), text-only, or semantic-only search. Respects hide_from_agents for agent callers.',
          tags: ['Notes'],
          parameters: [
            userEmailQuery(),
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Search query string',
              schema: { type: 'string' },
              example: 'sprint planning priorities',
            },
            {
              name: 'search_type',
              in: 'query',
              description: 'Search mode — hybrid combines text and semantic ranking',
              schema: { type: 'string', enum: ['hybrid', 'text', 'semantic'], default: 'hybrid' },
              example: 'hybrid',
            },
            {
              name: 'notebook_id',
              in: 'query',
              description: 'Restrict search to notes in this notebook',
              schema: { type: 'string', format: 'uuid' },
              example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
            },
            {
              name: 'tags',
              in: 'query',
              description: 'Comma-separated tag filter',
              schema: { type: 'string' },
              example: 'sprint,planning',
            },
            {
              name: 'visibility',
              in: 'query',
              description: 'Filter by visibility level',
              schema: { type: 'string', enum: ['private', 'shared', 'public'] },
              example: 'private',
            },
            {
              name: 'min_similarity',
              in: 'query',
              description: 'Minimum similarity threshold for semantic search (0-1)',
              schema: { type: 'number', default: 0.3 },
              example: 0.5,
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Search results', {
              type: 'object',
              required: ['results', 'total'],
              properties: {
                results: {
                  type: 'array',
                  description: 'Array of matching notes with optional similarity scores',
                  items: {
                    type: 'object',
                    properties: {
                      note: ref('Note'),
                      similarity: {
                        type: 'number',
                        nullable: true,
                        description: 'Similarity score (only present for semantic/hybrid search)',
                        example: 0.82,
                      },
                      rank: {
                        type: 'number',
                        nullable: true,
                        description: 'Text search rank (only present for text/hybrid search)',
                        example: 0.95,
                      },
                    },
                  },
                },
                total: {
                  type: 'integer',
                  description: 'Total number of matching results',
                  example: 15,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/notes/{id}/similar': {
        parameters: [uuidParam('id', 'Note UUID')],
        get: {
          operationId: 'findSimilarNotes',
          summary: 'Find notes similar to a given note',
          tags: ['Notes'],
          parameters: [
            userEmailQuery(),
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of similar notes to return (max 20)',
              schema: { type: 'integer', default: 5, maximum: 20 },
              example: 5,
            },
            {
              name: 'min_similarity',
              in: 'query',
              description: 'Minimum similarity threshold (0-1)',
              schema: { type: 'number', default: 0.5 },
              example: 0.5,
            },
          ],
          responses: {
            '200': jsonResponse('Similar notes', {
              type: 'object',
              required: ['results'],
              properties: {
                results: {
                  type: 'array',
                  description: 'Array of similar notes with similarity scores',
                  items: {
                    type: 'object',
                    properties: {
                      note: ref('Note'),
                      similarity: {
                        type: 'number',
                        description: 'Cosine similarity score',
                        example: 0.78,
                      },
                    },
                  },
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // ── Admin: Note Embeddings ───────────────────────────────────────
      '/api/admin/embeddings/status/notes': {
        get: {
          operationId: 'getNoteEmbeddingStatus',
          summary: 'Get note embedding statistics',
          tags: ['Admin - Note Embeddings'],
          responses: {
            '200': jsonResponse('Note embedding stats', {
              type: 'object',
              required: ['total_notes', 'embedded', 'pending', 'failed'],
              properties: {
                total_notes: {
                  type: 'integer',
                  description: 'Total number of notes in the system',
                  example: 500,
                },
                embedded: {
                  type: 'integer',
                  description: 'Number of notes with successful embeddings',
                  example: 480,
                },
                pending: {
                  type: 'integer',
                  description: 'Number of notes awaiting embedding generation',
                  example: 15,
                },
                failed: {
                  type: 'integer',
                  description: 'Number of notes where embedding generation failed',
                  example: 5,
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },

      '/api/admin/embeddings/backfill/notes': {
        post: {
          operationId: 'backfillNoteEmbeddings',
          summary: 'Backfill note embeddings',
          tags: ['Admin - Note Embeddings'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              limit: {
                type: 'integer',
                default: 100,
                description: 'Maximum number of notes to process in this backfill run',
                example: 100,
              },
              only_pending: {
                type: 'boolean',
                default: true,
                description: 'When true, only process notes without existing embeddings',
                example: true,
              },
              batch_size: {
                type: 'integer',
                default: 10,
                description: 'Number of notes to process per batch',
                example: 10,
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Backfill result', {
              type: 'object',
              required: ['processed', 'succeeded', 'failed'],
              properties: {
                processed: {
                  type: 'integer',
                  description: 'Total number of notes processed',
                  example: 100,
                },
                succeeded: {
                  type: 'integer',
                  description: 'Number of notes successfully embedded',
                  example: 98,
                },
                failed: {
                  type: 'integer',
                  description: 'Number of notes that failed embedding generation',
                  example: 2,
                },
                duration_ms: {
                  type: 'integer',
                  description: 'Total processing time in milliseconds',
                  example: 15000,
                },
              },
            }),
            ...errorResponses(401, 500, 503),
          },
        },
      },
    },
  };
}
