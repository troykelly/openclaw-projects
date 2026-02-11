/**
 * OAuth service for token management and provider abstraction.
 * Part of Issue #206, refactored in Issue #1045 for multi-account support.
 */

import type { Pool } from 'pg';
import type {
  OAuthProvider,
  OAuthTokens,
  OAuthConnection,
  OAuthConnectionUpdate,
  OAuthAuthorizationUrl,
  OAuthStateData,
  OAuthFeature,
  ProviderContact,
} from './types.ts';
import { OAuthError, NoConnectionError, TokenExpiredError, InvalidStateError, ALLOWED_FEATURES } from './types.ts';
import { requireProviderConfig, isProviderConfigured } from './config.ts';
import { encryptToken, decryptToken } from './crypto.ts';
import * as microsoft from './microsoft.ts';
import * as google from './google.ts';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer

/** All columns returned by connection queries. */
const CONNECTION_COLUMNS = `
  id::text, user_email, provider, access_token, refresh_token, scopes, expires_at,
  token_metadata, label, provider_account_id, provider_account_email,
  permission_level, enabled_features, is_active, last_sync_at, sync_status,
  created_at, updated_at
`;

/** Map a database row to an OAuthConnection object, decrypting tokens. */
function rowToConnection(row: Record<string, unknown>): OAuthConnection {
  const rowId = row.id as string;
  return {
    id: rowId,
    userEmail: row.user_email as string,
    provider: row.provider as OAuthProvider,
    accessToken: decryptToken(row.access_token as string, rowId),
    refreshToken: row.refresh_token ? decryptToken(row.refresh_token as string, rowId) : undefined,
    scopes: row.scopes as string[],
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
    tokenMetadata: (row.token_metadata as Record<string, unknown>) || {},
    label: row.label as string,
    providerAccountId: (row.provider_account_id as string) || undefined,
    providerAccountEmail: (row.provider_account_email as string) || undefined,
    permissionLevel: (row.permission_level as 'read' | 'read_write') || 'read',
    enabledFeatures: (row.enabled_features as OAuthFeature[]) || [],
    isActive: row.is_active as boolean,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at as string) : undefined,
    syncStatus: (row.sync_status as Record<string, unknown>) || {},
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/**
 * Build the provider authorization URL and persist the PKCE state in the database.
 *
 * The state row expires after 10 minutes (set by the DB default).
 */
export async function getAuthorizationUrl(
  pool: Pool,
  provider: OAuthProvider,
  state: string,
  scopes?: string[],
  opts?: { userEmail?: string; redirectPath?: string },
): Promise<OAuthAuthorizationUrl> {
  const config = requireProviderConfig(provider);

  let result: OAuthAuthorizationUrl;
  switch (provider) {
    case 'microsoft':
      result = microsoft.buildAuthorizationUrl(config, state, scopes);
      break;
    case 'google':
      result = google.buildAuthorizationUrl(config, state, scopes);
      break;
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }

  // Persist state with PKCE code verifier for validation during callback
  await pool.query(
    `INSERT INTO oauth_state (state, provider, code_verifier, scopes, user_email, redirect_path)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [state, provider, result.codeVerifier, result.scopes, opts?.userEmail ?? null, opts?.redirectPath ?? null],
  );

  return result;
}

/**
 * Validate and consume an OAuth state token (single-use).
 *
 * Deletes the row atomically so a replayed state will fail.
 * Also cleans up any expired states in the same call.
 *
 * @throws {InvalidStateError} when the state is unknown or expired.
 */
export async function validateState(pool: Pool, state: string): Promise<OAuthStateData> {
  // Delete-and-return in one atomic statement; only match non-expired rows
  const result = await pool.query(
    `DELETE FROM oauth_state
     WHERE state = $1 AND expires_at > now()
     RETURNING provider, code_verifier, scopes, user_email, redirect_path, created_at, expires_at`,
    [state],
  );

  if (result.rows.length === 0) {
    throw new InvalidStateError();
  }

  const row = result.rows[0];
  return {
    provider: row.provider,
    codeVerifier: row.code_verifier,
    scopes: row.scopes ?? [],
    userEmail: row.user_email ?? undefined,
    redirectPath: row.redirect_path ?? undefined,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  };
}

/**
 * Remove expired oauth_state rows.
 *
 * Can be invoked from a pgcron job or called opportunistically.
 * Returns the number of rows deleted.
 */
export async function cleanExpiredStates(pool: Pool): Promise<number> {
  const result = await pool.query('DELETE FROM oauth_state WHERE expires_at <= now()');
  return result.rowCount ?? 0;
}

export async function exchangeCodeForTokens(provider: OAuthProvider, code: string, codeVerifier?: string): Promise<OAuthTokens> {
  const config = requireProviderConfig(provider);

  switch (provider) {
    case 'microsoft':
      return microsoft.exchangeCodeForTokens(code, config, codeVerifier);
    case 'google':
      return google.exchangeCodeForTokens(code, config, codeVerifier);
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }
}

export async function getUserEmail(provider: OAuthProvider, accessToken: string): Promise<string> {
  switch (provider) {
    case 'microsoft':
      return microsoft.getUserEmail(accessToken);
    case 'google':
      return google.getUserEmail(accessToken);
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }
}

export async function refreshTokens(provider: OAuthProvider, refreshToken: string): Promise<OAuthTokens> {
  const config = requireProviderConfig(provider);

  switch (provider) {
    case 'microsoft':
      return microsoft.refreshAccessToken(refreshToken, config);
    case 'google':
      return google.refreshAccessToken(refreshToken, config);
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }
}

export async function fetchProviderContacts(
  provider: OAuthProvider,
  accessToken: string,
  syncCursor?: string,
): Promise<{ contacts: ProviderContact[]; syncCursor?: string }> {
  switch (provider) {
    case 'microsoft':
      return microsoft.fetchAllContacts(accessToken, syncCursor);
    case 'google':
      return google.fetchAllContacts(accessToken, syncCursor);
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }
}

function isTokenExpired(expiresAt?: Date): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS <= Date.now();
}

/**
 * Validate that features are from the allowed set.
 * Returns validated array or throws on invalid features.
 */
export function validateFeatures(features: string[]): OAuthFeature[] {
  const invalid = features.filter((f) => !(ALLOWED_FEATURES as readonly string[]).includes(f));
  if (invalid.length > 0) {
    throw new OAuthError(`Invalid features: ${invalid.join(', ')}. Allowed: ${ALLOWED_FEATURES.join(', ')}`, 'INVALID_FEATURES');
  }
  return features as OAuthFeature[];
}

/**
 * Save or upsert an OAuth connection with multi-account support.
 * The upsert key is (user_email, provider, COALESCE(provider_account_email, '')).
 * Tokens are encrypted at rest using per-row HKDF-derived keys (when enabled).
 */
export async function saveConnection(
  pool: Pool,
  userEmail: string,
  provider: OAuthProvider,
  tokens: OAuthTokens,
  options?: {
    providerAccountEmail?: string;
    label?: string;
    permissionLevel?: 'read' | 'read_write';
    enabledFeatures?: OAuthFeature[];
  },
): Promise<OAuthConnection> {
  const label = options?.label || 'Default';
  const permissionLevel = options?.permissionLevel || 'read';
  const enabledFeatures = options?.enabledFeatures || [];
  const providerAccountEmail = options?.providerAccountEmail ?? null;

  // Insert first to get the row ID, then encrypt tokens using that ID as HKDF salt.
  const result = await pool.query(
    `INSERT INTO oauth_connection (
       user_email, provider, access_token, refresh_token, scopes, expires_at,
       token_metadata, provider_account_email, label, permission_level, enabled_features
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (user_email, provider, COALESCE(provider_account_email, ''))
     DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_connection.refresh_token),
       scopes = EXCLUDED.scopes,
       expires_at = EXCLUDED.expires_at,
       token_metadata = EXCLUDED.token_metadata,
       provider_account_email = COALESCE(EXCLUDED.provider_account_email, oauth_connection.provider_account_email),
       updated_at = now()
     RETURNING ${CONNECTION_COLUMNS}`,
    [
      userEmail,
      provider,
      tokens.accessToken,
      tokens.refreshToken || null,
      tokens.scopes,
      tokens.expiresAt || null,
      JSON.stringify({ tokenType: tokens.tokenType }),
      providerAccountEmail,
      label,
      permissionLevel,
      enabledFeatures,
    ],
  );

  const row = result.rows[0];
  const rowId = row.id as string;

  // Encrypt tokens using the row ID for per-row key derivation, then persist
  const encryptedAccess = encryptToken(tokens.accessToken, rowId);
  const encryptedRefresh = tokens.refreshToken ? encryptToken(tokens.refreshToken, rowId) : null;

  await pool.query(
    `UPDATE oauth_connection SET access_token = $1, refresh_token = COALESCE($2, refresh_token) WHERE id = $3`,
    [encryptedAccess, encryptedRefresh, rowId],
  );

  // Build return object manually — rowToConnection would try to decrypt the
  // plaintext tokens from the RETURNING clause, causing "Invalid ciphertext" errors.
  return {
    id: rowId,
    userEmail: row.user_email as string,
    provider: row.provider as OAuthProvider,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    scopes: row.scopes as string[],
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
    tokenMetadata: (row.token_metadata as Record<string, unknown>) || {},
    label: row.label as string,
    providerAccountId: (row.provider_account_id as string) || undefined,
    providerAccountEmail: (row.provider_account_email as string) || undefined,
    permissionLevel: (row.permission_level as 'read' | 'read_write') || 'read',
    enabledFeatures: (row.enabled_features as OAuthFeature[]) || [],
    isActive: row.is_active as boolean,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at as string) : undefined,
    syncStatus: (row.sync_status as Record<string, unknown>) || {},
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

/** Look up a single connection by its UUID. */
export async function getConnection(pool: Pool, connectionId: string): Promise<OAuthConnection | null> {
  const result = await pool.query(
    `SELECT ${CONNECTION_COLUMNS} FROM oauth_connection WHERE id = $1`,
    [connectionId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToConnection(result.rows[0]);
}

/**
 * List connections, optionally filtered by userEmail and/or provider.
 */
export async function listConnections(pool: Pool, userEmail?: string, provider?: OAuthProvider): Promise<OAuthConnection[]> {
  const conditions: string[] = [];
  const params: string[] = [];

  if (userEmail) {
    params.push(userEmail);
    conditions.push(`user_email = $${params.length}`);
  }

  if (provider) {
    params.push(provider);
    conditions.push(`provider = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT ${CONNECTION_COLUMNS} FROM oauth_connection ${where} ORDER BY created_at DESC`,
    params,
  );

  return result.rows.map(rowToConnection);
}

/**
 * Update mutable fields on an existing connection.
 * Returns the updated connection or null if not found.
 */
export async function updateConnection(pool: Pool, connectionId: string, updates: OAuthConnectionUpdate): Promise<OAuthConnection | null> {
  const setClauses: string[] = ['updated_at = now()'];
  const params: unknown[] = [connectionId];

  if (updates.label !== undefined) {
    params.push(updates.label);
    setClauses.push(`label = $${params.length}`);
  }

  if (updates.permissionLevel !== undefined) {
    params.push(updates.permissionLevel);
    setClauses.push(`permission_level = $${params.length}`);
  }

  if (updates.enabledFeatures !== undefined) {
    params.push(updates.enabledFeatures);
    setClauses.push(`enabled_features = $${params.length}`);
  }

  if (updates.isActive !== undefined) {
    params.push(updates.isActive);
    setClauses.push(`is_active = $${params.length}`);
  }

  const result = await pool.query(
    `UPDATE oauth_connection SET ${setClauses.join(', ')} WHERE id = $1 RETURNING ${CONNECTION_COLUMNS}`,
    params,
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToConnection(result.rows[0]);
}

/**
 * Get a valid (non-expired) access token for a connection by its UUID.
 * Automatically refreshes the token if expired.
 */
export async function getValidAccessToken(pool: Pool, connectionId: string): Promise<string> {
  const connection = await getConnection(pool, connectionId);

  if (!connection) {
    throw new NoConnectionError(connectionId);
  }

  // Check if token is expired or about to expire
  if (isTokenExpired(connection.expiresAt)) {
    if (!connection.refreshToken) {
      throw new TokenExpiredError(connection.provider);
    }

    // Refresh the token
    const newTokens = await refreshTokens(connection.provider, connection.refreshToken);

    // Save the refreshed tokens
    await saveConnection(pool, connection.userEmail, connection.provider, newTokens, {
      providerAccountEmail: connection.providerAccountEmail,
    });

    return newTokens.accessToken;
  }

  return connection.accessToken;
}

export async function deleteConnection(pool: Pool, connectionId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM oauth_connection WHERE id = $1', [connectionId]);
  return (result.rowCount ?? 0) > 0;
}

export { isProviderConfigured };
