/**
 * OpenAPI path definitions for the Notebooks domain.
 *
 * Covers notebook CRUD, tree hierarchy, archiving, note management,
 * sharing (user + link), and shared-with-me listing.
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

/** Reusable user_email query parameter required on most notebook routes. */
function userEmailQuery(required = true) {
  return {
    name: 'user_email',
    in: 'query' as const,
    required,
    description: 'Email of the authenticated user',
    schema: { type: 'string' as const },
    example: 'alice@example.com',
  };
}

export function notebooksPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Notebooks', description: 'Notebook organisation for notes, with hierarchy and sharing' },
    ],

    schemas: {
      Notebook: {
        type: 'object',
        required: ['id', 'name', 'user_email', 'sort_order', 'is_archived', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the notebook', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          name: { type: 'string', description: 'Name of the notebook', example: 'Project Ideas' },
          description: { type: 'string', nullable: true, description: 'Optional description of the notebook contents or purpose', example: 'Collection of brainstorming notes and ideas for upcoming projects' },
          icon: { type: 'string', nullable: true, description: 'Icon identifier or emoji for the notebook', example: 'lightbulb' },
          color: { type: 'string', nullable: true, description: 'Color code for the notebook (hex or named color)', example: '#4A90D9' },
          user_email: { type: 'string', description: 'Email of the user who owns this notebook', example: 'alice@example.com' },
          parent_notebook_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent notebook for hierarchical nesting, null for root notebooks', example: null },
          sort_order: { type: 'integer', description: 'Sort order among siblings (lower values appear first)', example: 0 },
          is_archived: { type: 'boolean', description: 'Whether the notebook is archived', example: false },
          namespace: { type: 'string', nullable: true, description: 'Namespace scope for multi-tenant isolation', example: 'default' },
          note_count: { type: 'integer', description: 'Number of notes in this notebook (only included when requested)', example: 12 },
          child_count: { type: 'integer', description: 'Number of child notebooks (only included when requested)', example: 3 },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the notebook was created', example: '2026-02-21T14:30:00Z' },
          updated_at: { type: 'string', format: 'date-time', description: 'Timestamp when the notebook was last updated', example: '2026-02-21T14:30:00Z' },
          deleted_at: { type: 'string', format: 'date-time', nullable: true, description: 'Timestamp when the notebook was soft-deleted, null if active', example: null },
        },
      },

      NotebookCreateInput: {
        type: 'object',
        required: ['user_email', 'name'],
        properties: {
          user_email: { type: 'string', description: 'Email of the user creating the notebook', example: 'alice@example.com' },
          name: { type: 'string', description: 'Name of the notebook', example: 'Project Ideas' },
          description: { type: 'string', description: 'Optional description of the notebook', example: 'Notes and ideas for upcoming projects' },
          icon: { type: 'string', description: 'Icon identifier or emoji for the notebook', example: 'lightbulb' },
          color: { type: 'string', description: 'Color code for the notebook', example: '#4A90D9' },
          parent_notebook_id: { type: 'string', format: 'uuid', description: 'UUID of the parent notebook for nesting', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
        },
      },

      NotebookUpdateInput: {
        type: 'object',
        required: ['user_email'],
        properties: {
          user_email: { type: 'string', description: 'Email of the user performing the update', example: 'alice@example.com' },
          name: { type: 'string', description: 'Updated name for the notebook', example: 'Project Ideas (Updated)' },
          description: { type: 'string', nullable: true, description: 'Updated description', example: 'Revised collection of project ideas' },
          icon: { type: 'string', nullable: true, description: 'Updated icon identifier', example: 'star' },
          color: { type: 'string', nullable: true, description: 'Updated color code', example: '#E74C3C' },
          parent_notebook_id: { type: 'string', format: 'uuid', nullable: true, description: 'New parent notebook UUID, or null to move to root', example: null },
          sort_order: { type: 'number', description: 'Updated sort order among siblings', example: 2 },
        },
      },

      NotebookShare: {
        type: 'object',
        required: ['id', 'notebook_id', 'share_type', 'permission', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the share record', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          notebook_id: { type: 'string', format: 'uuid', description: 'UUID of the shared notebook', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          share_type: { type: 'string', enum: ['user', 'link'], description: 'Type of share: user-specific or public link', example: 'user' },
          email: { type: 'string', nullable: true, description: 'Email of the user the notebook is shared with (for user shares)', example: 'bob@example.com' },
          permission: { type: 'string', enum: ['read', 'read_write'], description: 'Permission level granted by this share', example: 'read' },
          token: { type: 'string', nullable: true, description: 'Unique token for link-based shares', example: 'abc123def456' },
          expires_at: { type: 'string', format: 'date-time', nullable: true, description: 'Expiration timestamp for the share, null for permanent shares', example: '2026-03-21T14:30:00Z' },
          created_at: { type: 'string', format: 'date-time', description: 'Timestamp when the share was created', example: '2026-02-21T14:30:00Z' },
        },
      },
    },

    paths: {
      // -- Notebook CRUD --------------------------------------------------------
      '/api/notebooks': {
        get: {
          operationId: 'listNotebooks',
          summary: 'List notebooks with filters',
          tags: ['Notebooks'],
          parameters: [
            userEmailQuery(),
            namespaceParam(),
            {
              name: 'parent_id',
              in: 'query',
              description: 'Filter by parent notebook ID (use "null" for root notebooks)',
              schema: { type: 'string' },
              example: 'null',
            },
            {
              name: 'include_archived',
              in: 'query',
              description: 'Include archived notebooks in results',
              schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
              example: 'false',
            },
            {
              name: 'include_note_counts',
              in: 'query',
              description: 'Include the number of notes in each notebook',
              schema: { type: 'string', enum: ['true', 'false'], default: 'true' },
              example: 'true',
            },
            {
              name: 'include_child_counts',
              in: 'query',
              description: 'Include the number of child notebooks for each notebook',
              schema: { type: 'string', enum: ['true', 'false'], default: 'true' },
              example: 'true',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Notebook list', {
              type: 'object',
              required: ['notebooks', 'total'],
              properties: {
                notebooks: { type: 'array', items: ref('Notebook'), description: 'List of notebooks matching the filters' },
                total: { type: 'integer', description: 'Total number of notebooks matching the filters', example: 8 },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
        post: {
          operationId: 'createNotebook',
          summary: 'Create a new notebook',
          tags: ['Notebooks'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('NotebookCreateInput')),
          responses: {
            '201': jsonResponse('Notebook created', ref('Notebook')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/notebooks/tree': {
        get: {
          operationId: 'getNotebooksTree',
          summary: 'Get notebooks as a tree hierarchy',
          tags: ['Notebooks'],
          parameters: [
            userEmailQuery(),
            namespaceParam(),
            {
              name: 'include_note_counts',
              in: 'query',
              description: 'Include note counts in each tree node',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'true',
            },
          ],
          responses: {
            '200': jsonResponse('Notebook tree', {
              type: 'object',
              required: ['notebooks'],
              properties: {
                notebooks: {
                  type: 'array',
                  description: 'Root-level notebook tree nodes with nested children',
                  items: {
                    type: 'object',
                    required: ['id', 'name', 'children'],
                    description: 'Notebook tree node with nested children',
                    properties: {
                      id: { type: 'string', format: 'uuid', description: 'UUID of the notebook', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
                      name: { type: 'string', description: 'Name of the notebook', example: 'Project Ideas' },
                      description: { type: 'string', nullable: true, description: 'Description of the notebook', example: 'Ideas for upcoming projects' },
                      icon: { type: 'string', nullable: true, description: 'Icon identifier', example: 'lightbulb' },
                      color: { type: 'string', nullable: true, description: 'Color code', example: '#4A90D9' },
                      sort_order: { type: 'integer', description: 'Sort order among siblings', example: 0 },
                      is_archived: { type: 'boolean', description: 'Whether the notebook is archived', example: false },
                      note_count: { type: 'integer', description: 'Number of notes (if requested)', example: 5 },
                      children: {
                        type: 'array',
                        description: 'Child notebook tree nodes (recursive structure)',
                        items: { type: 'object', description: 'Nested notebook tree node (same structure)' },
                      },
                    },
                  },
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/notebooks/{id}': {
        parameters: [uuidParam('id', 'Notebook UUID')],
        get: {
          operationId: 'getNotebook',
          summary: 'Get a single notebook by ID',
          tags: ['Notebooks'],
          parameters: [
            userEmailQuery(),
            {
              name: 'include_notes',
              in: 'query',
              description: 'Include the notes contained in this notebook',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'true',
            },
            {
              name: 'include_children',
              in: 'query',
              description: 'Include child notebooks in the response',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
          ],
          responses: {
            '200': jsonResponse('Notebook details', ref('Notebook')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        put: {
          operationId: 'updateNotebook',
          summary: 'Update a notebook',
          tags: ['Notebooks'],
          requestBody: jsonBody(ref('NotebookUpdateInput')),
          responses: {
            '200': jsonResponse('Updated notebook', ref('Notebook')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteNotebook',
          summary: 'Soft delete a notebook',
          tags: ['Notebooks'],
          parameters: [
            userEmailQuery(),
            {
              name: 'delete_notes',
              in: 'query',
              description: 'Also soft-delete notes in this notebook',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
          ],
          responses: {
            '204': { description: 'Notebook deleted' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notebooks/{id}/archive': {
        parameters: [uuidParam('id', 'Notebook UUID')],
        post: {
          operationId: 'archiveNotebook',
          summary: 'Archive a notebook',
          tags: ['Notebooks'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email'],
            properties: {
              user_email: { type: 'string', description: 'Email of the user performing the archive', example: 'alice@example.com' },
            },
          }),
          responses: {
            '200': jsonResponse('Archived notebook', ref('Notebook')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notebooks/{id}/unarchive': {
        parameters: [uuidParam('id', 'Notebook UUID')],
        post: {
          operationId: 'unarchiveNotebook',
          summary: 'Unarchive a notebook',
          tags: ['Notebooks'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email'],
            properties: {
              user_email: { type: 'string', description: 'Email of the user performing the unarchive', example: 'alice@example.com' },
            },
          }),
          responses: {
            '200': jsonResponse('Unarchived notebook', ref('Notebook')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notebooks/{id}/notes': {
        parameters: [uuidParam('id', 'Notebook UUID')],
        post: {
          operationId: 'moveNotesToNotebook',
          summary: 'Move or copy notes to a notebook',
          tags: ['Notebooks'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email', 'note_ids', 'action'],
            properties: {
              user_email: { type: 'string', description: 'Email of the user performing the operation', example: 'alice@example.com' },
              note_ids: {
                type: 'array',
                items: { type: 'string', format: 'uuid' },
                description: 'UUIDs of notes to move or copy into this notebook',
                example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'b2c3d4e5-f6a7-8901-bcde-f12345678901'],
              },
              action: {
                type: 'string',
                enum: ['move', 'copy'],
                description: 'Whether to move or copy the notes',
                example: 'move',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Operation result', {
              type: 'object',
              required: ['success', 'action', 'count'],
              properties: {
                success: { type: 'boolean', description: 'Whether the operation completed successfully', example: true },
                action: { type: 'string', description: 'The action that was performed (move or copy)', example: 'move' },
                count: { type: 'integer', description: 'Number of notes that were moved or copied', example: 2 },
                notebook_id: { type: 'string', format: 'uuid', description: 'UUID of the target notebook', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
              },
            }),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      // -- Notebook Sharing -----------------------------------------------------
      '/api/notebooks/{id}/share': {
        parameters: [uuidParam('id', 'Notebook UUID')],
        post: {
          operationId: 'shareNotebookWithUser',
          summary: 'Share a notebook with a user by email',
          tags: ['Notebooks'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email', 'email'],
            properties: {
              user_email: { type: 'string', description: 'Email of the notebook owner', example: 'alice@example.com' },
              email: { type: 'string', description: 'Email of the user to share with', example: 'bob@example.com' },
              permission: { type: 'string', enum: ['read', 'read_write'], default: 'read', description: 'Permission level to grant', example: 'read' },
              expires_at: { type: 'string', format: 'date-time', description: 'Optional expiration timestamp for the share', example: '2026-03-21T14:30:00Z' },
            },
          }),
          responses: {
            '201': jsonResponse('Share created', ref('NotebookShare')),
            ...errorResponses(400, 401, 403, 404, 409, 500),
          },
        },
      },

      '/api/notebooks/{id}/share/link': {
        parameters: [uuidParam('id', 'Notebook UUID')],
        post: {
          operationId: 'createNotebookShareLink',
          summary: 'Create a shareable link for a notebook',
          tags: ['Notebooks'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email'],
            properties: {
              user_email: { type: 'string', description: 'Email of the notebook owner', example: 'alice@example.com' },
              permission: { type: 'string', enum: ['read', 'read_write'], default: 'read', description: 'Permission level for the link', example: 'read' },
              expires_at: { type: 'string', format: 'date-time', description: 'Optional expiration timestamp for the share link', example: '2026-03-21T14:30:00Z' },
            },
          }),
          responses: {
            '201': jsonResponse('Share link created', ref('NotebookShare')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notebooks/{id}/shares': {
        parameters: [uuidParam('id', 'Notebook UUID')],
        get: {
          operationId: 'listNotebookShares',
          summary: 'List all shares for a notebook',
          tags: ['Notebooks'],
          parameters: [userEmailQuery()],
          responses: {
            '200': jsonResponse('Shares list', {
              type: 'object',
              required: ['shares'],
              properties: {
                shares: { type: 'array', items: ref('NotebookShare'), description: 'List of active shares for this notebook' },
              },
            }),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notebooks/{id}/shares/{share_id}': {
        parameters: [
          uuidParam('id', 'Notebook UUID'),
          uuidParam('share_id', 'Share UUID'),
        ],
        put: {
          operationId: 'updateNotebookShare',
          summary: 'Update a notebook share',
          tags: ['Notebooks'],
          requestBody: jsonBody({
            type: 'object',
            required: ['user_email'],
            properties: {
              user_email: { type: 'string', description: 'Email of the notebook owner', example: 'alice@example.com' },
              permission: { type: 'string', enum: ['read', 'read_write'], description: 'Updated permission level', example: 'read_write' },
              expires_at: { type: 'string', format: 'date-time', nullable: true, description: 'Updated expiration timestamp, or null to remove expiration', example: '2026-04-21T14:30:00Z' },
            },
          }),
          responses: {
            '200': jsonResponse('Updated share', ref('NotebookShare')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'revokeNotebookShare',
          summary: 'Revoke a notebook share',
          tags: ['Notebooks'],
          parameters: [userEmailQuery()],
          responses: {
            '204': { description: 'Share revoked' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/notebooks/shared-with-me': {
        get: {
          operationId: 'listNotebooksSharedWithMe',
          summary: 'List notebooks shared with the current user',
          tags: ['Notebooks'],
          parameters: [userEmailQuery()],
          responses: {
            '200': jsonResponse('Shared notebooks', {
              type: 'object',
              required: ['notebooks'],
              properties: {
                notebooks: { type: 'array', items: ref('Notebook'), description: 'Notebooks shared with the requesting user' },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },

      '/api/shared/notebooks/{token}': {
        parameters: [
          {
            name: 'token',
            in: 'path',
            required: true,
            description: 'Share link token for accessing the notebook',
            schema: { type: 'string' },
            example: 'abc123def456',
          },
        ],
        get: {
          operationId: 'accessSharedNotebook',
          summary: 'Access a shared notebook via link token',
          description: 'Public endpoint -- no authentication required.',
          tags: ['Notebooks'],
          security: [],
          responses: {
            '200': jsonResponse('Shared notebook content', ref('Notebook')),
            ...errorResponses(404, 410, 500),
          },
        },
      },
    },
  };
}
