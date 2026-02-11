/**
 * OAuth service for token management and provider abstraction.
 * Part of Issue #206.
 */

import type { Pool } from 'pg';
import type { OAuthProvider, OAuthTokens, OAuthConnection, OAuthAuthorizationUrl, OAuthStateData, ProviderContact } from './types.ts';
import { OAuthError, NoConnectionError, TokenExpiredError, InvalidStateError } from './types.ts';
import { requireProviderConfig, isProviderConfigured } from './config.ts';
import * as microsoft from './microsoft.ts';
import * as google from './google.ts';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer

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

export async function saveConnection(pool: Pool, userEmail: string, provider: OAuthProvider, tokens: OAuthTokens, providerAccountEmail?: string): Promise<OAuthConnection> {
  const result = await pool.query(
    `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at, token_metadata, provider_account_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_email, provider, COALESCE(provider_account_email, ''))
     DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_connection.refresh_token),
       scopes = EXCLUDED.scopes,
       expires_at = EXCLUDED.expires_at,
       token_metadata = EXCLUDED.token_metadata,
       updated_at = now()
     RETURNING id::text, user_email, provider, access_token, refresh_token, scopes, expires_at, token_metadata, created_at, updated_at`,
    [
      userEmail,
      provider,
      tokens.accessToken,
      tokens.refreshToken || null,
      tokens.scopes,
      tokens.expiresAt || null,
      JSON.stringify({ tokenType: tokens.tokenType }),
      providerAccountEmail ?? null,
    ],
  );

  const row = result.rows[0];
  return {
    id: row.id,
    userEmail: row.user_email,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scopes: row.scopes,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    tokenMetadata: row.token_metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function getConnection(pool: Pool, userEmail: string, provider: OAuthProvider): Promise<OAuthConnection | null> {
  const result = await pool.query(
    `SELECT id::text, user_email, provider, access_token, refresh_token, scopes, expires_at, token_metadata, created_at, updated_at
     FROM oauth_connection
     WHERE user_email = $1 AND provider = $2`,
    [userEmail, provider],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    userEmail: row.user_email,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scopes: row.scopes,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    tokenMetadata: row.token_metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export async function getValidAccessToken(pool: Pool, userEmail: string, provider: OAuthProvider): Promise<string> {
  const connection = await getConnection(pool, userEmail, provider);

  if (!connection) {
    throw new NoConnectionError(provider, userEmail);
  }

  // Check if token is expired or about to expire
  if (isTokenExpired(connection.expiresAt)) {
    if (!connection.refreshToken) {
      throw new TokenExpiredError(provider);
    }

    // Refresh the token
    const newTokens = await refreshTokens(provider, connection.refreshToken);

    // Save the new tokens
    await saveConnection(pool, userEmail, provider, newTokens);

    return newTokens.accessToken;
  }

  return connection.accessToken;
}

export async function deleteConnection(pool: Pool, connectionId: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM oauth_connection WHERE id = $1', [connectionId]);
  return (result.rowCount ?? 0) > 0;
}

export async function listConnections(pool: Pool, userEmail?: string): Promise<OAuthConnection[]> {
  let sql = `
    SELECT id::text, user_email, provider, access_token, refresh_token, scopes, expires_at, token_metadata, created_at, updated_at
    FROM oauth_connection
  `;
  const params: string[] = [];

  if (userEmail) {
    sql += ' WHERE user_email = $1';
    params.push(userEmail);
  }

  sql += ' ORDER BY created_at DESC';

  const result = await pool.query(sql, params);

  return result.rows.map((row) => ({
    id: row.id,
    userEmail: row.user_email,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    scopes: row.scopes,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    tokenMetadata: row.token_metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

export { isProviderConfigured };
