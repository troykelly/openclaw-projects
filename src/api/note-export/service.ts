/**
 * Export orchestration service.
 * Part of Epic #2475, Issue #2477.
 *
 * Manages the full export lifecycle: job creation, document generation,
 * S3 upload, and status tracking.
 */

import type { Pool } from 'pg';
import type { FileStorage } from '../file-storage/types.ts';
import type {
  NoteExport,
  CreateExportParams,
  ExportFormat,
  ExportOptions,
  ExportSourceType,
} from './types.ts';
import { generatePdf } from './generators/pdf.ts';
import { generateDocx } from './generators/docx.ts';
import { generateOdf } from './generators/odf.ts';
import { serialiseToHtml, serialiseToMarkdown } from './lexical-serialiser.ts';

/** Max retries before permanent failure (configurable via env) */
const EXPORT_MAX_RETRIES = parseInt(process.env.EXPORT_MAX_RETRIES || '3', 10);

/** Max content size in bytes (default 10MB) */
const EXPORT_MAX_CONTENT_BYTES = parseInt(process.env.EXPORT_MAX_CONTENT_BYTES || '10485760', 10);

/** Presigned URL TTL in seconds (default 1 hour) */
const EXPORT_PRESIGNED_URL_TTL = parseInt(process.env.EXPORT_PRESIGNED_URL_TTL_SECONDS || '3600', 10);

/** Content type mapping for export formats */
const FORMAT_CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odf: 'application/vnd.oasis.opendocument.text',
};

/** File extension mapping */
const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  pdf: 'pdf',
  docx: 'docx',
  odf: 'odt',
};

