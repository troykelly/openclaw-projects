/**
 * OpenAPI path definitions for file storage and sharing.
 * Routes: POST /api/files/upload, GET /api/files, GET /api/files/share,
 *         GET /api/files/{id}, GET /api/files/{id}/metadata,
 *         GET /api/files/{id}/url, DELETE /api/files/{id},
 *         POST /api/files/{id}/share, GET /api/files/shared/{token}
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, uuidParam, errorResponses, jsonBody, jsonResponse, namespaceParam } from '../helpers.ts';

export function filesPaths(): OpenApiDomainModule {
  const fileIdParam = uuidParam('id', 'File UUID');

  return {
    tags: [
      { name: 'Files', description: 'File upload, download, metadata, and sharing via S3-compatible storage' },
    ],

    schemas: {
      FileMetadata: {
        type: 'object',
        required: ['id', 'original_filename', 'content_type', 'size_bytes', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the uploaded file', example: 'd9e0f1a2-3456-78ab-cdef-901234567890' },
          original_filename: { type: 'string', description: 'Original filename at upload time', example: 'auth-flow-diagram.png' },
          content_type: { type: 'string', description: 'MIME type of the file', example: 'image/png' },
          size_bytes: { type: 'integer', description: 'File size in bytes', example: 245760 },
          uploaded_by: { type: 'string', nullable: true, description: 'Email of the user who uploaded the file, or null if uploaded by system', example: 'alice@example.com' },
          created_at: { type: 'string', format: 'date-time', description: 'When the file was uploaded', example: '2026-02-21T14:30:00Z' },
        },
      },
      FileUploadResponse: {
        type: 'object',
        required: ['id', 'original_filename', 'content_type', 'size_bytes', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the uploaded file', example: 'd9e0f1a2-3456-78ab-cdef-901234567890' },
          original_filename: { type: 'string', description: 'Original filename at upload time', example: 'auth-flow-diagram.png' },
          content_type: { type: 'string', description: 'MIME type of the file', example: 'image/png' },
          size_bytes: { type: 'integer', description: 'File size in bytes', example: 245760 },
          uploaded_by: { type: 'string', nullable: true, description: 'Email of the user who uploaded the file', example: 'alice@example.com' },
          created_at: { type: 'string', format: 'date-time', description: 'When the file was uploaded', example: '2026-02-21T14:30:00Z' },
        },
      },
      FileUrlResponse: {
        type: 'object',
        required: ['url', 'expires_in', 'filename', 'content_type'],
        properties: {
          url: { type: 'string', format: 'uri', description: 'Time-limited signed URL for direct download from S3', example: 'https://s3.example.com/files/d9e0f1a2?X-Amz-Signature=abc123' },
          expires_in: { type: 'integer', description: 'URL validity duration in seconds', example: 3600 },
          filename: { type: 'string', description: 'Original filename for the download', example: 'auth-flow-diagram.png' },
          content_type: { type: 'string', description: 'MIME type of the file', example: 'image/png' },
        },
      },
      FileShareRequest: {
        type: 'object',
        properties: {
          expires_in: {
            type: 'integer',
            default: 3600,
            minimum: 60,
            maximum: 604800,
            description: 'Share link validity in seconds (minimum 1 minute, maximum 7 days)',
            example: 3600,
          },
          max_downloads: {
            type: 'integer',
            description: 'Maximum number of times the share link can be used to download the file',
            example: 10,
          },
        },
      },
      FileShareResponse: {
        type: 'object',
        required: ['token', 'url', 'expires_at'],
        properties: {
          token: { type: 'string', description: 'Unique share token for constructing the download URL', example: 'abc123def456ghi789' },
          url: { type: 'string', format: 'uri', description: 'Full shareable download URL (no authentication required)', example: 'https://api.example.com/api/files/shared/abc123def456ghi789' },
          expires_at: { type: 'string', format: 'date-time', description: 'When the share link expires', example: '2026-02-21T15:30:00Z' },
          max_downloads: { type: 'integer', nullable: true, description: 'Maximum downloads allowed, or null for unlimited', example: 10 },
        },
      },
      FileListResponse: {
        type: 'object',
        required: ['files', 'total'],
        properties: {
          files: { type: 'array', items: { $ref: '#/components/schemas/FileMetadata' }, description: 'Array of file metadata records' },
          total: { type: 'integer', description: 'Total number of files matching the filter criteria', example: 42 },
        },
      },
    },

    paths: {
      '/api/files/upload': {
        post: {
          operationId: 'uploadFile',
          summary: 'Upload a file',
          description: 'Uploads a file to S3-compatible storage. Accepts multipart/form-data with a file field. Returns 503 if storage is not configured.',
          tags: ['Files'],
          parameters: [namespaceParam()],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: {
                      type: 'string',
                      format: 'binary',
                      description: 'The file to upload (any content type supported)',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Uploaded file metadata', ref('FileUploadResponse')),
            '400': jsonResponse('No file provided', ref('Error')),
            '413': jsonResponse('File too large', {
              type: 'object',
              required: ['error', 'message', 'max_size_bytes'],
              properties: {
                error: { type: 'string', description: 'Error code', example: 'FILE_TOO_LARGE' },
                message: { type: 'string', description: 'Human-readable error message', example: 'File exceeds the maximum upload size of 50MB' },
                max_size_bytes: { type: 'integer', description: 'Maximum allowed file size in bytes', example: 52428800 },
              },
            }),
            ...errorResponses(401, 403, 500, 503),
          },
        },
      },

      '/api/files': {
        get: {
          operationId: 'listFiles',
          summary: 'List files',
          description: 'Returns a paginated list of uploaded files with optional filtering by uploader.',
          tags: ['Files'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum results to return',
              schema: { type: 'integer' },
              example: 50,
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of results to skip for pagination',
              schema: { type: 'integer' },
              example: 0,
            },
            {
              name: 'uploaded_by',
              in: 'query',
              description: 'Filter by uploader email address',
              schema: { type: 'string' },
              example: 'alice@example.com',
            },
          ],
          responses: {
            '200': jsonResponse('File list', ref('FileListResponse')),
            ...errorResponses(401, 403, 500),
          },
        },
      },

      '/api/files/share': {
        get: {
          operationId: 'getFileShareInfo',
          summary: 'File share endpoint clarification',
          description: 'Returns an error explaining the correct endpoints for file sharing. Use POST /api/files/{id}/share to create a share link, or GET /api/files/shared/{token} to download.',
          tags: ['Files'],
          responses: {
            '400': jsonResponse('Endpoint clarification', {
              type: 'object',
              required: ['error', 'message'],
              properties: {
                error: { type: 'string', description: 'Error code indicating incorrect endpoint usage', example: 'INVALID_ENDPOINT' },
                message: { type: 'string', description: 'Instructions for using the correct endpoints', example: 'Use POST /api/files/{id}/share to create a share link, or GET /api/files/shared/{token} to download.' },
              },
            }),
          },
        },
      },

      '/api/files/{id}': {
        parameters: [fileIdParam],
        get: {
          operationId: 'downloadFile',
          summary: 'Download a file',
          description: 'Downloads the file content. Returns the file with appropriate Content-Type and Content-Disposition headers.',
          tags: ['Files'],
          responses: {
            '200': {
              description: 'File content',
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
              headers: {
                'Content-Type': { schema: { type: 'string', example: 'image/png' }, description: 'MIME type of the file' },
                'Content-Disposition': { schema: { type: 'string', example: 'attachment; filename="auth-flow-diagram.png"' }, description: 'Attachment filename for download' },
                'Content-Length': { schema: { type: 'integer', example: 245760 }, description: 'File size in bytes' },
              },
            },
            ...errorResponses(401, 404, 500, 503),
          },
        },
        delete: {
          operationId: 'deleteFile',
          summary: 'Delete a file',
          description: 'Permanently deletes a file from storage and its metadata from the database.',
          tags: ['Files'],
          responses: {
            '204': { description: 'File deleted' },
            ...errorResponses(401, 404, 500, 503),
          },
        },
      },

      '/api/files/{id}/metadata': {
        parameters: [fileIdParam],
        get: {
          operationId: 'getFileMetadata',
          summary: 'Get file metadata',
          description: 'Returns metadata about a file without downloading its content.',
          tags: ['Files'],
          responses: {
            '200': jsonResponse('File metadata', ref('FileMetadata')),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/files/{id}/url': {
        parameters: [fileIdParam],
        get: {
          operationId: 'getFileUrl',
          summary: 'Get a signed download URL',
          description: 'Returns a time-limited signed URL for downloading the file directly from S3.',
          tags: ['Files'],
          parameters: [
            {
              name: 'expires_in',
              in: 'query',
              description: 'URL validity in seconds (default: 3600, min: 60, max: 86400)',
              schema: { type: 'integer', default: 3600, minimum: 60, maximum: 86400 },
              example: 3600,
            },
          ],
          responses: {
            '200': jsonResponse('Signed URL', ref('FileUrlResponse')),
            ...errorResponses(400, 401, 404, 500, 503),
          },
        },
      },

      '/api/files/{id}/share': {
        parameters: [fileIdParam],
        post: {
          operationId: 'createFileShare',
          summary: 'Create a shareable download link',
          description: 'Creates a share token for a file. The resulting URL can be accessed without authentication. Only the file uploader can create share links.',
          tags: ['Files'],
          requestBody: jsonBody(ref('FileShareRequest'), false),
          responses: {
            '200': jsonResponse('Share link created', ref('FileShareResponse')),
            ...errorResponses(400, 401, 403, 404, 500, 503),
          },
        },
      },

      '/api/files/shared/{token}': {
        parameters: [
          {
            name: 'token',
            in: 'path',
            required: true,
            description: 'Share token from the share link',
            schema: { type: 'string' },
            example: 'abc123def456ghi789',
          },
        ],
        get: {
          operationId: 'downloadSharedFile',
          summary: 'Download a file via share token',
          description: 'Downloads a file using a share token. No authentication required. Share links may have expiration dates and download limits.',
          tags: ['Files'],
          security: [],
          responses: {
            '200': {
              description: 'File content',
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
              headers: {
                'Content-Type': { schema: { type: 'string', example: 'image/png' }, description: 'MIME type of the file' },
                'Content-Disposition': { schema: { type: 'string', example: 'attachment; filename="auth-flow-diagram.png"' }, description: 'Attachment filename for download' },
                'Content-Length': { schema: { type: 'integer', example: 245760 }, description: 'File size in bytes' },
              },
            },
            ...errorResponses(403, 404, 500, 503),
          },
        },
      },
    },
  };
}
