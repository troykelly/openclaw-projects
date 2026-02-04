/**
 * Google OAuth and People API implementation.
 * Part of Issue #206.
 */

import { createHash, randomBytes } from 'crypto';
import type { OAuthConfig, OAuthTokens, ProviderContact, OAuthAuthorizationUrl } from './types.ts';
import { OAuthError, TokenRefreshError } from './types.ts';
import { requireProviderConfig } from './config.ts';

// PKCE utilities
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PEOPLE_API_BASE = 'https://people.googleapis.com/v1';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

interface GoogleUserResponse {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  picture?: string;
}

interface GooglePersonName {
  displayName?: string;
  givenName?: string;
  familyName?: string;
}

interface GoogleEmailAddress {
  value: string;
  type?: string;
}

interface GooglePhoneNumber {
  value: string;
  type?: string;
}

interface GoogleOrganization {
  name?: string;
  title?: string;
}

interface GooglePerson {
  resourceName: string;
  names?: GooglePersonName[];
  emailAddresses?: GoogleEmailAddress[];
  phoneNumbers?: GooglePhoneNumber[];
  organizations?: GoogleOrganization[];
}

interface GoogleConnectionsResponse {
  connections?: GooglePerson[];
  nextPageToken?: string;
  nextSyncToken?: string;
  totalPeople?: number;
}

export function buildAuthorizationUrl(
  config: OAuthConfig,
  state: string,
  scopes?: string[]
): OAuthAuthorizationUrl {
  const effectiveScopes = scopes || config.scopes;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: effectiveScopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `${AUTHORIZE_URL}?${params.toString()}`,
    state,
    provider: 'google',
    scopes: effectiveScopes,
    codeVerifier,
  };
}

export async function exchangeCodeForTokens(
  code: string,
  config?: OAuthConfig,
  codeVerifier?: string
): Promise<OAuthTokens> {
  const effectiveConfig = config || requireProviderConfig('google');

  const params = new URLSearchParams({
    client_id: effectiveConfig.clientId,
    client_secret: effectiveConfig.clientSecret,
    code,
    redirect_uri: effectiveConfig.redirectUri,
    grant_type: 'authorization_code',
  });

  // Include PKCE code_verifier if provided
  if (codeVerifier) {
    params.set('code_verifier', codeVerifier);
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Log detailed error server-side, return generic message to client
    console.error('[OAuth] Google token exchange failed:', {
      status: response.status,
      error: errorText,
    });
    throw new OAuthError(
      'Failed to complete OAuth authorization',
      'TOKEN_EXCHANGE_FAILED',
      'google',
      response.status
    );
  }

  const data = (await response.json()) as GoogleTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scopes: data.scope.split(' '),
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  config?: OAuthConfig
): Promise<OAuthTokens> {
  const effectiveConfig = config || requireProviderConfig('google');

  const params = new URLSearchParams({
    client_id: effectiveConfig.clientId,
    client_secret: effectiveConfig.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Log detailed error server-side, return generic message to client
    console.error('[OAuth] Google token refresh failed:', {
      status: response.status,
      error: errorText,
    });
    throw new TokenRefreshError('google', 'Token refresh failed');
  }

  const data = (await response.json()) as GoogleTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: refreshToken, // Google doesn't return a new refresh token
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scopes: data.scope.split(' '),
  };
}

export async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new OAuthError(
      'Failed to get user profile',
      'PROFILE_FETCH_FAILED',
      'google',
      response.status
    );
  }

  const data = (await response.json()) as GoogleUserResponse;
  return data.email;
}

function mapGoogleContact(person: GooglePerson): ProviderContact {
  const name = person.names?.[0];
  const emails = person.emailAddresses?.map((e) => e.value) || [];
  const phones = person.phoneNumbers?.map((p) => p.value) || [];
  const org = person.organizations?.[0];

  // Extract ID from resourceName (e.g., "people/c12345" -> "c12345")
  const id = person.resourceName.replace('people/', '');

  return {
    id,
    displayName: name?.displayName,
    givenName: name?.givenName,
    familyName: name?.familyName,
    emailAddresses: emails,
    phoneNumbers: phones,
    company: org?.name,
    jobTitle: org?.title,
    metadata: {
      provider: 'google',
      resourceName: person.resourceName,
    },
  };
}

export async function fetchContacts(
  accessToken: string,
  options?: { syncToken?: string; pageToken?: string; pageSize?: number }
): Promise<{ contacts: ProviderContact[]; nextPageToken?: string; syncToken?: string }> {
  const params = new URLSearchParams({
    personFields: 'names,emailAddresses,phoneNumbers,organizations',
    pageSize: String(options?.pageSize || 100),
  });

  if (options?.syncToken) {
    params.set('syncToken', options.syncToken);
    params.set('requestSyncToken', 'true');
  } else {
    params.set('requestSyncToken', 'true');
  }

  if (options?.pageToken) {
    params.set('pageToken', options.pageToken);
  }

  const url = `${PEOPLE_API_BASE}/people/me/connections?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    // Handle sync token expired
    if (response.status === 410) {
      // Need to do full sync
      throw new OAuthError(
        'Sync token expired, full sync required',
        'SYNC_TOKEN_EXPIRED',
        'google',
        410
      );
    }

    throw new OAuthError(
      'Failed to fetch contacts',
      'CONTACTS_FETCH_FAILED',
      'google',
      response.status
    );
  }

  const data = (await response.json()) as GoogleConnectionsResponse;

  return {
    contacts: (data.connections || []).map(mapGoogleContact),
    nextPageToken: data.nextPageToken,
    syncToken: data.nextSyncToken,
  };
}

export async function fetchAllContacts(
  accessToken: string,
  syncCursor?: string
): Promise<{ contacts: ProviderContact[]; syncCursor?: string }> {
  const allContacts: ProviderContact[] = [];
  let pageToken: string | undefined;
  let syncToken: string | undefined;

  try {
    // First request
    const firstResult = await fetchContacts(accessToken, { syncToken: syncCursor });
    allContacts.push(...firstResult.contacts);
    pageToken = firstResult.nextPageToken;
    syncToken = firstResult.syncToken;

    // Follow pagination
    while (pageToken) {
      const result = await fetchContacts(accessToken, { pageToken, syncToken: syncCursor });
      allContacts.push(...result.contacts);
      pageToken = result.nextPageToken;
      syncToken = result.syncToken || syncToken;
    }
  } catch (error) {
    // If sync token expired, do full sync without token
    if (error instanceof OAuthError && error.code === 'SYNC_TOKEN_EXPIRED') {
      return fetchAllContacts(accessToken, undefined);
    }
    throw error;
  }

  return {
    contacts: allContacts,
    syncCursor: syncToken,
  };
}
