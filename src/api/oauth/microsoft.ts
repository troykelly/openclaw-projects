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
function getAuthorizeUrl(tenant_id?: string): string {
  const tenant = tenant_id || 'common';
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
}

/**
 * Build the Azure AD token endpoint for a given tenant.
 * Falls back to `/common/` (multi-tenant) when no tenant ID is provided.
 */
function getTokenUrl(tenant_id?: string): string {
  const tenant = tenant_id || 'common';
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
  display_name?: string;
}

interface MicrosoftContactResponse {
  id: string;
  display_name?: string;
  given_name?: string;
  surname?: string;
  email_addresses?: Array<{ address: string; name?: string }>;
  businessPhones?: string[];
  mobilePhone?: string;
  homePhones?: string[];
  companyName?: string;
  job_title?: string;
}

interface MicrosoftContactsResponse {
  '@odata.deltaLink'?: string;
  '@odata.nextLink'?: string;
  value: MicrosoftContactResponse[];
}

export function buildAuthorizationUrl(config: OAuthConfig, state: string, scopes?: string[]): OAuthAuthorizationUrl {
  const effectiveScopes = scopes || config.scopes;
  const code_verifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(code_verifier);

  const params = new URLSearchParams({
    client_id: config.client_id,
    response_type: 'code',
    redirect_uri: config.redirect_uri,
    response_mode: 'query',
    scope: effectiveScopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `${getAuthorizeUrl(config.tenant_id)}?${params.toString()}`,
    state,
    provider: 'microsoft',
    scopes: effectiveScopes,
    code_verifier,
  };
}

export async function exchangeCodeForTokens(code: string, config?: OAuthConfig, code_verifier?: string): Promise<OAuthTokens> {
  const effectiveConfig = config || requireProviderConfig('microsoft');

  const params = new URLSearchParams({
    client_id: effectiveConfig.client_id,
    client_secret: effectiveConfig.client_secret,
    code,
    redirect_uri: effectiveConfig.redirect_uri,
    grant_type: 'authorization_code',
  });

  // Include PKCE code_verifier if provided
  if (code_verifier) {
    params.set('code_verifier', code_verifier);
  }

  const response = await fetch(getTokenUrl(effectiveConfig.tenant_id), {
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
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000),
    token_type: data.token_type,
    scopes: data.scope.split(' '),
  };
}

export async function refreshAccessToken(refresh_token: string, config?: OAuthConfig): Promise<OAuthTokens> {
  const effectiveConfig = config || requireProviderConfig('microsoft');

  const params = new URLSearchParams({
    client_id: effectiveConfig.client_id,
    client_secret: effectiveConfig.client_secret,
    refresh_token: refresh_token,
    grant_type: 'refresh_token',
  });

  const response = await fetch(getTokenUrl(effectiveConfig.tenant_id), {
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
    access_token: data.access_token,
    refresh_token: data.refresh_token || refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000),
    token_type: data.token_type,
    scopes: data.scope.split(' '),
  };
}

export async function getUserEmail(access_token: string): Promise<string> {
  const response = await fetch(`${GRAPH_BASE_URL}/me`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
  });

  if (!response.ok) {
    throw new OAuthError('Failed to get user profile', 'PROFILE_FETCH_FAILED', 'microsoft', response.status);
  }

  const data = (await response.json()) as MicrosoftUserResponse;
  return data.mail || data.userPrincipalName;
}

function mapMicrosoftContact(contact: MicrosoftContactResponse): ProviderContact {
  const phone_numbers: string[] = [];
  if (contact.mobilePhone) phone_numbers.push(contact.mobilePhone);
  if (contact.businessPhones) phone_numbers.push(...contact.businessPhones);
  if (contact.homePhones) phone_numbers.push(...contact.homePhones);

  return {
    id: contact.id,
    display_name: contact.display_name,
    given_name: contact.given_name,
    family_name: contact.surname,
    email_addresses: contact.email_addresses?.map((e) => e.address) || [],
    phone_numbers,
    company: contact.companyName,
    job_title: contact.job_title,
    metadata: {
      provider: 'microsoft',
      rawContact: contact,
    },
  };
}

