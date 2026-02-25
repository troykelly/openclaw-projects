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

  const resp = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error(`HA token exchange failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined,
    token_type: data.token_type ?? 'Bearer',
  };
}

/**
 * Refresh an expired access token.
 * POST <instanceUrl>/auth/token with grant_type=refresh_token.
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

  const resp = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error(`HA token refresh failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json() as {
    access_token: string;
    expires_in?: number;
    token_type: string;
  };

  return {
    access_token: data.access_token,
    expires_at: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined,
    token_type: data.token_type ?? 'Bearer',
  };
}
