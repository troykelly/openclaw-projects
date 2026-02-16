/**
 * File storage types.
 * Part of Issue #215.
 */

/**
 * Configuration for S3-compatible storage
 */
export interface S3Config {
  endpoint?: string;
  externalEndpoint?: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

/**
 * File storage interface for S3-compatible backends
 */
export interface FileStorage {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
  /** Get a signed URL using the external endpoint (for browser-facing presigned URLs). Falls back to internal client when no external endpoint is configured. */
  getExternalSignedUrl(key: string, expiresIn: number): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * File attachment metadata stored in database
 */
export interface FileAttachment {
  id: string;
  storageKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256?: string;
  uploadedBy?: string;
  createdAt: Date;
}

/**
 * Request to upload a file
 */
export interface UploadRequest {
  filename: string;
  contentType: string;
  data: Buffer;
  uploadedBy?: string;
}

/**
 * Response from file upload
 */
export interface UploadResponse {
  id: string;
  storageKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  createdAt: Date;
}

/**
 * File size limits configuration
 */
export interface FileSizeLimits {
  maxFileSizeBytes: number;
}

/**
 * Default file size limit (25MB)
 */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
