/**
 * File/Drive browsing service for OneDrive and Google Drive.
 * Part of Issue #1049.
 *
 * Orchestrates file operations across providers:
 * - Token validation and refresh
 * - Provider dispatch (Microsoft vs Google)
 * - Permission checks (feature enabled, access level)
 * - Response normalization to DriveFile interface
 */

import type { Pool } from 'pg';
import type { OAuthProvider, OAuthConnection } from './types.ts';
import { OAuthError, NoConnectionError } from './types.ts';
import { getConnection, getValidAccessToken } from './service.ts';
import * as microsoft from './microsoft.ts';
import * as google from './google.ts';

/** Normalized file/folder representation across providers. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  createdAt?: Date;
  modifiedAt?: Date;
  path?: string;
  parentId?: string;
  webUrl?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  isFolder: boolean;
  provider: OAuthProvider;
  connectionId: string;
  metadata: Record<string, unknown>;
}

/** Paginated result from a file listing or search operation. */
export interface DriveListResult {
  files: DriveFile[];
  nextPageToken?: string;
  totalCount?: number;
}

/**
 * Validate that a connection has files enabled and is active.
 * Throws OAuthError with 403 if files feature is not enabled.
 */
function assertFilesEnabled(connection: OAuthConnection): void {
  if (!connection.isActive) {
    throw new OAuthError(
      'OAuth connection is disabled',
      'CONNECTION_DISABLED',
      connection.provider,
      403,
    );
  }
  if (!connection.enabledFeatures.includes('files')) {
    throw new OAuthError(
      'Files feature is not enabled for this connection',
      'FILES_NOT_ENABLED',
      connection.provider,
      403,
    );
  }
}

/**
 * Resolve a connection and get a valid access token.
 * Validates that the connection exists, is active, and has files enabled.
 */
async function resolveConnection(
  pool: Pool,
  connectionId: string,
): Promise<{ connection: OAuthConnection; accessToken: string }> {
  const connection = await getConnection(pool, connectionId);
  if (!connection) {
    throw new NoConnectionError(connectionId);
  }
  assertFilesEnabled(connection);
  const accessToken = await getValidAccessToken(pool, connectionId);
  return { connection, accessToken };
}

/**
 * List files in a folder (or root) for a given connection.
 *
 * @param pool - Database pool for connection lookup and token refresh
 * @param connectionId - UUID of the OAuth connection
 * @param folderId - Optional folder ID; omit for root listing
 * @param pageToken - Optional pagination token from a previous result
 */
export async function listFiles(
  pool: Pool,
  connectionId: string,
  folderId?: string,
  pageToken?: string,
): Promise<DriveListResult> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);

  switch (connection.provider) {
    case 'microsoft':
      return microsoft.listDriveItems(accessToken, connectionId, folderId, pageToken);
    case 'google':
      return google.listDriveFiles(accessToken, connectionId, folderId, pageToken);
    default:
      throw new OAuthError(
        `Unsupported provider for files: ${connection.provider}`,
        'UNSUPPORTED_PROVIDER',
        connection.provider,
      );
  }
}

/**
 * Search files across a connected drive.
 *
 * @param pool - Database pool for connection lookup and token refresh
 * @param connectionId - UUID of the OAuth connection
 * @param query - Search query string
 * @param pageToken - Optional pagination token from a previous result
 */
export async function searchFiles(
  pool: Pool,
  connectionId: string,
  query: string,
  pageToken?: string,
): Promise<DriveListResult> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);

  switch (connection.provider) {
    case 'microsoft':
      return microsoft.searchDriveItems(accessToken, connectionId, query, pageToken);
    case 'google':
      return google.searchDriveFiles(accessToken, connectionId, query, pageToken);
    default:
      throw new OAuthError(
        `Unsupported provider for files: ${connection.provider}`,
        'UNSUPPORTED_PROVIDER',
        connection.provider,
      );
  }
}

/**
 * Get metadata for a single file, including download URL.
 *
 * @param pool - Database pool for connection lookup and token refresh
 * @param connectionId - UUID of the OAuth connection
 * @param fileId - Provider-specific file/item ID
 */
export async function getFile(
  pool: Pool,
  connectionId: string,
  fileId: string,
): Promise<DriveFile> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);

  switch (connection.provider) {
    case 'microsoft':
      return microsoft.getDriveItem(accessToken, connectionId, fileId);
    case 'google':
      return google.getDriveFile(accessToken, connectionId, fileId);
    default:
      throw new OAuthError(
        `Unsupported provider for files: ${connection.provider}`,
        'UNSUPPORTED_PROVIDER',
        connection.provider,
      );
  }
}
