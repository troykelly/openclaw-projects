/**
 * File/Drive browsing service for OneDrive and Google Drive.
 * Part of Issue #1049.
 * All property names use snake_case to match the project-wide convention (Issue #1412).
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
  mime_type: string;
  size?: number;
  created_at?: Date;
  modified_at?: Date;
  path?: string;
  parent_id?: string;
  web_url?: string;
  download_url?: string;
  thumbnail_url?: string;
  is_folder: boolean;
  provider: OAuthProvider;
  connection_id: string;
  metadata: Record<string, unknown>;
}

/** Paginated result from a file listing or search operation. */
export interface DriveListResult {
  files: DriveFile[];
  next_page_token?: string;
  total_count?: number;
}

/**
 * Validate that a connection has files enabled and is active.
 * Throws OAuthError with 403 if files feature is not enabled.
 */
function assertFilesEnabled(connection: OAuthConnection): void {
  if (!connection.is_active) {
    throw new OAuthError(
      'OAuth connection is disabled',
      'CONNECTION_DISABLED',
      connection.provider,
      403,
    );
  }
  if (!connection.enabled_features.includes('files')) {
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
  connection_id: string,
): Promise<{ connection: OAuthConnection; access_token: string }> {
  const connection = await getConnection(pool, connection_id);
  if (!connection) {
    throw new NoConnectionError(connection_id);
  }
  assertFilesEnabled(connection);
  const access_token = await getValidAccessToken(pool, connection_id);
  return { connection, access_token };
}

/**
 * List files in a folder (or root) for a given connection.
 *
 * @param pool - Database pool for connection lookup and token refresh
 * @param connection_id - UUID of the OAuth connection
 * @param folder_id - Optional folder ID; omit for root listing
 * @param page_token - Optional pagination token from a previous result
 */
export async function listFiles(
  pool: Pool,
  connection_id: string,
  folder_id?: string,
  page_token?: string,
): Promise<DriveListResult> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);

  switch (connection.provider) {
    case 'microsoft':
      return microsoft.listDriveItems(access_token, connection_id, folder_id, page_token);
    case 'google':
      return google.listDriveFiles(access_token, connection_id, folder_id, page_token);
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
 * @param connection_id - UUID of the OAuth connection
 * @param query - Search query string
 * @param page_token - Optional pagination token from a previous result
 */
export async function searchFiles(
  pool: Pool,
  connection_id: string,
  query: string,
  page_token?: string,
): Promise<DriveListResult> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);

  switch (connection.provider) {
    case 'microsoft':
      return microsoft.searchDriveItems(access_token, connection_id, query, page_token);
    case 'google':
      return google.searchDriveFiles(access_token, connection_id, query, page_token);
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
 * @param connection_id - UUID of the OAuth connection
 * @param fileId - Provider-specific file/item ID
 */
export async function getFile(
  pool: Pool,
  connection_id: string,
  fileId: string,
): Promise<DriveFile> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);

  switch (connection.provider) {
    case 'microsoft':
      return microsoft.getDriveItem(access_token, connection_id, fileId);
    case 'google':
      return google.getDriveFile(access_token, connection_id, fileId);
    default:
      throw new OAuthError(
        `Unsupported provider for files: ${connection.provider}`,
        'UNSUPPORTED_PROVIDER',
        connection.provider,
      );
  }
}
// ci trigger