/** Maps a database row to a NoteExport object */
function mapRow(row: Record<string, unknown>): NoteExport {
  return {
    id: row.id as string,
    namespace: row.namespace as string,
    requested_by: row.requested_by as string,
    source_type: row.source_type as ExportSourceType,
    source_id: row.source_id as string,
    format: row.format as ExportFormat,
    options: (row.options as ExportOptions) ?? {},
    status: row.status as NoteExport['status'],
    error_message: row.error_message as string | null,
    storage_key: row.storage_key as string | null,
    original_filename: row.original_filename as string | null,
    size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    attempt_count: Number(row.attempt_count ?? 0),
    started_at: row.started_at ? new Date(row.started_at as string) : null,
    expires_at: new Date(row.expires_at as string),
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

/**
 * Creates a new export job in pending state.
 * Also inserts an internal_job record for the worker to pick up.
 */
export async function createExportJob(
  pool: Pool,
  params: CreateExportParams,
): Promise<NoteExport> {
  const result = await pool.query(
    `INSERT INTO note_export (namespace, requested_by, source_type, source_id, format, options)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.namespace,
      params.requested_by,
      params.source_type,
      params.source_id,
      params.format,
      JSON.stringify(params.options ?? {}),
    ],
  );

  const exportRow = mapRow(result.rows[0]);

  // Enqueue internal_job for worker pickup
  await pool.query(
    `INSERT INTO internal_job (kind, payload, run_at)
     VALUES ('export.generate', $1, NOW())`,
    [JSON.stringify({ export_id: exportRow.id })],
  );

  // Notify worker immediately
  await pool.query(`NOTIFY internal_job_ready`);

  return exportRow;
}

/**
 * Fetches a single note_export row by ID.
 */
export async function getExportById(
  pool: Pool,
  exportId: string,
): Promise<NoteExport | null> {
  const result = await pool.query(
    `SELECT * FROM note_export WHERE id = $1`,
    [exportId],
  );

  if (result.rowCount === 0) return null;
  return mapRow(result.rows[0]);
}

/**
 * Runs the full export generation pipeline for a single job.
 *
 * 1. Set status → generating
 * 2. Fetch note/notebook content
 * 3. Serialise to HTML or markdown
 * 4. Run generator
 * 5. Upload to S3
 * 6. Set status → ready
 */
export async function runExportJob(
  pool: Pool,
  storage: FileStorage,
  exportId: string,
): Promise<void> {
  // Fetch the export record
  const exportRow = await getExportById(pool, exportId);
  if (!exportRow) {
    throw new Error(`Export ${exportId} not found`);
  }

  // Check retry limit
  if (exportRow.attempt_count >= EXPORT_MAX_RETRIES) {
    await pool.query(
      `UPDATE note_export SET status = 'failed', error_message = $2 WHERE id = $1`,
      [exportId, `Exceeded maximum retry count (${EXPORT_MAX_RETRIES})`],
    );
    return;
  }

  // Transition to generating
  await pool.query(
    `UPDATE note_export
     SET status = 'generating', started_at = NOW(), attempt_count = attempt_count + 1
     WHERE id = $1`,
    [exportId],
  );

  try {
    // Fetch content based on source type
    const { content, title } = await fetchContent(pool, exportRow);

    // Check content size
    const contentBytes = Buffer.byteLength(content, 'utf-8');
    if (contentBytes > EXPORT_MAX_CONTENT_BYTES) {
      throw new Error(
        `Content size (${contentBytes} bytes) exceeds maximum (${EXPORT_MAX_CONTENT_BYTES} bytes)`,
      );
    }

    // Generate document
    const buffer = await generateDocument(exportRow.format, content, title, exportRow.options);

    // Build S3 key using opaque UUID (not derived from user input)
    const ext = FORMAT_EXTENSIONS[exportRow.format];
    const storageKey = `exports/${exportRow.namespace}/${exportRow.source_type}/${exportRow.source_id}/${exportRow.id}.${ext}`;

    // Upload to S3
    const contentType = FORMAT_CONTENT_TYPES[exportRow.format];
    await storage.upload(storageKey, buffer, contentType);

    // Build original filename
    const safeTitle = (title || 'export').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
    const originalFilename = `${safeTitle}.${ext}`;

    // Update record to ready
    await pool.query(
      `UPDATE note_export
       SET status = 'ready',
           storage_key = $2,
           original_filename = $3,
           size_bytes = $4
       WHERE id = $1`,
      [exportId, storageKey, originalFilename, buffer.length],
    );
  } catch (error) {
    const err = error as Error;
    console.error(`[Export] Failed to generate export ${exportId}:`, err.message);

    await pool.query(
      `UPDATE note_export SET status = 'failed', error_message = $2 WHERE id = $1`,
      [exportId, err.message.slice(0, 2000)],
    );

    throw err; // Re-throw so the worker marks the internal_job as failed
  }
}

/**
 * Fetches content for a note or notebook.
 */
async function fetchContent(
  pool: Pool,
  exportRow: NoteExport,
): Promise<{ content: string; title: string }> {
  if (exportRow.source_type === 'note') {
    const result = await pool.query(
      `SELECT title, content FROM note
       WHERE id = $1 AND namespace = $2 AND deleted_at IS NULL`,
      [exportRow.source_id, exportRow.namespace],
    );

    if (result.rowCount === 0) {
      throw new Error(`Note ${exportRow.source_id} not found in namespace ${exportRow.namespace}`);
    }

    return {
      content: result.rows[0].content || '',
      title: result.rows[0].title || 'Untitled',
    };
  }

  // Notebook: fetch all notes in order
  const notesResult = await pool.query(
    `SELECT n.title, n.content
     FROM note n
     WHERE n.notebook_id = $1
       AND n.namespace = $2
       AND n.deleted_at IS NULL
     ORDER BY n.sort_order ASC, n.created_at ASC`,
    [exportRow.source_id, exportRow.namespace],
  );

  const notebookResult = await pool.query(
    `SELECT name FROM notebook WHERE id = $1 AND namespace = $2`,
    [exportRow.source_id, exportRow.namespace],
  );

  if (notebookResult.rowCount === 0) {
    throw new Error(`Notebook ${exportRow.source_id} not found in namespace ${exportRow.namespace}`);
  }

  const notebookTitle = notebookResult.rows[0].name || 'Untitled Notebook';

  if (notesResult.rowCount === 0) {
    return { content: '', title: notebookTitle };
  }

  // Combine notes with separators
  const combined = (notesResult.rows as Array<{ title: string; content: string }>)
    .map((note) => `# ${note.title || 'Untitled'}\n\n${note.content || ''}`)
    .join('\n\n---\n\n');

  return { content: combined, title: notebookTitle };
}

/**
 * Generates a document buffer using the appropriate format generator.
 */
async function generateDocument(
  format: ExportFormat,
  content: string,
  title: string,
  options: ExportOptions,
): Promise<Buffer> {
  switch (format) {
    case 'pdf': {
      const html = await serialiseToHtml(content);
      return generatePdf({
        html,
        options: {
          page_size: options.page_size,
          margin: options.margin,
        },
      });
    }

    case 'docx': {
      const markdown = await serialiseToMarkdown(content);
      return generateDocx({
        markdown,
        metadata: { title },
      });
    }

    case 'odf': {
      const markdown = await serialiseToMarkdown(content);
      return generateOdf({ markdown });
    }

    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * Gets a presigned download URL for a completed export.
 * Validates ownership (requested_by must match user_email).
 */
export async function getDownloadUrl(
  pool: Pool,
  storage: FileStorage,
  exportId: string,
  userEmail: string,
): Promise<string> {
  const result = await pool.query(
    `SELECT * FROM note_export WHERE id = $1`,
    [exportId],
  );

  if (result.rowCount === 0) {
    throw new Error(`Export ${exportId} not found`);
  }

  const exportRow = mapRow(result.rows[0]);

  // Ownership check
  if (exportRow.requested_by !== userEmail) {
    throw new Error(`Access denied: export ${exportId} belongs to another user`);
  }

  if (exportRow.status !== 'ready' || !exportRow.storage_key) {
    throw new Error(`Export ${exportId} is not ready for download (status: ${exportRow.status})`);
  }

  return storage.getExternalSignedUrl(exportRow.storage_key, EXPORT_PRESIGNED_URL_TTL);
}

/**
 * Gets a presigned download URL for agent access (no ownership check).
 * The calling API layer must validate the agent has namespace access.
 */
export async function getAgentPresignedUrl(
  pool: Pool,
  storage: FileStorage,
  exportId: string,
): Promise<string> {
  const result = await pool.query(
    `SELECT * FROM note_export WHERE id = $1`,
    [exportId],
  );

  if (result.rowCount === 0) {
    throw new Error(`Export ${exportId} not found`);
  }

  const exportRow = mapRow(result.rows[0]);

  if (exportRow.status !== 'ready' || !exportRow.storage_key) {
    throw new Error(`Export ${exportId} is not ready for download (status: ${exportRow.status})`);
  }

  return storage.getExternalSignedUrl(exportRow.storage_key, EXPORT_PRESIGNED_URL_TTL);
}

/**
 * Marks expired exports and deletes their S3 objects.
 * Returns the count of exports expired.
 */
export async function expireExports(
  pool: Pool,
  storage: FileStorage,
): Promise<number> {
  // Find ready exports past their expiry
  const result = await pool.query(
    `SELECT id, storage_key FROM note_export
     WHERE expires_at < NOW() AND status NOT IN ('failed', 'expired')`,
  );

  let count = 0;
  for (const row of result.rows) {
    const r = row as { id: string; storage_key: string | null };

    // Delete S3 object if exists
    if (r.storage_key) {
      try {
        await storage.delete(r.storage_key);
      } catch (err) {
        console.warn(`[Export] Failed to delete S3 object ${r.storage_key}:`, (err as Error).message);
      }
    }

    await pool.query(
      `UPDATE note_export SET status = 'expired' WHERE id = $1`,
      [r.id],
    );
    count++;
  }

  return count;
}
