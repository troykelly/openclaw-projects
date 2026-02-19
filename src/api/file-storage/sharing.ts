/**
 * File sharing service.
 * Part of Epic #574, Issue #584.
 *
 * Generates shareable download links for file attachments with time-limited access.
 *
 * Supports two modes controlled by FILE_SHARE_MODE environment variable:
 * - "presigned" (default): Generate S3 presigned URLs pointing directly to storage.
 *   Requires SeaweedFS to be externally accessible (e.g., via Traefik).
 * - "proxy": Use database-backed tokens and proxy downloads through the API.
 *   Keeps SeaweedFS internal but adds API load for file downloads.
 */

import type { Pool } from 'pg';
import type { FileStorage, FileAttachment } from './types.ts';
import { getFileMetadata, getFileUrl, FileNotFoundError } from './service.ts';

/**
 * File share mode
 * - presigned: Use S3 presigned URLs (default, requires external SeaweedFS access)
 * - proxy: Use database tokens and proxy through API
 */
export type FileShareMode = 'presigned' | 'proxy';

/**
 * Get the configured file share mode from environment
 */
export function getFileShareMode(): FileShareMode {
  const mode = process.env.FILE_SHARE_MODE?.toLowerCase();
  if (mode === 'proxy') {
    return 'proxy';
  }
  return 'presigned'; // default
}

/**
 * File share record
 */
export interface FileShare {
  id: string;
  file_attachment_id: string;
  share_token: string;
  expires_at: Date;
  download_count: number;
  max_downloads: number | null;
  created_by: string | null;
  created_at: Date;
  last_accessed_at: Date | null;
}

/**
 * Input for creating a file share
 */
export interface CreateFileShareInput {
  file_id: string;
  expires_in?: number; // seconds, default 3600 (1 hour)
  max_downloads?: number;
  created_by?: string;
  /** Namespace for data partitioning (Epic #1418) */
  namespace?: string;
}

/**
 * Result of creating a file share
 */
export interface FileShareResult {
  share_token: string;
  url: string;
  expires_at: Date;
  expires_in: number;
  filename: string;
  content_type: string;
  size_bytes: number;
}

/**
 * Result of validating a share token
 */
export interface ValidateShareTokenResult {
  file_attachment_id: string;
  is_valid: boolean;
  error_message: string | null;
}

/**
 * Error thrown when a share link is invalid or expired
 */
export class ShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareLinkError';
  }
}

/**
 * Sanitize filename for use in Content-Disposition header.
 * Removes control characters and escapes quotes/backslashes to prevent
 * header injection attacks (Issue #612).
 *
 * @param filename - The original filename to sanitize
 * @returns Sanitized filename safe for use in Content-Disposition header
 */
export function sanitizeFilenameForHeader(filename: string): string {
  return filename
    .replace(/[\r\n\x00-\x1f\x7f]/g, '') // Remove control characters (CR, LF, NUL, etc.)
    .replace(/["\\]/g, (c) => '\\' + c); // Escape quotes and backslashes
}

/**
 * Create a shareable download link for a file.
 *
 * The share mode is determined by FILE_SHARE_MODE environment variable:
 * - "presigned" (default): Returns an S3 presigned URL pointing to storage
 * - "proxy": Returns a token-based URL that proxies through the API
 */
export async function createFileShare(pool: Pool, storage: FileStorage, input: CreateFileShareInput): Promise<FileShareResult> {
  // Default expiry is 1 hour
  const expiresIn = input.expires_in ?? 3600;

  // Validate expires_in range (60 seconds to 7 days)
  if (expiresIn < 60 || expiresIn > 604800) {
    throw new Error('expires_in must be between 60 and 604800 seconds (1 minute to 7 days)');
  }

  // Get file metadata to verify it exists
  const metadata = await getFileMetadata(pool, input.file_id);
  if (!metadata) {
    throw new FileNotFoundError(input.file_id);
  }

  const mode = getFileShareMode();
  const expires_at = new Date(Date.now() + expiresIn * 1000);

  if (mode === 'presigned') {
    // Generate S3 presigned URL for external access.
    // getExternalSignedUrl uses a separate S3Client configured with the external
    // endpoint (when set) so that the Signature V4 Host header matches the
    // endpoint the browser actually hits. Falls back to the internal client
    // when no external endpoint is configured.
    const url = await storage.getExternalSignedUrl(metadata.storage_key, expiresIn);

    return {
      share_token: '', // No token for presigned URLs
      url,
      expires_at: expires_at,
      expires_in: expiresIn,
      filename: metadata.original_filename,
      content_type: metadata.content_type,
      size_bytes: metadata.size_bytes,
    };
  }

  // Option A (proxy mode): Use database-backed tokens
  // Generate share token
  const tokenResult = await pool.query('SELECT generate_share_token() as token');
  const shareToken = tokenResult.rows[0].token as string;

  // Insert share record
  await pool.query(
    `INSERT INTO file_share (
      file_attachment_id,
      share_token,
      expires_at,
      max_downloads,
      created_by,
      namespace
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.file_id, shareToken, expires_at, input.max_downloads ?? null, input.created_by ?? null, input.namespace ?? 'default'],
  );

  // Build the share URL
  const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const url = `${baseUrl}/api/files/shared/${shareToken}`;

  return {
    share_token: shareToken,
    url,
    expires_at: expires_at,
    expires_in: expiresIn,
    filename: metadata.original_filename,
    content_type: metadata.content_type,
    size_bytes: metadata.size_bytes,
  };
}

/**
 * Validate a share token and get the file attachment ID
 */
export async function validateShareToken(pool: Pool, token: string, incrementDownload: boolean = true): Promise<ValidateShareTokenResult> {
  const result = await pool.query('SELECT * FROM validate_file_share_token($1, $2)', [token, incrementDownload]);

  const row = result.rows[0];
  return {
    file_attachment_id: row.file_attachment_id,
    is_valid: row.is_valid,
    error_message: row.error_message,
  };
}

/**
 * Download a file via share token
 */
export async function downloadFileByShareToken(pool: Pool, storage: FileStorage, token: string): Promise<{ data: Buffer; metadata: FileAttachment }> {
  // Validate token (this increments download count)
  const validation = await validateShareToken(pool, token, true);

  if (!validation.is_valid) {
    throw new ShareLinkError(validation.error_message ?? 'Invalid share link');
  }

  // Get file metadata
  const metadata = await getFileMetadata(pool, validation.file_attachment_id);
  if (!metadata) {
    throw new FileNotFoundError(validation.file_attachment_id);
  }

  // Download from storage
  const data = await storage.download(metadata.storage_key);

  return { data, metadata };
}

/**
 * Revoke a file share by token
 */
export async function revokeFileShare(pool: Pool, token: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM file_share WHERE share_token = $1 RETURNING id', [token]);

  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * List active shares for a file
 */
export async function listFileShares(pool: Pool, fileId: string): Promise<FileShare[]> {
  const result = await pool.query(
    `SELECT
      id::text,
      file_attachment_id::text as file_attachment_id,
      share_token,
      expires_at,
      download_count,
      max_downloads,
      created_by,
      created_at,
      last_accessed_at
    FROM file_share
    WHERE file_attachment_id = $1
      AND expires_at > NOW()
    ORDER BY created_at DESC`,
    [fileId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    file_attachment_id: row.file_attachment_id,
    share_token: row.share_token,
    expires_at: new Date(row.expires_at),
    download_count: row.download_count,
    max_downloads: row.max_downloads,
    created_by: row.created_by,
    created_at: new Date(row.created_at),
    last_accessed_at: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
  }));
}
