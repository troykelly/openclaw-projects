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
import type { OAuthPermissionLevel } from './types.ts';
import { OAuthError, NoConnectionError, TokenExpiredError, InvalidStateError, ALLOWED_FEATURES } from './types.ts';
import { requireProviderConfig, isProviderConfigured } from './config.ts';
import { encryptToken, decryptToken } from './crypto.ts';
import { getRequiredScopes, getMissingScopes } from './scopes.ts';
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
    user_email: row.user_email as string,
    provider: row.provider as OAuthProvider,
    access_token: decryptToken(row.access_token as string, rowId),
    refresh_token: row.refresh_token ? decryptToken(row.refresh_token as string, rowId) : undefined,
    scopes: row.scopes as string[],
    expires_at: row.expires_at ? new Date(row.expires_at as string) : undefined,
    token_metadata: (row.token_metadata as Record<string, unknown>) || {},
    label: row.label as string,
    provider_account_id: (row.provider_account_id as string) || undefined,
    provider_account_email: (row.provider_account_email as string) || undefined,
    permission_level: (row.permission_level as 'read' | 'read_write') || 'read',
    enabled_features: (row.enabled_features as OAuthFeature[]) || [],
    is_active: row.is_active as boolean,
    last_sync_at: row.last_sync_at ? new Date(row.last_sync_at as string) : undefined,
    sync_status: (row.sync_status as Record<string, unknown>) || {},
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

/**
 * Build the provider authorization URL and persist the PKCE state in the database.
 *
 * The state row expires after 10 minutes (set by the DB default).
 *
 * When `features` and `permission_level` are provided, scopes are computed
 * from the feature-to-scope map instead of using the raw `scopes` parameter.
 * For Google, incremental auth (`include_granted_scopes=true`) is enabled
 * so existing grants are preserved and only new scopes trigger consent.
 * Microsoft inherently supports additive scope requests on re-auth.
 */
