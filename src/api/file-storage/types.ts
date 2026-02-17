/**
 * File storage types.
 * Part of Issue #215.
 *
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 */

/**
 * Configuration for S3-compatible storage
 */
export interface S3Config {
  endpoint?: string;
  external_endpoint?: string;
  bucket: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  force_path_style?: boolean;
}

/**
 * File storage interface for S3-compatible backends
 */
export interface FileStorage {
  upload(key: string, data: Buffer, content_type: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expires_in: number): Promise<string>;
  /** Get a signed URL using the external endpoint (for browser-facing presigned URLs). Falls back to internal client when no external endpoint is configured. */
  getExternalSignedUrl(key: string, expires_in: number): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * File attachment metadata stored in database
 */
export interface FileAttachment {
  id: string;
  storage_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256?: string;
  uploaded_by?: string;
  created_at: Date;
}

/**
 * Request to upload a file
 */
export interface UploadRequest {
  filename: string;
  content_type: string;
  data: Buffer;
  uploaded_by?: string;
}

/**
 * Response from file upload
 */
export interface UploadResponse {
  id: string;
  storage_key: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  created_at: Date;
}

/**
 * File size limits configuration
 */
export interface FileSizeLimits {
  max_file_size_bytes: number;
}

/**
 * Default file size limit (25MB)
 */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
