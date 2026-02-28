/**
 * Home Assistant OAuth2 (IndieAuth) implementation.
 * Issue #1808.
 *
 * HA uses OAuth2 with the IndieAuth extension:
 * - No client_secret (public clients)
 * - Client ID = app URL (no pre-registration)
 * - No PKCE — uses IndieAuth instead
 * - Token endpoint is per-instance: <HA_URL>/auth/token
 * - Tokens exchanged via application/x-www-form-urlencoded (not JSON)
 * - Access tokens expire in 30 minutes; refresh tokens are long-lived
 *
 * Ref: https://developers.home-assistant.io/docs/auth_api/
 */

import { OAuthError } from './types.ts';

const HA_FETCH_TIMEOUT_MS = 15_000;

export interface HaOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: Date;
  token_type: string;
}

/**
 * Build the HA authorization URL for the IndieAuth flow.
 */
export function buildAuthorizationUrl(
  instanceUrl: string,
  clientId: string,
  redirectUri: string,
  state: string,
): { url: string } {
  const base = instanceUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return { url: `${base}/auth/authorize?${params.toString()}` };
}

/**
 * Exchange an authorization code for tokens.
 * POST <instanceUrl>/auth/token with application/x-www-form-urlencoded.
 *
 * @throws {OAuthError} on any failure (network, non-2xx, invalid response)
 */
export async function exchangeCodeForTokens(
  instanceUrl: string,
  code: string,
  clientId: string,
): Promise<HaOAuthTokens> {
  const base = instanceUrl.replace(/\/+$/, '');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
  });

  let resp: Response;
  try {
    resp = await fetch(`${base}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(HA_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OAuthError(
      `HA token exchange network error: ${(err as Error).message}`,
      'HA_TOKEN_EXCHANGE_FAILED',
      'home_assistant',
      502,
    );
  }

  if (!resp.ok) {
    let detail = '';
    try { detail = await resp.text(); } catch { /* ignore */ }
    throw new OAuthError(
      `HA token exchange failed: ${resp.status} ${resp.statusText}${detail ? ` — ${detail}` : ''}`,
      'HA_TOKEN_EXCHANGE_FAILED',
      'home_assistant',
      502,
    );
  }

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    throw new OAuthError(
      'HA token exchange returned invalid JSON',
      'HA_TOKEN_EXCHANGE_FAILED',
      'home_assistant',
      502,
    );
  }

  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new OAuthError(
      'HA token exchange response missing access_token',
      'HA_TOKEN_EXCHANGE_FAILED',
      'home_assistant',
      502,
    );
  }

  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_at: typeof data.expires_in === 'number'
      ? new Date(Date.now() + (data.expires_in as number) * 1000)
      : undefined,
    token_type: typeof data.token_type === 'string' ? (data.token_type as string) : 'Bearer',
  };
}

/**
 * Refresh an expired access token.
 * POST <instanceUrl>/auth/token with grant_type=refresh_token.
 *
 * @throws {OAuthError} on any failure
 */
export async function refreshAccessToken(
  instanceUrl: string,
  refreshToken: string,
  clientId: string,
): Promise<HaOAuthTokens> {
  const base = instanceUrl.replace(/\/+$/, '');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  let resp: Response;
  try {
    resp = await fetch(`${base}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(HA_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OAuthError(
      `HA token refresh network error: ${(err as Error).message}`,
      'HA_TOKEN_REFRESH_FAILED',
      'home_assistant',
      502,
    );
  }

  if (!resp.ok) {
    let detail = '';
    try { detail = await resp.text(); } catch { /* ignore */ }
    throw new OAuthError(
      `HA token refresh failed: ${resp.status} ${resp.statusText}${detail ? ` — ${detail}` : ''}`,
      'HA_TOKEN_REFRESH_FAILED',
      'home_assistant',
      502,
    );
  }

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    throw new OAuthError(
      'HA token refresh returned invalid JSON',
      'HA_TOKEN_REFRESH_FAILED',
      'home_assistant',
      502,
    );
  }

  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new OAuthError(
      'HA token refresh response missing access_token',
      'HA_TOKEN_REFRESH_FAILED',
      'home_assistant',
      502,
    );
  }

  return {
    access_token: data.access_token,
    expires_at: typeof data.expires_in === 'number'
      ? new Date(Date.now() + (data.expires_in as number) * 1000)
      : undefined,
    token_type: typeof data.token_type === 'string' ? (data.token_type as string) : 'Bearer',
  };
}
