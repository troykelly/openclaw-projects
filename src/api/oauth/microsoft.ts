/**
 * Microsoft OAuth and Graph API implementation.
 * Part of Issue #206. File/Drive operations added in Issue #1049.
 */

import { createHash, randomBytes } from 'crypto';
import type { OAuthConfig, OAuthTokens, ProviderContact, OAuthAuthorizationUrl } from './types.ts';
import { OAuthError, TokenRefreshError } from './types.ts';
import type { DriveFile, DriveListResult } from './files.ts';
import { requireProviderConfig } from './config.ts';

// PKCE utilities
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Build the Azure AD authorize endpoint for a given tenant.
 * Falls back to `/common/` (multi-tenant) when no tenant ID is provided.
 */
function getAuthorizeUrl(tenantId?: string): string {
  const tenant = tenantId || 'common';
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
}

/**
 * Build the Azure AD token endpoint for a given tenant.
 * Falls back to `/common/` (multi-tenant) when no tenant ID is provided.
 */
function getTokenUrl(tenantId?: string): string {
  const tenant = tenantId || 'common';
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

interface MicrosoftTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

interface MicrosoftUserResponse {
  id: string;
  mail?: string;
  userPrincipalName: string;
  displayName?: string;
}

interface MicrosoftContactResponse {
  id: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  emailAddresses?: Array<{ address: string; name?: string }>;
  businessPhones?: string[];
  mobilePhone?: string;
  homePhones?: string[];
  companyName?: string;
  jobTitle?: string;
}

interface MicrosoftContactsResponse {
  '@odata.deltaLink'?: string;
  '@odata.nextLink'?: string;
  value: MicrosoftContactResponse[];
}

export function buildAuthorizationUrl(config: OAuthConfig, state: string, scopes?: string[]): OAuthAuthorizationUrl {
  const effectiveScopes = scopes || config.scopes;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: effectiveScopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `${getAuthorizeUrl(config.tenantId)}?${params.toString()}`,
    state,
    provider: 'microsoft',
    scopes: effectiveScopes,
    codeVerifier,
  };
}

export async function exchangeCodeForTokens(code: string, config?: OAuthConfig, codeVerifier?: string): Promise<OAuthTokens> {
  const effectiveConfig = config || requireProviderConfig('microsoft');

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

  const response = await fetch(getTokenUrl(effectiveConfig.tenantId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Log detailed error server-side, return generic message to client
    console.error('[OAuth] Microsoft token exchange failed:', {
      status: response.status,
      error: errorText,
    });
    throw new OAuthError('Failed to complete OAuth authorization', 'TOKEN_EXCHANGE_FAILED', 'microsoft', response.status);
  }

  const data = (await response.json()) as MicrosoftTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scopes: data.scope.split(' '),
  };
}

