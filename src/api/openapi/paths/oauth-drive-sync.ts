/**
 * OpenAPI path definitions for OAuth, Drive files, and sync endpoints.
 * Routes: GET /api/oauth/connections, GET /api/oauth/authorize/:provider,
 *         GET /api/oauth/callback, GET /api/oauth/providers,
 *         DELETE /api/oauth/connections/:id, PATCH /api/oauth/connections/:id,
 *         GET /api/drive/files, GET /api/drive/files/search, GET /api/drive/files/:id,
 *         POST /api/sync/contacts, GET /api/sync/status/:connection_id
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, uuidParam } from '../helpers.ts';

export function oauthDriveSyncPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'OAuth', description: 'OAuth connection management for Google and Microsoft providers' },
      { name: 'Drive', description: 'File access via connected cloud drives (Google Drive, OneDrive)' },
      { name: 'Sync', description: 'Data synchronisation from OAuth providers (contacts, emails, calendar)' },
    ],
    schemas: {
      OAuthConnection: {
        type: 'object',
        required: ['id', 'user_email', 'provider', 'scopes', 'permission_level', 'is_active', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier of the OAuth connection',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          user_email: {
            type: 'string',
            description: 'Email address of the user who owns this connection',
            example: 'alice@example.com',
          },
          provider: {
            type: 'string',
            enum: ['google', 'microsoft'],
            description: 'OAuth provider name',
            example: 'google',
          },
          scopes: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of OAuth scopes granted for this connection',
            example: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar'],
          },
          expires_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Expiry time of the current access token, or null if not available',
            example: '2026-02-21T15:30:00Z',
          },
          label: {
            type: 'string',
            nullable: true,
            description: 'Human-readable label for identifying this connection',
            example: 'Work Gmail',
          },
          provider_account_id: {
            type: 'string',
            nullable: true,
            description: 'Provider-specific account identifier',
            example: '123456789012345678901',
          },
          provider_account_email: {
            type: 'string',
            nullable: true,
            description: 'Email address from the provider account',
            example: 'alice@gmail.com',
          },
          permission_level: {
            type: 'string',
            enum: ['read', 'read_write'],
            description: 'Permission level granted by the user for this connection',
            example: 'read',
          },
          enabled_features: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of enabled feature categories (contacts, email, files, calendar)',
            example: ['email', 'calendar', 'contacts'],
          },
          is_active: {
            type: 'boolean',
            description: 'Whether this connection is currently active and usable',
            example: true,
          },
          last_sync_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp of the most recent sync operation for this connection',
            example: '2026-02-21T14:00:00Z',
          },
          sync_status: {
            type: 'string',
            nullable: true,
            description: 'Current sync status (e.g. idle, syncing, error)',
            example: 'idle',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the connection was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the connection was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      OAuthProvider: {
        type: 'object',
        required: ['name', 'configured'],
        properties: {
          name: {
            type: 'string',
            enum: ['google', 'microsoft'],
            description: 'OAuth provider identifier',
            example: 'google',
          },
          configured: {
            type: 'boolean',
            description: 'Whether the provider has valid client credentials configured',
            example: true,
          },
          hint: {
            type: 'string',
            description: 'Setup hint displayed when the provider is not configured',
            example: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables',
          },
        },
      },
      DriveFile: {
        type: 'object',
        required: ['id', 'name', 'mime_type'],
        properties: {
          id: {
            type: 'string',
            description: 'Provider-specific file identifier',
            example: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
          },
          name: {
            type: 'string',
            description: 'File name as displayed in the provider',
            example: 'Project Requirements.docx',
          },
          mime_type: {
            type: 'string',
            description: 'MIME type of the file',
            example: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          size: {
            type: 'integer',
            nullable: true,
            description: 'File size in bytes, or null if not available',
            example: 245760,
          },
          created_time: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the file was created in the provider',
            example: '2026-02-15T10:00:00Z',
          },
          modified_time: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the file was last modified in the provider',
            example: '2026-02-20T16:45:00Z',
          },
          web_view_link: {
            type: 'string',
            nullable: true,
            description: 'URL to view or edit the file in the provider web UI',
            example: 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit',
          },
        },
      },
      ContactSyncResult: {
        type: 'object',
        required: ['status', 'provider', 'user_email', 'synced_count', 'created_count', 'updated_count', 'incremental'],
        properties: {
          status: {
            type: 'string',
            description: 'Overall status of the contact sync operation',
            example: 'completed',
          },
          provider: {
            type: 'string',
            description: 'OAuth provider contacts were synced from',
            example: 'google',
          },
          user_email: {
            type: 'string',
            description: 'Email of the user whose contacts were synced',
            example: 'alice@example.com',
          },
          synced_count: {
            type: 'integer',
            description: 'Total number of contacts processed during sync',
            example: 150,
          },
          created_count: {
            type: 'integer',
            description: 'Number of new contacts created locally',
            example: 25,
          },
          updated_count: {
            type: 'integer',
            description: 'Number of existing contacts updated locally',
            example: 10,
          },
          incremental: {
            type: 'boolean',
            description: 'Whether this was an incremental sync (true) or a full re-sync (false)',
            example: true,
          },
        },
      },
    },
    paths: {
      '/api/oauth/connections': {
        get: {
          operationId: 'listOAuthConnections',
          summary: 'List OAuth connections',
          description: 'Returns all OAuth connections, optionally filtered by user email or provider.',
          tags: ['OAuth'],
          parameters: [
            {
              name: 'user_email',
              in: 'query',
              description: 'Filter connections by user email address',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
            {
              name: 'provider',
              in: 'query',
              description: 'Filter connections by OAuth provider name',
              schema: { type: 'string', enum: ['google', 'microsoft'] },
              example: 'google',
            },
          ],
          responses: {
            '200': jsonResponse('OAuth connections', {
              type: 'object',
              properties: {
                connections: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/OAuthConnection' },
                  description: 'List of OAuth connections matching the filter criteria',
                },
              },
            }),
            ...errorResponses(401, 403, 500),
          },
        },
      },
      '/api/oauth/authorize/{provider}': {
        get: {
          operationId: 'authorizeOAuth',
          summary: 'Redirect to OAuth provider authorization',
          description: 'Initiates an OAuth authorization flow by redirecting to the provider. Supports feature-based scope selection and PKCE.',
          tags: ['OAuth'],
          parameters: [
            {
              name: 'provider',
              in: 'path',
              required: true,
              description: 'OAuth provider to authorize with',
              schema: { type: 'string', enum: ['google', 'microsoft'] },
              example: 'google',
            },
            {
              name: 'scopes',
              in: 'query',
              description: 'Comma-separated raw OAuth scope strings (legacy; prefer features parameter)',
              schema: { type: 'string' },
              example: 'https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/calendar',
            },
            {
              name: 'features',
              in: 'query',
              description: 'Comma-separated feature names to request scopes for (contacts, email, files, calendar)',
              schema: { type: 'string' },
              example: 'email,calendar,contacts',
            },
            {
              name: 'permission_level',
              in: 'query',
              description: 'Permission level to request from the user',
              schema: { type: 'string', enum: ['read', 'read_write'], default: 'read' },
              example: 'read',
            },
          ],
          responses: {
            '302': { description: 'Redirect to provider authorization page' },
            ...errorResponses(400, 401, 503),
          },
        },
      },
      '/api/oauth/callback': {
        get: {
          operationId: 'handleOAuthCallback',
          summary: 'Handle OAuth callback',
          description: 'Processes the OAuth authorization callback, exchanges code for tokens, saves the connection, and redirects to the SPA.',
          tags: ['OAuth'],
          security: [],
          parameters: [
            {
              name: 'code',
              in: 'query',
              description: 'Authorization code returned by the OAuth provider',
              schema: { type: 'string' },
              example: '4/0AX4XfWgV8nYm-_example_code',
            },
            {
              name: 'state',
              in: 'query',
              description: 'OAuth state parameter for CSRF protection and flow tracking',
              schema: { type: 'string' },
              example: 'eyJhbGciOiJIUzI1NiJ9.state_payload',
            },
            {
              name: 'error',
              in: 'query',
              description: 'Error code from the provider if authorization was denied',
              schema: { type: 'string' },
              example: 'access_denied',
            },
          ],
          responses: {
            '302': { description: 'Redirect to SPA with auth code' },
            '400': {
              description: 'Bad request — authorization denied, missing parameters, or invalid state',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string', description: 'Human-readable error message' },
                      code: { type: 'string', description: 'Machine-readable error code', enum: ['INVALID_STATE', 'MISSING_STATE', 'MISSING_CODE'] },
                      details: { type: 'string', description: 'Provider error code when authorization was denied (e.g. access_denied)' },
                    },
                    required: ['error'],
                  },
                  examples: {
                    invalidState: { summary: 'Invalid or expired state', value: { error: 'Invalid or expired OAuth state', code: 'INVALID_STATE' } },
                    missingState: { summary: 'Missing state parameter', value: { error: 'Missing OAuth state parameter' } },
                    denied: { summary: 'Authorization denied', value: { error: 'OAuth authorization failed', details: 'access_denied' } },
                  },
                },
              },
            },
            ...errorResponses(401, 500, 502, 503),
          },
        },
      },
      '/api/oauth/providers': {
        get: {
          operationId: 'listOAuthProviders',
          summary: 'List configured OAuth providers',
          description: 'Returns a list of all supported OAuth providers and whether they are configured.',
          tags: ['OAuth'],
          responses: {
            '200': jsonResponse('Provider list', {
              type: 'object',
              properties: {
                providers: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/OAuthProvider' },
                  description: 'List of configured and available OAuth providers',
                },
                unconfigured: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/OAuthProvider' },
                  description: 'List of supported but not yet configured OAuth providers',
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/oauth/connections/{id}': {
        delete: {
          operationId: 'deleteOAuthConnection',
          summary: 'Remove an OAuth connection',
          description: 'Permanently deletes an OAuth connection and removes any pending sync jobs.',
          tags: ['OAuth'],
          parameters: [uuidParam('id', 'OAuth connection ID')],
          responses: {
            '204': { description: 'Connection deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateOAuthConnection',
          summary: 'Update connection settings',
          description: 'Updates label, features, permission level, or active status. If new scopes are required, returns a reAuthUrl for re-authorization.',
          tags: ['OAuth'],
          parameters: [uuidParam('id', 'OAuth connection ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'Human-readable label for identifying this connection',
                example: 'Work Gmail',
              },
              permission_level: {
                type: 'string',
                enum: ['read', 'read_write'],
                description: 'Desired permission level for this connection',
                example: 'read_write',
              },
              enabled_features: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of features to enable for this connection',
                example: ['email', 'calendar', 'contacts'],
              },
              is_active: {
                type: 'boolean',
                description: 'Whether this connection should be active',
                example: true,
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated connection', {
              type: 'object',
              properties: {
                connection: {
                  $ref: '#/components/schemas/OAuthConnection',
                  description: 'The updated OAuth connection',
                },
                reAuthRequired: {
                  type: 'boolean',
                  description: 'Whether the user needs to re-authorize for additional scopes',
                  example: false,
                },
                reAuthUrl: {
                  type: 'string',
                  description: 'URL to redirect the user for re-authorization, if reAuthRequired is true',
                  example: 'https://accounts.google.com/o/oauth2/v2/auth?scope=...',
                },
                missingScopes: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of scopes that need to be granted for the requested features',
                  example: ['https://www.googleapis.com/auth/drive.readonly'],
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
      },
      '/api/drive/files': {
        get: {
          operationId: 'listDriveFiles',
          summary: 'List files from connected drive',
          description: 'Lists files from a connected Google Drive or OneDrive, optionally filtered by folder.',
          tags: ['Drive'],
          parameters: [
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection to list files from',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
            {
              name: 'folder_id',
              in: 'query',
              description: 'Provider-specific folder ID to list files from',
              schema: { type: 'string' },
              example: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs',
            },
            {
              name: 'page_token',
              in: 'query',
              description: 'Pagination token from a previous response',
              schema: { type: 'string' },
              example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
            },
          ],
          responses: {
            '200': jsonResponse('File list', {
              type: 'object',
              properties: {
                files: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/DriveFile' },
                  description: 'List of files from the connected drive',
                },
                next_page_token: {
                  type: 'string',
                  nullable: true,
                  description: 'Token to fetch the next page of results, or null if no more pages',
                  example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
      },
      '/api/drive/files/search': {
        get: {
          operationId: 'searchDriveFiles',
          summary: 'Search files in connected drive',
          description: 'Searches files across a connected cloud drive using a query string.',
          tags: ['Drive'],
          parameters: [
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection to search files in',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Search query string to match against file names and content',
              schema: { type: 'string' },
              example: 'project requirements',
            },
            {
              name: 'page_token',
              in: 'query',
              description: 'Pagination token from a previous response',
              schema: { type: 'string' },
              example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
            },
          ],
          responses: {
            '200': jsonResponse('Search results', {
              type: 'object',
              properties: {
                files: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/DriveFile' },
                  description: 'Files matching the search query',
                },
                next_page_token: {
                  type: 'string',
                  nullable: true,
                  description: 'Token to fetch the next page of results, or null if no more pages',
                  example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
      },
      '/api/drive/files/{id}': {
        get: {
          operationId: 'getDriveFile',
          summary: 'Get file metadata',
          description: 'Returns metadata and download URL for a single file from a connected drive.',
          tags: ['Drive'],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              description: 'Provider-specific file identifier',
              schema: { type: 'string' },
              example: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
            },
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection to retrieve the file from',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          ],
          responses: {
            '200': jsonResponse('File metadata', {
              type: 'object',
              properties: {
                file: {
                  $ref: '#/components/schemas/DriveFile',
                  description: 'File metadata from the connected drive',
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
      },
      '/api/sync/contacts': {
        post: {
          operationId: 'syncContacts',
          summary: 'Trigger contact sync from OAuth provider',
          description: 'Performs a contact sync from the connected provider. Supports incremental sync using a stored cursor.',
          tags: ['Sync'],
          requestBody: jsonBody({
            type: 'object',
            required: ['connection_id'],
            properties: {
              connection_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the OAuth connection to sync contacts from',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              incremental: {
                type: 'boolean',
                default: true,
                description: 'Use incremental sync with stored cursor (true) or perform a full re-sync (false)',
                example: true,
              },
            },
          }),
          responses: {
            '200': jsonResponse('Sync result', { $ref: '#/components/schemas/ContactSyncResult' }),
            ...errorResponses(400, 401, 500, 502),
          },
        },
      },
      '/api/sync/status/{connection_id}': {
        get: {
          operationId: 'getSyncStatus',
          summary: 'Get sync status for a connection',
          description: 'Returns the current sync status and metadata for an OAuth connection.',
          tags: ['Sync'],
          parameters: [uuidParam('connection_id', 'OAuth connection ID')],
          responses: {
            '200': jsonResponse('Sync status', {
              type: 'object',
              properties: {
                connection_id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'UUID of the OAuth connection',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                sync_status: {
                  type: 'object',
                  description: 'Current sync status details per feature',
                  properties: {
                    contacts: {
                      type: 'object',
                      description: 'Contact sync status',
                      properties: {
                        last_sync_at: {
                          type: 'string',
                          format: 'date-time',
                          nullable: true,
                          description: 'Timestamp of the last contact sync',
                          example: '2026-02-21T14:00:00Z',
                        },
                        status: {
                          type: 'string',
                          description: 'Current sync status for contacts',
                          example: 'idle',
                        },
                        synced_count: {
                          type: 'integer',
                          description: 'Total contacts synced in the last run',
                          example: 150,
                        },
                      },
                    },
                    calendar: {
                      type: 'object',
                      description: 'Calendar sync status',
                      properties: {
                        last_sync_at: {
                          type: 'string',
                          format: 'date-time',
                          nullable: true,
                          description: 'Timestamp of the last calendar sync',
                          example: '2026-02-21T13:30:00Z',
                        },
                        status: {
                          type: 'string',
                          description: 'Current sync status for calendar',
                          example: 'idle',
                        },
                        synced_count: {
                          type: 'integer',
                          description: 'Total events synced in the last run',
                          example: 25,
                        },
                      },
                    },
                  },
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
