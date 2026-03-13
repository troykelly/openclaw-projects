/**
 * Export REST API routes.
 * Part of Epic #2475, Issue #2478.
 *
 * Endpoints:
 *   POST   /namespaces/:ns/notes/:id/exports
 *   POST   /namespaces/:ns/notebooks/:id/exports
 *   GET    /namespaces/:ns/exports/:export_id
 *   GET    /namespaces/:ns/exports
 *   DELETE /namespaces/:ns/exports/:export_id
 */

import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { getAuthIdentity } from '../auth/middleware.ts';
import type { FileStorage } from '../file-storage/types.ts';
import type { ExportFormat, ExportOptions } from './types.ts';
import {
  createExportJob,
  getExportById,
  runExportJob,
} from './service.ts';

/** Sync threshold: notes under this size are exported synchronously (default 50KB) */
const EXPORT_SYNC_THRESHOLD_BYTES = parseInt(
  process.env.EXPORT_SYNC_THRESHOLD_BYTES || '51200',
  10,
);

/** Rate limit: max export requests per user per minute (default 10) */
const EXPORT_RATE_LIMIT_PER_MINUTE = parseInt(
  process.env.EXPORT_RATE_LIMIT_PER_MINUTE || '10',
  10,
);

/** Agent export timeout: max wait for sync generation in seconds (default 30) */
const AGENT_EXPORT_TIMEOUT_SECONDS = parseInt(
  process.env.AGENT_EXPORT_TIMEOUT_SECONDS || '30',
  10,
);

/** Presigned URL TTL in seconds (default 1 hour) */
const EXPORT_PRESIGNED_URL_TTL = parseInt(
  process.env.EXPORT_PRESIGNED_URL_TTL_SECONDS || '3600',
  10,
);

const VALID_FORMATS: ReadonlySet<string> = new Set(['pdf', 'docx', 'odf']);
const VALID_PAGE_SIZES: ReadonlySet<string> = new Set(['A4', 'Letter']);

/** In-memory per-user rate limiter (minute window) */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userEmail: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userEmail);

  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(userEmail, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (bucket.count >= EXPORT_RATE_LIMIT_PER_MINUTE) {
    return false;
  }

  bucket.count++;
  return true;
}

/** Validate and parse export request body */
function parseExportBody(
  body: unknown,
): { format: ExportFormat; options: ExportOptions } | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;
  const format = obj.format;

  if (typeof format !== 'string' || !VALID_FORMATS.has(format)) {
    return { error: `format must be one of: pdf, docx, odf` };
  }

  const options: ExportOptions = {};

  if (obj.options && typeof obj.options === 'object') {
    const opts = obj.options as Record<string, unknown>;

    if (opts.page_size !== undefined) {
      if (typeof opts.page_size !== 'string' || !VALID_PAGE_SIZES.has(opts.page_size)) {
        return { error: `page_size must be one of: A4, Letter` };
      }
      options.page_size = opts.page_size as ExportOptions['page_size'];
    }

    if (opts.include_metadata !== undefined) {
      // Accept include_metadata as a boolean alias for include_toc
      if (typeof opts.include_metadata !== 'boolean') {
        return { error: 'include_metadata must be a boolean' };
      }
      options.include_toc = opts.include_metadata;
    }
  }

  return { format: format as ExportFormat, options };
}

/** Verify user has access to the namespace (optionally require readwrite) */
async function verifyNamespaceAccess(
  pool: Pool,
  email: string,
  namespace: string,
  identityType: 'user' | 'm2m',
  requireWrite = false,
): Promise<boolean> {
  if (identityType === 'm2m') return true;

  const query = requireWrite
    ? `SELECT 1 FROM namespace_grant WHERE email = $1 AND namespace = $2 AND access = 'readwrite'`
    : `SELECT 1 FROM namespace_grant WHERE email = $1 AND namespace = $2`;
  const result = await pool.query(query, [email, namespace]);
  return result.rows.length > 0;
}

/** Verify a note exists in the given namespace */
async function verifyNoteExists(
  pool: Pool,
  noteId: string,
  namespace: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM note WHERE id = $1 AND namespace = $2 AND deleted_at IS NULL`,
    [noteId, namespace],
  );
  return result.rows.length > 0;
}

/** Verify a notebook exists in the given namespace */
async function verifyNotebookExists(
  pool: Pool,
  notebookId: string,
  namespace: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM notebook WHERE id = $1 AND namespace = $2`,
    [notebookId, namespace],
  );
  return result.rows.length > 0;
}

