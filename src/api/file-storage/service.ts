/**
 * File storage service.
 * Part of Issue #215.
 */

import crypto from 'crypto';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type {
  FileStorage,
  FileAttachment,
  UploadRequest,
  UploadResponse,
} from './types.ts';
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
    public sizeBytes: number,
    public maxSizeBytes: number
  ) {
    super(
      `File size ${sizeBytes} bytes exceeds maximum allowed ${maxSizeBytes} bytes`
    );
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
  maxSizeBytes: number = DEFAULT_MAX_FILE_SIZE_BYTES
): Promise<UploadResponse> {
  // Check file size
  if (request.data.length > maxSizeBytes) {
    throw new FileTooLargeError(request.data.length, maxSizeBytes);
  }

  // Generate storage key and checksum
  const storageKey = generateStorageKey(request.filename);
  const checksum = calculateChecksum(request.data);

  // Upload to storage
  await storage.upload(storageKey, request.data, request.contentType);

  // Insert metadata into database
  const result = await pool.query(
    `INSERT INTO file_attachment (
      storage_key,
      original_filename,
      content_type,
      size_bytes,
      checksum_sha256,
      uploaded_by
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id::text, created_at`,
    [
      storageKey,
      request.filename,
      request.contentType,
      request.data.length,
      checksum,
      request.uploadedBy || null,
    ]
  );

  return {
    id: result.rows[0].id,
    storageKey,
    originalFilename: request.filename,
    contentType: request.contentType,
    sizeBytes: request.data.length,
    checksumSha256: checksum,
    createdAt: result.rows[0].created_at,
  };
}

/**
 * Get file metadata by ID
 */
export async function getFileMetadata(
  pool: Pool,
  fileId: string
): Promise<FileAttachment | null> {
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
    WHERE id = $1`,
    [fileId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: parseInt(row.size_bytes, 10),
    checksumSha256: row.checksum_sha256,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

/**
 * Download a file
 */
export async function downloadFile(
  pool: Pool,
  storage: FileStorage,
  fileId: string
): Promise<{ data: Buffer; metadata: FileAttachment }> {
  const metadata = await getFileMetadata(pool, fileId);

  if (!metadata) {
    throw new FileNotFoundError(fileId);
  }

  const data = await storage.download(metadata.storageKey);

  return { data, metadata };
}

/**
 * Get a signed URL for a file
 */
export async function getFileUrl(
  pool: Pool,
  storage: FileStorage,
  fileId: string,
  expiresIn: number = 3600
): Promise<{ url: string; metadata: FileAttachment }> {
  const metadata = await getFileMetadata(pool, fileId);

  if (!metadata) {
    throw new FileNotFoundError(fileId);
  }

  const url = await storage.getSignedUrl(metadata.storageKey, expiresIn);

  return { url, metadata };
}

/**
 * Delete a file
 */
export async function deleteFile(
  pool: Pool,
  storage: FileStorage,
  fileId: string
): Promise<boolean> {
  const metadata = await getFileMetadata(pool, fileId);

  if (!metadata) {
    return false;
  }

  // Delete from storage
  await storage.delete(metadata.storageKey);

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
    uploadedBy?: string;
  } = {}
): Promise<{ files: FileAttachment[]; total: number }> {
  const limit = Math.min(options.limit || 50, 500);
  const offset = options.offset || 0;

  const whereClause = options.uploadedBy
    ? 'WHERE uploaded_by = $3'
    : '';
  const params = options.uploadedBy
    ? [limit, offset, options.uploadedBy]
    : [limit, offset];

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
    params
  );

  const countParams = options.uploadedBy ? [options.uploadedBy] : [];
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM file_attachment ${whereClause ? 'WHERE uploaded_by = $1' : ''}`,
    countParams
  );

  return {
    files: result.rows.map((row) => ({
      id: row.id,
      storageKey: row.storage_key,
      originalFilename: row.original_filename,
      contentType: row.content_type,
      sizeBytes: parseInt(row.size_bytes, 10),
      checksumSha256: row.checksum_sha256,
      uploadedBy: row.uploaded_by,
      createdAt: row.created_at,
    })),
    total: parseInt(countResult.rows[0].count, 10),
  };
}