export async function fetchContacts(
  access_token: string,
  options?: { deltaLink?: string; pageSize?: number },
): Promise<{ contacts: ProviderContact[]; deltaLink?: string; nextLink?: string }> {
  let url: string;

  if (options?.deltaLink) {
    url = options.deltaLink;
  } else {
    const params = new URLSearchParams({
      $top: String(options?.pageSize || 100),
      $select: 'id,display_name,given_name,surname,email_addresses,businessPhones,mobilePhone,homePhones,companyName,job_title',
    });
    url = `${GRAPH_BASE_URL}/me/contacts/delta?${params.toString()}`;
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${access_token}`,
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

export async function fetchAllContacts(access_token: string, sync_cursor?: string): Promise<{ contacts: ProviderContact[]; sync_cursor?: string }> {
  const allContacts: ProviderContact[] = [];
  let nextLink: string | undefined;
  let deltaLink: string | undefined = sync_cursor;

  // First request
  const firstResult = await fetchContacts(access_token, { deltaLink: sync_cursor });
  allContacts.push(...firstResult.contacts);
  nextLink = firstResult.nextLink;
  deltaLink = firstResult.deltaLink;

  // Follow pagination
  while (nextLink) {
    const response = await fetch(nextLink, {
      headers: {
        Authorization: `Bearer ${access_token}`,
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
    sync_cursor: deltaLink,
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
  web_url?: string;
  file?: { mimeType: string };
  folder?: { childCount: number };
  parentReference?: { id?: string; path?: string };
  '@microsoft.graph.download_url'?: string;
  thumbnails?: Array<{ large?: { url?: string } }>;
}

interface MicrosoftDriveListResponse {
  value: MicrosoftDriveItem[];
  '@odata.nextLink'?: string;
  '@odata.count'?: number;
}

/** Map a Microsoft Graph DriveItem to the normalized DriveFile interface. */
function mapDriveItem(item: MicrosoftDriveItem, connection_id: string): DriveFile {
  return {
    id: item.id,
    name: item.name,
    mime_type: item.file?.mimeType || (item.folder ? 'application/vnd.microsoft-folder' : 'application/octet-stream'),
    size: item.size,
    created_at: item.createdDateTime ? new Date(item.createdDateTime) : undefined,
    modified_at: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : undefined,
    path: item.parentReference?.path,
    parent_id: item.parentReference?.id,
    web_url: item.web_url,
    download_url: item['@microsoft.graph.download_url'],
    thumbnail_url: item.thumbnails?.[0]?.large?.url,
    is_folder: !!item.folder,
    provider: 'microsoft',
    connection_id,
    metadata: {},
  };
}

/** Selected fields for OneDrive listing requests. */
const DRIVE_ITEM_SELECT = 'id,name,size,createdDateTime,lastModifiedDateTime,web_url,file,folder,parentReference,@microsoft.graph.download_url,thumbnails';

/**
 * List items in a OneDrive folder (or root).
 * Uses `/me/drive/root/children` for root, `/me/drive/items/{id}/children` for subfolders.
 * When a page_token (nextLink URL) is provided, it is used directly.
 */
export async function listDriveItems(
  access_token: string,
  connection_id: string,
  folder_id?: string,
  page_token?: string,
): Promise<DriveListResult> {
  let url: string;

  if (page_token) {
    url = page_token;
  } else if (folder_id) {
    url = `${GRAPH_BASE_URL}/me/drive/items/${folder_id}/children?$select=${DRIVE_ITEM_SELECT}&$top=100`;
  } else {
    url = `${GRAPH_BASE_URL}/me/drive/root/children?$select=${DRIVE_ITEM_SELECT}&$top=100`;
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] OneDrive list failed:', { status: response.status, error: errorText });
    throw new OAuthError('Failed to list drive items', 'FILES_LIST_FAILED', 'microsoft', response.status);
  }

  const data = (await response.json()) as MicrosoftDriveListResponse;

  return {
    files: data.value.map((item) => mapDriveItem(item, connection_id)),
    next_page_token: data['@odata.nextLink'],
    total_count: data['@odata.count'],
  };
}

/**
 * Search items across a OneDrive.
 * Uses `/me/drive/root/search(q='{query}')`.
 * When a page_token (nextLink URL) is provided, it is used directly.
 */
export async function searchDriveItems(
  access_token: string,
  connection_id: string,
  query: string,
  page_token?: string,
): Promise<DriveListResult> {
  let url: string;

  if (page_token) {
    url = page_token;
  } else {
    // Escape single quotes in the query to prevent query injection
    const safeQuery = query.replace(/'/g, "''");
    url = `${GRAPH_BASE_URL}/me/drive/root/search(q='${safeQuery}')?$select=${DRIVE_ITEM_SELECT}&$top=50`;
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] OneDrive search failed:', { status: response.status, error: errorText });
    throw new OAuthError('Failed to search drive items', 'FILES_SEARCH_FAILED', 'microsoft', response.status);
  }

  const data = (await response.json()) as MicrosoftDriveListResponse;

  return {
    files: data.value.map((item) => mapDriveItem(item, connection_id)),
    next_page_token: data['@odata.nextLink'],
    total_count: data['@odata.count'],
  };
}

/**
 * Get metadata for a single OneDrive item, including download URL.
 * Uses `/me/drive/items/{item_id}`.
 */
export async function getDriveItem(
  access_token: string,
  connection_id: string,
  item_id: string,
): Promise<DriveFile> {
  const url = `${GRAPH_BASE_URL}/me/drive/items/${item_id}?$select=${DRIVE_ITEM_SELECT}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
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
  return mapDriveItem(data, connection_id);
}
