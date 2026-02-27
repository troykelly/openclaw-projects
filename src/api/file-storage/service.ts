/**
 * File storage service.
 * Part of Issue #215.
 */

import crypto from 'crypto';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type { FileStorage, FileAttachment, UploadRequest, UploadResponse } from './types.ts';
import { DEFAULT_MAX_FILE_SIZE_BYTES } from './types.ts';

/**
 * Generate a storage key for a file
 */
export function generateStorageKey(filename: string): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const uuid = randomUUID();
  const ext = filename.includes('.') ? filename.split('.').pop() : '';

  return `${year}/${month}/${day}/${uuid}${ext ? '.' + ext : ''}`;
}

/**
 * Calculate SHA256 checksum of data
 */
export function calculateChecksum(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * File too large error
 */
export class FileTooLargeError extends Error {
  constructor(
    public size_bytes: number,
    public max_size_bytes: number,
  ) {
    super(`File size ${size_bytes} bytes exceeds maximum allowed ${max_size_bytes} bytes`);
    this.name = 'FileTooLargeError';
  }
}

/**
 * File not found error
 */
export class FileNotFoundError extends Error {
  constructor(public fileId: string) {
    super(`File not found: ${fileId}`);
    this.name = 'FileNotFoundError';
  }
}

/**
 * Upload a file
 */
export async function uploadFile(
  pool: Pool,
  storage: FileStorage,
  request: UploadRequest,
  max_size_bytes: number = DEFAULT_MAX_FILE_SIZE_BYTES,
): Promise<UploadResponse> {
  // Check file size
  if (request.data.length > max_size_bytes) {
    throw new FileTooLargeError(request.data.length, max_size_bytes);
  }

  // Generate storage key and checksum
  const storage_key = generateStorageKey(request.filename);
  const checksum = calculateChecksum(request.data);

  // Upload to storage
  await storage.upload(storage_key, request.data, request.content_type);

  // Insert metadata into database
  const result = await pool.query(
    `INSERT INTO file_attachment (
      storage_key,
      original_filename,
      content_type,
      size_bytes,
      checksum_sha256,
      uploaded_by,
      namespace
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id::text, created_at`,
    [storage_key, request.filename, request.content_type, request.data.length, checksum, request.uploaded_by || null, request.namespace ?? 'default'],
  );

  return {
    id: result.rows[0].id,
    storage_key,
    original_filename: request.filename,
    content_type: request.content_type,
    size_bytes: request.data.length,
    checksum_sha256: checksum,
    created_at: result.rows[0].created_at,
  };
}

/**
 * Get file metadata by ID
 */
export async function getFileMetadata(pool: Pool, fileId: string): Promise<FileAttachment | null> {
  const result = await pool.query(
    `SELECT
      id::text,
      storage_key,
      original_filename,
      content_type,
      size_bytes,
      checksum_sha256,
      uploaded_by,
      namespace,
      created_at
    FROM file_attachment
    WHERE id = $1`,
    [fileId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    storage_key: row.storage_key,
    original_filename: row.original_filename,
    content_type: row.content_type,
    size_bytes: parseInt(row.size_bytes, 10),
    checksum_sha256: row.checksum_sha256,
    uploaded_by: row.uploaded_by,
    namespace: row.namespace,
    created_at: row.created_at,
  };
}

/**
 * Download a file
 */
export async function downloadFile(pool: Pool, storage: FileStorage, fileId: string): Promise<{ data: Buffer; metadata: FileAttachment }> {
  const metadata = await getFileMetadata(pool, fileId);

  if (!metadata) {
    throw new FileNotFoundError(fileId);
  }

  const data = await storage.download(metadata.storage_key);

  return { data, metadata };
}

/**
 * Get a signed URL for a file
 */
export async function getFileUrl(
  pool: Pool,
  storage: FileStorage,
  fileId: string,
  expiresIn: number = 3600,
): Promise<{ url: string; metadata: FileAttachment }> {
  const metadata = await getFileMetadata(pool, fileId);

  if (!metadata) {
    throw new FileNotFoundError(fileId);
  }

  const url = await storage.getSignedUrl(metadata.storage_key, expiresIn);

  return { url, metadata };
}

/**
 * Delete a file
 */
export async function deleteFile(pool: Pool, storage: FileStorage, fileId: string): Promise<boolean> {
  const metadata = await getFileMetadata(pool, fileId);

  if (!metadata) {
    return false;
  }

  // Delete from storage
  await storage.delete(metadata.storage_key);

  // Delete metadata from database
  await pool.query(`DELETE FROM file_attachment WHERE id = $1`, [fileId]);

  return true;
}

/**
 * List files with pagination
 */
export async function listFiles(
  pool: Pool,
  options: {
    limit?: number;
    offset?: number;
    uploaded_by?: string;
  } = {},
): Promise<{ files: FileAttachment[]; total: number }> {
  const limit = Math.min(options.limit || 50, 500);
  const offset = options.offset || 0;

  const whereClause = options.uploaded_by ? 'WHERE uploaded_by = $3' : '';
  const params = options.uploaded_by ? [limit, offset, options.uploaded_by] : [limit, offset];

  const result = await pool.query(
    `SELECT
      id::text,
      storage_key,
      original_filename,
      content_type,
      size_bytes,
      checksum_sha256,
      uploaded_by,
      created_at
    FROM file_attachment
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2`,
    params,
  );

  const countParams = options.uploaded_by ? [options.uploaded_by] : [];
  const countResult = await pool.query(`SELECT COUNT(*) FROM file_attachment ${whereClause ? 'WHERE uploaded_by = $1' : ''}`, countParams);

  return {
    files: result.rows.map((row) => ({
      id: row.id,
      storage_key: row.storage_key,
      original_filename: row.original_filename,
      content_type: row.content_type,
      size_bytes: parseInt(row.size_bytes, 10),
      checksum_sha256: row.checksum_sha256,
      uploaded_by: row.uploaded_by,
      created_at: row.created_at,
    })),
    total: parseInt(countResult.rows[0].count, 10),
  };
}