export async function refreshAccessToken(refreshToken: string, config?: OAuthConfig): Promise<OAuthTokens> {
  const effectiveConfig = config || requireProviderConfig('microsoft');

  const params = new URLSearchParams({
    client_id: effectiveConfig.clientId,
    client_secret: effectiveConfig.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(getTokenUrl(effectiveConfig.tenantId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // Log detailed error server-side, return generic message to client
    console.error('[OAuth] Microsoft token refresh failed:', {
      status: response.status,
      error: errorText,
    });
    throw new TokenRefreshError('microsoft', 'Token refresh failed');
  }

  const data = (await response.json()) as MicrosoftTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scopes: data.scope.split(' '),
  };
}

export async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(`${GRAPH_BASE_URL}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new OAuthError('Failed to get user profile', 'PROFILE_FETCH_FAILED', 'microsoft', response.status);
  }

  const data = (await response.json()) as MicrosoftUserResponse;
  return data.mail || data.userPrincipalName;
}

function mapMicrosoftContact(contact: MicrosoftContactResponse): ProviderContact {
  const phoneNumbers: string[] = [];
  if (contact.mobilePhone) phoneNumbers.push(contact.mobilePhone);
  if (contact.businessPhones) phoneNumbers.push(...contact.businessPhones);
  if (contact.homePhones) phoneNumbers.push(...contact.homePhones);

  return {
    id: contact.id,
    displayName: contact.displayName,
    givenName: contact.givenName,
    familyName: contact.surname,
    emailAddresses: contact.emailAddresses?.map((e) => e.address) || [],
    phoneNumbers,
    company: contact.companyName,
    jobTitle: contact.jobTitle,
    metadata: {
      provider: 'microsoft',
      rawContact: contact,
    },
  };
}

export async function fetchContacts(
  accessToken: string,
  options?: { deltaLink?: string; pageSize?: number },
): Promise<{ contacts: ProviderContact[]; deltaLink?: string; nextLink?: string }> {
  let url: string;

  if (options?.deltaLink) {
    url = options.deltaLink;
  } else {
    const params = new URLSearchParams({
      $top: String(options?.pageSize || 100),
      $select: 'id,displayName,givenName,surname,emailAddresses,businessPhones,mobilePhone,homePhones,companyName,jobTitle',
    });
    url = `${GRAPH_BASE_URL}/me/contacts/delta?${params.toString()}`;
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new OAuthError('Failed to fetch contacts', 'CONTACTS_FETCH_FAILED', 'microsoft', response.status);
  }

  const data = (await response.json()) as MicrosoftContactsResponse;

  return {
    contacts: data.value.map(mapMicrosoftContact),
    deltaLink: data['@odata.deltaLink'],
    nextLink: data['@odata.nextLink'],
  };
}

export async function fetchAllContacts(accessToken: string, syncCursor?: string): Promise<{ contacts: ProviderContact[]; syncCursor?: string }> {
  const allContacts: ProviderContact[] = [];
  let nextLink: string | undefined;
  let deltaLink: string | undefined = syncCursor;

  // First request
  const firstResult = await fetchContacts(accessToken, { deltaLink: syncCursor });
  allContacts.push(...firstResult.contacts);
  nextLink = firstResult.nextLink;
  deltaLink = firstResult.deltaLink;

  // Follow pagination
  while (nextLink) {
    const response = await fetch(nextLink, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new OAuthError('Failed to fetch contacts page', 'CONTACTS_FETCH_FAILED', 'microsoft', response.status);
    }

    const data = (await response.json()) as MicrosoftContactsResponse;
    allContacts.push(...data.value.map(mapMicrosoftContact));
    nextLink = data['@odata.nextLink'];
    deltaLink = data['@odata.deltaLink'] || deltaLink;
  }

  return {
    contacts: allContacts,
    syncCursor: deltaLink,
  };
}

// ==================== OneDrive / Files (Issue #1049) ====================

/** Shape of a Microsoft Graph DriveItem response. */
interface MicrosoftDriveItem {
  id: string;
  name: string;
  size?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  webUrl?: string;
  file?: { mimeType: string };
  folder?: { childCount: number };
  parentReference?: { id?: string; path?: string };
  '@microsoft.graph.downloadUrl'?: string;
  thumbnails?: Array<{ large?: { url?: string } }>;
}

interface MicrosoftDriveListResponse {
  value: MicrosoftDriveItem[];
  '@odata.nextLink'?: string;
  '@odata.count'?: number;
}

/** Map a Microsoft Graph DriveItem to the normalized DriveFile interface. */
function mapDriveItem(item: MicrosoftDriveItem, connectionId: string): DriveFile {
  return {
    id: item.id,
    name: item.name,
    mimeType: item.file?.mimeType || (item.folder ? 'application/vnd.microsoft-folder' : 'application/octet-stream'),
    size: item.size,
    createdAt: item.createdDateTime ? new Date(item.createdDateTime) : undefined,
    modifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : undefined,
    path: item.parentReference?.path,
    parentId: item.parentReference?.id,
    webUrl: item.webUrl,
    downloadUrl: item['@microsoft.graph.downloadUrl'],
    thumbnailUrl: item.thumbnails?.[0]?.large?.url,
    isFolder: !!item.folder,
    provider: 'microsoft',
    connectionId,
    metadata: {},
  };
}

/** Selected fields for OneDrive listing requests. */
const DRIVE_ITEM_SELECT = 'id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,parentReference,@microsoft.graph.downloadUrl,thumbnails';

/**
 * List items in a OneDrive folder (or root).
 * Uses `/me/drive/root/children` for root, `/me/drive/items/{id}/children` for subfolders.
 * When a pageToken (nextLink URL) is provided, it is used directly.
 */
export async function listDriveItems(
  accessToken: string,
  connectionId: string,
  folderId?: string,
  pageToken?: string,
): Promise<DriveListResult> {
  let url: string;

  if (pageToken) {
    url = pageToken;
  } else if (folderId) {
    url = `${GRAPH_BASE_URL}/me/drive/items/${folderId}/children?$select=${DRIVE_ITEM_SELECT}&$top=100`;
  } else {
    url = `${GRAPH_BASE_URL}/me/drive/root/children?$select=${DRIVE_ITEM_SELECT}&$top=100`;
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] OneDrive list failed:', { status: response.status, error: errorText });
    throw new OAuthError('Failed to list drive items', 'FILES_LIST_FAILED', 'microsoft', response.status);
  }

  const data = (await response.json()) as MicrosoftDriveListResponse;

  return {
    files: data.value.map((item) => mapDriveItem(item, connectionId)),
    nextPageToken: data['@odata.nextLink'],
    totalCount: data['@odata.count'],
  };
}

/**
 * Search items across a OneDrive.
 * Uses `/me/drive/root/search(q='{query}')`.
 * When a pageToken (nextLink URL) is provided, it is used directly.
 */
export async function searchDriveItems(
  accessToken: string,
  connectionId: string,
  query: string,
  pageToken?: string,
): Promise<DriveListResult> {
  let url: string;

  if (pageToken) {
    url = pageToken;
  } else {
    // Escape single quotes in the query to prevent query injection
    const safeQuery = query.replace(/'/g, "''");
    url = `${GRAPH_BASE_URL}/me/drive/root/search(q='${safeQuery}')?$select=${DRIVE_ITEM_SELECT}&$top=50`;
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] OneDrive search failed:', { status: response.status, error: errorText });
    throw new OAuthError('Failed to search drive items', 'FILES_SEARCH_FAILED', 'microsoft', response.status);
  }

  const data = (await response.json()) as MicrosoftDriveListResponse;

  return {
    files: data.value.map((item) => mapDriveItem(item, connectionId)),
    nextPageToken: data['@odata.nextLink'],
    totalCount: data['@odata.count'],
  };
}

/**
 * Get metadata for a single OneDrive item, including download URL.
 * Uses `/me/drive/items/{itemId}`.
 */
export async function getDriveItem(
  accessToken: string,
  connectionId: string,
  itemId: string,
): Promise<DriveFile> {
  const url = `${GRAPH_BASE_URL}/me/drive/items/${itemId}?$select=${DRIVE_ITEM_SELECT}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] OneDrive get item failed:', { status: response.status, error: errorText });

    if (response.status === 404) {
      throw new OAuthError('Drive item not found', 'FILE_NOT_FOUND', 'microsoft', 404);
    }

    throw new OAuthError('Failed to get drive item', 'FILE_FETCH_FAILED', 'microsoft', response.status);
  }

  const data = (await response.json()) as MicrosoftDriveItem;
  return mapDriveItem(data, connectionId);
}