/** Get content size for a note (for sync/async decision) */
async function getNoteContentSize(
  pool: Pool,
  noteId: string,
  namespace: string,
): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(LENGTH(content), 0) AS size FROM note WHERE id = $1 AND namespace = $2`,
    [noteId, namespace],
  );
  if (result.rows.length === 0) return 0;
  return Number(result.rows[0].size);
}

/** Format an export record for API response (without download_url) */
function formatExportResponse(exp: {
  id: string;
  status: string;
  format: string;
  source_type: string;
  source_id: string;
  original_filename: string | null;
  size_bytes: number | null;
  error_message: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: exp.id,
    status: exp.status,
    format: exp.format,
    source_type: exp.source_type,
    source_id: exp.source_id,
    original_filename: exp.original_filename,
    size_bytes: exp.size_bytes,
    error_message: exp.error_message,
    expires_at: exp.expires_at.toISOString(),
    created_at: exp.created_at.toISOString(),
    updated_at: exp.updated_at.toISOString(),
  };
}

interface ExportRoutesOptions {
  pool: Pool;
  getStorage: () => FileStorage | null;
}

/**
 * Fastify plugin for export routes.
 * All routes are prefixed with /namespaces/:ns.
 */
export async function exportRoutesPlugin(
  app: FastifyInstance,
  opts: ExportRoutesOptions,
): Promise<void> {
  const { pool, getStorage } = opts;

  /** Get storage, returning 503 if unavailable */
  function requireStorage(reply: { code: (n: number) => { send: (b: unknown) => unknown } }): FileStorage | null {
    const storage = getStorage();
    if (!storage) {
      reply.code(503).send({ error: 'File storage is not configured' });
      return null;
    }
    return storage;
  }

  // ── POST /namespaces/:ns/notes/:id/exports ──────────────────────
  app.post('/namespaces/:ns/notes/:id/exports', async (req, reply) => {
    const storage = requireStorage(reply);
    if (!storage) return;

    const identity = await getAuthIdentity(req);
    if (!identity) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const params = req.params as { ns: string; id: string };

    // Namespace access check (write required for export creation)
    const hasAccess = await verifyNamespaceAccess(pool, identity.email, params.ns, identity.type, true);
    if (!hasAccess) {
      return reply.code(403).send({ error: 'No access to namespace' });
    }

    // Rate limit
    if (!checkRateLimit(identity.email)) {
      return reply.code(429).send({ error: 'Too many export requests. Try again in a minute.' });
    }

    // Validate body
    const parsed = parseExportBody(req.body);
    if ('error' in parsed) {
      return reply.code(422).send({ error: parsed.error });
    }

    // Verify note exists
    const noteExists = await verifyNoteExists(pool, params.id, params.ns);
    if (!noteExists) {
      return reply.code(404).send({ error: 'Note not found' });
    }

    // Create export job
    const exportJob = await createExportJob(pool, {
      namespace: params.ns,
      requested_by: identity.email,
      source_type: 'note',
      source_id: params.id,
      format: parsed.format,
      options: parsed.options,
    });

    // Sync or async based on content size
    const contentSize = await getNoteContentSize(pool, params.id, params.ns);

    if (contentSize <= EXPORT_SYNC_THRESHOLD_BYTES) {
      // Synchronous: run export inline and return ready result
      try {
        await runExportJob(pool, storage, exportJob.id);
        const updated = await getExportById(pool, exportJob.id);
        if (updated && updated.status === 'ready' && updated.storage_key) {
          const downloadUrl = await storage.getExternalSignedUrl(
            updated.storage_key,
            EXPORT_PRESIGNED_URL_TTL,
          );
          return reply.code(200).send({
            ...formatExportResponse(updated),
            download_url: downloadUrl,
          });
        }
      } catch {
        // Sync generation failed — fall through to return 202 (async fallback)
      }
    }

    // Async: return 202 with poll URL
    return reply.code(202).send({
      ...formatExportResponse(exportJob),
      poll_url: `/api/namespaces/${params.ns}/exports/${exportJob.id}`,
    });
  });

  // ── POST /namespaces/:ns/notebooks/:id/exports ──────────────────
  app.post('/namespaces/:ns/notebooks/:id/exports', async (req, reply) => {
    const storage = requireStorage(reply);
    if (!storage) return;

    const identity = await getAuthIdentity(req);
    if (!identity) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const params = req.params as { ns: string; id: string };

    const hasAccess = await verifyNamespaceAccess(pool, identity.email, params.ns, identity.type, true);
    if (!hasAccess) {
      return reply.code(403).send({ error: 'No access to namespace' });
    }

    if (!checkRateLimit(identity.email)) {
      return reply.code(429).send({ error: 'Too many export requests. Try again in a minute.' });
    }

    const parsed = parseExportBody(req.body);
    if ('error' in parsed) {
      return reply.code(422).send({ error: parsed.error });
    }

    const notebookExists = await verifyNotebookExists(pool, params.id, params.ns);
    if (!notebookExists) {
      return reply.code(404).send({ error: 'Notebook not found' });
    }

    // Notebooks always async
    const exportJob = await createExportJob(pool, {
      namespace: params.ns,
      requested_by: identity.email,
      source_type: 'notebook',
      source_id: params.id,
      format: parsed.format,
      options: parsed.options,
    });

    return reply.code(202).send({
      ...formatExportResponse(exportJob),
      poll_url: `/api/namespaces/${params.ns}/exports/${exportJob.id}`,
    });
  });

  // ── GET /namespaces/:ns/exports/:export_id ──────────────────────
  app.get('/namespaces/:ns/exports/:export_id', async (req, reply) => {
    const storage = requireStorage(reply);
    if (!storage) return;

    const identity = await getAuthIdentity(req);
    if (!identity) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const params = req.params as { ns: string; export_id: string };

    const hasAccess = await verifyNamespaceAccess(pool, identity.email, params.ns, identity.type);
    if (!hasAccess) {
      return reply.code(403).send({ error: 'No access to namespace' });
    }

    const exportRow = await getExportById(pool, params.export_id);
    if (!exportRow || exportRow.namespace !== params.ns) {
      return reply.code(404).send({ error: 'Export not found' });
    }

    // Ownership check for user tokens
    if (identity.type === 'user' && exportRow.requested_by !== identity.email) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Expired exports return 410 (check both status and expires_at to catch
    // exports that expired between cron runs)
    if (exportRow.status === 'expired' || exportRow.expires_at < new Date()) {
      return reply.code(410).send({ error: 'Export has expired' });
    }

    const response = formatExportResponse(exportRow);

    // Include download_url for ready exports (regenerated on each GET)
    // Cap the presigned URL TTL so it doesn't outlive expires_at
    if (exportRow.status === 'ready' && exportRow.storage_key) {
      const secsUntilExpiry = Math.max(0, Math.floor((exportRow.expires_at.getTime() - Date.now()) / 1000));
      const urlTtl = Math.min(EXPORT_PRESIGNED_URL_TTL, secsUntilExpiry);
      if (urlTtl <= 0) {
        return reply.code(410).send({ error: 'Export has expired' });
      }
      const downloadUrl = await storage.getExternalSignedUrl(
        exportRow.storage_key,
        urlTtl,
      );
      return reply.send({ ...response, download_url: downloadUrl });
    }

    return reply.send(response);
  });

  // ── GET /namespaces/:ns/exports ─────────────────────────────────
  app.get('/namespaces/:ns/exports', async (req, reply) => {
    const identity = await getAuthIdentity(req);
    if (!identity) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const params = req.params as { ns: string };

    const hasAccess = await verifyNamespaceAccess(pool, identity.email, params.ns, identity.type);
    if (!hasAccess) {
      return reply.code(403).send({ error: 'No access to namespace' });
    }

    const query = req.query as {
      status?: string;
      limit?: string;
      offset?: string;
    };

    const limit = Math.min(Math.max(parseInt(query.limit || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);

    // Build query
    const conditions: string[] = ['namespace = $1'];
    const queryParams: unknown[] = [params.ns];

    // User tokens only see their own exports
    if (identity.type === 'user') {
      conditions.push(`requested_by = $${queryParams.length + 1}`);
      queryParams.push(identity.email);
    }

    if (query.status && ['pending', 'generating', 'ready', 'failed', 'expired'].includes(query.status)) {
      conditions.push(`status = $${queryParams.length + 1}`);
      queryParams.push(query.status);
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM note_export WHERE ${whereClause}`,
      queryParams,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await pool.query(
      `SELECT * FROM note_export
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
      [...queryParams, limit, offset],
    );

    const exports = result.rows.map((row: Record<string, unknown>) => {
      // Reuse mapRow logic inline to avoid circular imports
      return formatExportResponse({
        id: row.id as string,
        status: row.status as string,
        format: row.format as string,
        source_type: row.source_type as string,
        source_id: row.source_id as string,
        original_filename: row.original_filename as string | null,
        size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
        error_message: row.error_message as string | null,
        expires_at: new Date(row.expires_at as string),
        created_at: new Date(row.created_at as string),
        updated_at: new Date(row.updated_at as string),
      });
    });

    return reply.send({ exports, total, limit, offset });
  });

  // ── DELETE /namespaces/:ns/exports/:export_id ───────────────────
  app.delete('/namespaces/:ns/exports/:export_id', async (req, reply) => {
    const storage = requireStorage(reply);
    if (!storage) return;

    const identity = await getAuthIdentity(req);
    if (!identity) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const params = req.params as { ns: string; export_id: string };

    const hasAccess = await verifyNamespaceAccess(pool, identity.email, params.ns, identity.type, true);
    if (!hasAccess) {
      return reply.code(403).send({ error: 'No access to namespace' });
    }

    const exportRow = await getExportById(pool, params.export_id);
    if (!exportRow || exportRow.namespace !== params.ns) {
      return reply.code(404).send({ error: 'Export not found' });
    }

    // Ownership check
    if (identity.type === 'user' && exportRow.requested_by !== identity.email) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Delete S3 object if present — fail the request if deletion fails
    // to prevent orphaned objects in storage
    if (exportRow.storage_key) {
      try {
        await storage.delete(exportRow.storage_key);
      } catch (err) {
        return reply.code(500).send({ error: 'Failed to delete export file from storage' });
      }
    }

    // Delete DB record
    await pool.query(`DELETE FROM note_export WHERE id = $1`, [params.export_id]);

    return reply.code(204).send();
  });
}