export async function getAuthorizationUrl(
  pool: Pool,
  provider: OAuthProvider,
  state: string,
  scopes?: string[],
  opts?: {
    user_email?: string;
    redirect_path?: string;
    features?: OAuthFeature[];
    permission_level?: OAuthPermissionLevel;
  },
): Promise<OAuthAuthorizationUrl> {
  const config = requireProviderConfig(provider);

  // If features are provided, compute scopes from the feature map
  const effectiveScopes = opts?.features && opts.features.length > 0
    ? getRequiredScopes(provider, opts.features, opts.permission_level ?? 'read')
    : scopes;

  // Incremental auth: when features are specified, we're adding scopes to an existing connection
  const isIncremental = !!(opts?.features && opts.features.length > 0);

  let result: OAuthAuthorizationUrl;
  switch (provider) {
    case 'microsoft':
      result = microsoft.buildAuthorizationUrl(config, state, effectiveScopes);
      break;
    case 'google':
      result = google.buildAuthorizationUrl(config, state, effectiveScopes, {
        includeGrantedScopes: isIncremental,
      });
      break;
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }

  // Persist state with PKCE code verifier for validation during callback
  await pool.query(
    `INSERT INTO oauth_state (state, provider, code_verifier, scopes, user_email, redirect_path)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [state, provider, result.code_verifier, result.scopes, opts?.user_email ?? null, opts?.redirect_path ?? null],
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
    code_verifier: row.code_verifier,
    scopes: row.scopes ?? [],
    user_email: row.user_email ?? undefined,
    redirect_path: row.redirect_path ?? undefined,
    created_at: new Date(row.created_at),
    expires_at: new Date(row.expires_at),
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

export async function exchangeCodeForTokens(provider: OAuthProvider, code: string, code_verifier?: string): Promise<OAuthTokens> {
  if (provider === 'home_assistant') {
    throw new OAuthError('HA token exchange requires instance_url — use haExchangeCodeForTokens directly', 'HA_REQUIRES_INSTANCE', 'home_assistant');
  }

  const config = requireProviderConfig(provider);

  switch (provider) {
    case 'microsoft':
      return microsoft.exchangeCodeForTokens(code, config, code_verifier);
    case 'google':
      return google.exchangeCodeForTokens(code, config, code_verifier);
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }
}

export async function getUserEmail(provider: OAuthProvider, access_token: string): Promise<string> {
  switch (provider) {
    case 'microsoft':
      return microsoft.getUserEmail(access_token);
    case 'google':
      return google.getUserEmail(access_token);
    case 'home_assistant':
      throw new OAuthError('HA does not provide user email — use session email', 'HA_NO_EMAIL', 'home_assistant');
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }
}

export async function refreshTokens(provider: OAuthProvider, refresh_token: string): Promise<OAuthTokens> {
  if (provider === 'home_assistant') {
    throw new OAuthError('HA token refresh requires instance_url — use haRefreshAccessToken directly', 'HA_REQUIRES_INSTANCE', 'home_assistant');
  }

  const config = requireProviderConfig(provider);

  switch (provider) {
    case 'microsoft':
      return microsoft.refreshAccessToken(refresh_token, config);
    case 'google':
      return google.refreshAccessToken(refresh_token, config);
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }
}

export async function fetchProviderContacts(
  provider: OAuthProvider,
  access_token: string,
  sync_cursor?: string,
): Promise<{ contacts: ProviderContact[]; sync_cursor?: string }> {
  switch (provider) {
    case 'microsoft':
      return microsoft.fetchAllContacts(access_token, sync_cursor);
    case 'google':
      return google.fetchAllContacts(access_token, sync_cursor);
    case 'home_assistant':
      throw new OAuthError('HA does not support contact sync', 'HA_NO_CONTACTS', 'home_assistant');
    default:
      throw new OAuthError(`Unknown provider: ${provider}`, 'UNKNOWN_PROVIDER', provider);
  }
}

function isTokenExpired(expires_at?: Date): boolean {
  if (!expires_at) return false;
  return expires_at.getTime() - TOKEN_EXPIRY_BUFFER_MS <= Date.now();
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
  user_email: string,
  provider: OAuthProvider,
  tokens: OAuthTokens,
  options?: {
    provider_account_email?: string;
    label?: string;
    permission_level?: 'read' | 'read_write';
    enabled_features?: OAuthFeature[];
  },
): Promise<OAuthConnection> {
  const label = options?.label || 'Default';
  const permission_level = options?.permission_level || 'read';
  const enabled_features = options?.enabled_features || [];
  const provider_account_email = options?.provider_account_email ?? null;

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
      user_email,
      provider,
      tokens.access_token,
      tokens.refresh_token || null,
      tokens.scopes,
      tokens.expires_at || null,
      JSON.stringify({ token_type: tokens.token_type }),
      provider_account_email,
      label,
      permission_level,
      enabled_features,
    ],
  );

  const row = result.rows[0];
  const rowId = row.id as string;

  // Encrypt tokens using the row ID for per-row key derivation, then persist
  const encryptedAccess = encryptToken(tokens.access_token, rowId);
  const encryptedRefresh = tokens.refresh_token ? encryptToken(tokens.refresh_token, rowId) : null;

  await pool.query(
    `UPDATE oauth_connection SET access_token = $1, refresh_token = COALESCE($2, refresh_token) WHERE id = $3`,
    [encryptedAccess, encryptedRefresh, rowId],
  );

  // Build return object manually — rowToConnection would try to decrypt the
  // plaintext tokens from the RETURNING clause, causing "Invalid ciphertext" errors.
  return {
    id: rowId,
    user_email: row.user_email as string,
    provider: row.provider as OAuthProvider,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    scopes: row.scopes as string[],
    expires_at: row.expires_at ? new Date(row.expires_at as string) : undefined,
    token_metadata: (row.token_metadata as Record<string, unknown>) || {},
    label: row.label as string,
    provider_account_id: (row.provider_account_id as string) || undefined,
    provider_account_email: (row.provider_account_email as string) || undefined,
    permission_level: (row.permission_level as 'read' | 'read_write') || 'read',
    enabled_features: (row.enabled_features as OAuthFeature[]) || [],
    is_active: row.is_active as boolean,
    last_sync_at: row.last_sync_at ? new Date(row.last_sync_at as string) : undefined,
    sync_status: (row.sync_status as Record<string, unknown>) || {},
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

/** Look up a single connection by its UUID. */
export async function getConnection(pool: Pool, connection_id: string): Promise<OAuthConnection | null> {
  const result = await pool.query(
    `SELECT ${CONNECTION_COLUMNS} FROM oauth_connection WHERE id = $1`,
    [connection_id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToConnection(result.rows[0]);
}

/**
 * List connections, optionally filtered by user_email and/or provider.
 */
export async function listConnections(pool: Pool, user_email?: string, provider?: OAuthProvider): Promise<OAuthConnection[]> {
  const conditions: string[] = [];
  const params: string[] = [];

  if (user_email) {
    params.push(user_email);
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
export async function updateConnection(pool: Pool, connection_id: string, updates: OAuthConnectionUpdate): Promise<OAuthConnection | null> {
  const setClauses: string[] = ['updated_at = now()'];
  const params: unknown[] = [connection_id];

  if (updates.label !== undefined) {
    params.push(updates.label);
    setClauses.push(`label = $${params.length}`);
  }

  if (updates.permission_level !== undefined) {
    params.push(updates.permission_level);
    setClauses.push(`permission_level = $${params.length}`);
  }

  if (updates.enabled_features !== undefined) {
    params.push(updates.enabled_features);
    setClauses.push(`enabled_features = $${params.length}`);
  }

  if (updates.is_active !== undefined) {
    params.push(updates.is_active);
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
export async function getValidAccessToken(pool: Pool, connection_id: string): Promise<string> {
  const connection = await getConnection(pool, connection_id);

  if (!connection) {
    throw new NoConnectionError(connection_id);
  }

  // Check if token is expired or about to expire
  if (isTokenExpired(connection.expires_at)) {
    if (!connection.refresh_token) {
      throw new TokenExpiredError(connection.provider);
    }

    // Refresh the token
    const newTokens = await refreshTokens(connection.provider, connection.refresh_token);

    // Save the refreshed tokens
    await saveConnection(pool, connection.user_email, connection.provider, newTokens, {
      provider_account_email: connection.provider_account_email,
    });

    return newTokens.access_token;
  }

  return connection.access_token;
}

export async function deleteConnection(pool: Pool, connection_id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM oauth_connection WHERE id = $1', [connection_id]);
  return (result.rowCount ?? 0) > 0;
}

export { isProviderConfigured };
