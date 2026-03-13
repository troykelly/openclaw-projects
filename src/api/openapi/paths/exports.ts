/**
 * OpenAPI path definitions for note/notebook exports.
 * Part of Epic #2475, Issue #2478.
 *
 * Routes:
 *   POST   /namespaces/{ns}/notes/{id}/exports
 *   POST   /namespaces/{ns}/notebooks/{id}/exports
 *   GET    /namespaces/{ns}/exports/{export_id}
 *   GET    /namespaces/{ns}/exports
 *   DELETE /namespaces/{ns}/exports/{export_id}
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, uuidParam, errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

export function exportsPaths(): OpenApiDomainModule {
  const nsParam = {
    name: 'ns',
    in: 'path' as const,
    required: true,
    description: 'Namespace identifier',
    schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]*$', maxLength: 63 },
    example: 'my-workspace',
  };

  const noteIdParam = uuidParam('id', 'Note UUID');
  const notebookIdParam = uuidParam('id', 'Notebook UUID');
  const exportIdParam = uuidParam('export_id', 'Export job UUID');

  return {
    tags: [
      { name: 'Exports', description: 'Export notes and notebooks to PDF, DOCX, and ODF formats' },
    ],

    schemas: {
      ExportFormat: {
        type: 'string',
        enum: ['pdf', 'docx', 'odf'],
        description: 'Output format for the export',
        example: 'pdf',
      },
      ExportOptions: {
        type: 'object',
        properties: {
          page_size: {
            type: 'string',
            enum: ['A4', 'Letter'],
            description: 'Page size for PDF exports',
            example: 'A4',
          },
          include_metadata: {
            type: 'boolean',
            description: 'Include document metadata (title, date)',
            default: false,
          },
        },
      },
      ExportRequest: {
        type: 'object',
        required: ['format'],
        properties: {
          format: ref('ExportFormat'),
          options: ref('ExportOptions'),
        },
      },
      ExportResponse: {
        type: 'object',
        required: ['id', 'status', 'format', 'source_type', 'source_id', 'expires_at', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Export job ID' },
          status: {
            type: 'string',
            enum: ['pending', 'generating', 'ready', 'failed', 'expired'],
            description: 'Current status of the export job',
          },
          format: ref('ExportFormat'),
          source_type: { type: 'string', enum: ['note', 'notebook'] },
          source_id: { type: 'string', format: 'uuid' },
          original_filename: { type: 'string', nullable: true, description: 'Generated filename', example: 'Meeting_Notes.pdf' },
          size_bytes: { type: 'integer', nullable: true, description: 'File size in bytes' },
          download_url: { type: 'string', format: 'uri', nullable: true, description: 'Time-limited presigned S3 URL (only present when status=ready)' },
          poll_url: { type: 'string', nullable: true, description: 'URL to poll for status (only present for async exports)' },
          error_message: { type: 'string', nullable: true, description: 'Error details (only present when status=failed)' },
          expires_at: { type: 'string', format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      ExportListResponse: {
        type: 'object',
        required: ['exports', 'total', 'limit', 'offset'],
        properties: {
          exports: { type: 'array', items: ref('ExportResponse') },
          total: { type: 'integer', description: 'Total matching exports' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
    },

    paths: {
      '/namespaces/{ns}/notes/{id}/exports': {
        post: {
          operationId: 'exportNote',
          summary: 'Export a note',
          description: 'Creates an export job for a single note. Small notes are exported synchronously (200), larger notes asynchronously (202). Rate limited to 10 requests per user per minute.',
          tags: ['Exports'],
          parameters: [nsParam, noteIdParam],
          requestBody: jsonBody(ref('ExportRequest')),
          responses: {
            '200': jsonResponse('Export completed synchronously — download_url included', ref('ExportResponse')),
            '202': jsonResponse('Export job created — poll poll_url for status', ref('ExportResponse')),
            ...errorResponses(401, 403, 404, 422, 429, 500, 503),
          },
        },
      },

      '/namespaces/{ns}/notebooks/{id}/exports': {
        post: {
          operationId: 'exportNotebook',
          summary: 'Export a notebook',
          description: 'Creates an export job for an entire notebook (all notes in sort order). Always asynchronous (202). Rate limited to 10 requests per user per minute.',
          tags: ['Exports'],
          parameters: [nsParam, notebookIdParam],
          requestBody: jsonBody(ref('ExportRequest')),
          responses: {
            '202': jsonResponse('Export job created — poll poll_url for status', ref('ExportResponse')),
            ...errorResponses(401, 403, 404, 422, 429, 500, 503),
          },
        },
      },

      '/namespaces/{ns}/exports/{export_id}': {
        get: {
          operationId: 'getExport',
          summary: 'Get export status',
          description: 'Returns the current status of an export job. When status is "ready", includes a download_url (presigned S3 URL regenerated on each request). Returns 410 for expired exports.',
          tags: ['Exports'],
          parameters: [nsParam, exportIdParam],
          responses: {
            '200': jsonResponse('Export status', ref('ExportResponse')),
            ...errorResponses(401, 403, 404, 410, 500, 503),
          },
        },
        delete: {
          operationId: 'deleteExport',
          summary: 'Delete an export',
          description: 'Cancels a pending/generating export or deletes a ready export (including the S3 object). Returns 204 on success.',
          tags: ['Exports'],
          parameters: [nsParam, exportIdParam],
          responses: {
            '204': { description: 'Export deleted successfully' },
            ...errorResponses(401, 403, 404, 500, 503),
          },
        },
      },

      '/namespaces/{ns}/exports': {
        get: {
          operationId: 'listExports',
          summary: 'List exports',
          description: 'Lists the authenticated user\'s exports within a namespace. Supports status filtering and pagination.',
          tags: ['Exports'],
          parameters: [
            nsParam,
            {
              name: 'status',
              in: 'query',
              description: 'Filter by export status',
              schema: { type: 'string', enum: ['pending', 'generating', 'ready', 'failed', 'expired'] },
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum results (default 20, max 100)',
              schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
            },
            {
              name: 'offset',
              in: 'query',
              description: 'Number of results to skip',
              schema: { type: 'integer', default: 0, minimum: 0 },
            },
          ],
          responses: {
            '200': jsonResponse('List of exports', ref('ExportListResponse')),
            ...errorResponses(401, 403, 500),
          },
        },
      },
    },
  };
}
