/**
 * Google OAuth and People API implementation.
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
  display_name?: string;
  given_name?: string;
  family_name?: string;
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
  email_addresses?: GoogleEmailAddress[];
  phone_numbers?: GooglePhoneNumber[];
  organizations?: GoogleOrganization[];
}

interface GoogleConnectionsResponse {
  connections?: GooglePerson[];
  next_page_token?: string;
  nextSyncToken?: string;
  totalPeople?: number;
}

export function buildAuthorizationUrl(
  config: OAuthConfig,
  state: string,
  scopes?: string[],
  opts?: { includeGrantedScopes?: boolean },
): OAuthAuthorizationUrl {
  const effectiveScopes = scopes || config.scopes;
  const code_verifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(code_verifier);

  const params = new URLSearchParams({
    client_id: config.client_id,
    redirect_uri: config.redirect_uri,
    response_type: 'code',
    scope: effectiveScopes.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  // Google supports incremental authorization — existing grants are preserved
  // when include_granted_scopes=true, so only new scopes trigger consent.
  if (opts?.includeGrantedScopes) {
    params.set('include_granted_scopes', 'true');
  }

  return {
    url: `${AUTHORIZE_URL}?${params.toString()}`,
    state,
    provider: 'google',
    scopes: effectiveScopes,
    code_verifier,
  };
}

export async function exchangeCodeForTokens(code: string, config?: OAuthConfig, code_verifier?: string): Promise<OAuthTokens> {
  const effectiveConfig = config || requireProviderConfig('google');

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
    throw new OAuthError('Failed to complete OAuth authorization', 'TOKEN_EXCHANGE_FAILED', 'google', response.status);
  }

  const data = (await response.json()) as GoogleTokenResponse;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000),
    token_type: data.token_type,
    scopes: data.scope.split(' '),
  };
}

export async function refreshAccessToken(refresh_token: string, config?: OAuthConfig): Promise<OAuthTokens> {
  const effectiveConfig = config || requireProviderConfig('google');

  const params = new URLSearchParams({
    client_id: effectiveConfig.client_id,
    client_secret: effectiveConfig.client_secret,
    refresh_token: refresh_token,
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
    access_token: data.access_token,
    refresh_token: refresh_token, // Google doesn't return a new refresh token
    expires_at: new Date(Date.now() + data.expires_in * 1000),
    token_type: data.token_type,
    scopes: data.scope.split(' '),
  };
}

export async function getUserEmail(access_token: string): Promise<string> {
  const response = await fetch(USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
  });

  if (!response.ok) {
    throw new OAuthError('Failed to get user profile', 'PROFILE_FETCH_FAILED', 'google', response.status);
  }

  const data = (await response.json()) as GoogleUserResponse;
  return data.email;
}

function mapGoogleContact(person: GooglePerson): ProviderContact {
  const name = person.names?.[0];
  const emails = person.email_addresses?.map((e) => e.value) || [];
  const phones = person.phone_numbers?.map((p) => p.value) || [];
  const org = person.organizations?.[0];

  // Extract ID from resourceName (e.g., "people/c12345" -> "c12345")
  const id = person.resourceName.replace('people/', '');

  return {
    id,
    display_name: name?.display_name,
    given_name: name?.given_name,
    family_name: name?.family_name,
    email_addresses: emails,
    phone_numbers: phones,
    company: org?.name,
    job_title: org?.title,
    metadata: {
      provider: 'google',
      resourceName: person.resourceName,
    },
  };
}

export async function fetchContacts(
  access_token: string,
  options?: { syncToken?: string; page_token?: string; pageSize?: number },
): Promise<{ contacts: ProviderContact[]; next_page_token?: string; syncToken?: string }> {
  const params = new URLSearchParams({
    personFields: 'names,email_addresses,phone_numbers,organizations',
    pageSize: String(options?.pageSize || 100),
  });

  if (options?.syncToken) {
    params.set('syncToken', options.syncToken);
    params.set('requestSyncToken', 'true');
  } else {
    params.set('requestSyncToken', 'true');
  }

  if (options?.page_token) {
    params.set('page_token', options.page_token);
  }

  const url = `${PEOPLE_API_BASE}/people/me/connections?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
  });

  if (!response.ok) {
    // Handle sync token expired
    if (response.status === 410) {
      // Need to do full sync
      throw new OAuthError('Sync token expired, full sync required', 'SYNC_TOKEN_EXPIRED', 'google', 410);
    }

    throw new OAuthError('Failed to fetch contacts', 'CONTACTS_FETCH_FAILED', 'google', response.status);
  }

  const data = (await response.json()) as GoogleConnectionsResponse;

  return {
    contacts: (data.connections || []).map(mapGoogleContact),
    next_page_token: data.next_page_token,
    syncToken: data.nextSyncToken,
  };
}

export async function fetchAllContacts(access_token: string, sync_cursor?: string): Promise<{ contacts: ProviderContact[]; sync_cursor?: string }> {
  const allContacts: ProviderContact[] = [];
  let page_token: string | undefined;
  let syncToken: string | undefined;

  try {
    // First request
    const firstResult = await fetchContacts(access_token, { syncToken: sync_cursor });
    allContacts.push(...firstResult.contacts);
    page_token = firstResult.next_page_token;
    syncToken = firstResult.syncToken;

    // Follow pagination
    while (page_token) {
      const result = await fetchContacts(access_token, { page_token, syncToken: sync_cursor });
      allContacts.push(...result.contacts);
      page_token = result.next_page_token;
      syncToken = result.syncToken || syncToken;
    }
  } catch (error) {
    // If sync token expired, do full sync without token
    if (error instanceof OAuthError && error.code === 'SYNC_TOKEN_EXPIRED') {
      return fetchAllContacts(access_token, undefined);
    }
    throw error;
  }

  return {
    contacts: allContacts,
    sync_cursor: syncToken,
  };
}

// ==================== Google Drive / Files (Issue #1049) ====================

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Selected fields for Drive API file listing requests. */
const DRIVE_FILE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,parents,iconLink';

/** Shape of a Google Drive API v3 file resource. */
interface GoogleDriveFileResource {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  parents?: string[];
  iconLink?: string;
}

interface GoogleDriveListResponse {
  files: GoogleDriveFileResource[];
  next_page_token?: string;
  incompleteSearch?: boolean;
}

/** Map a Google Drive file resource to the normalized DriveFile interface. */
function mapGoogleDriveFile(file: GoogleDriveFileResource, connection_id: string): DriveFile {
  return {
    id: file.id,
    name: file.name,
    mime_type: file.mimeType,
    size: file.size ? parseInt(file.size, 10) : undefined,
    created_at: file.createdTime ? new Date(file.createdTime) : undefined,
    modified_at: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
    parent_id: file.parents?.[0],
    web_url: file.webViewLink,
    download_url: file.webContentLink,
    thumbnail_url: file.thumbnailLink,
    is_folder: file.mimeType === GOOGLE_FOLDER_MIME,
    provider: 'google',
    connection_id,
    metadata: {},
  };
}

/**
 * List files in a Google Drive folder (or root).
 * Uses the Drive API v3 `/files` endpoint with a `parents` query filter.
 */
export async function listDriveFiles(
  access_token: string,
  connection_id: string,
  folder_id?: string,
  page_token?: string,
): Promise<DriveListResult> {
  const parent_id = folder_id || 'root';
  // Escape single quotes in folder ID to prevent query injection
  const safeParentId = parent_id.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `'${safeParentId}' in parents and trashed=false`;

  const params = new URLSearchParams({
    q,
    fields: `next_page_token,files(${DRIVE_FILE_FIELDS})`,
    pageSize: '100',
    orderBy: 'folder,name',
  });

  if (page_token) {
    params.set('page_token', page_token);
  }

  const url = `${DRIVE_API_BASE}/files?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Google Drive list failed:', { status: response.status, error: errorText });
    throw new OAuthError('Failed to list drive files', 'FILES_LIST_FAILED', 'google', response.status);
  }

  const data = (await response.json()) as GoogleDriveListResponse;

  return {
    files: data.files.map((f) => mapGoogleDriveFile(f, connection_id)),
    next_page_token: data.next_page_token,
  };
}

/**
 * Search files across a Google Drive.
 * Uses the Drive API v3 `/files` endpoint with a `fullText contains` query.
 */
export async function searchDriveFiles(
  access_token: string,
  connection_id: string,
  query: string,
  page_token?: string,
): Promise<DriveListResult> {
  // Escape single quotes in the query to prevent query injection
  const safeQuery = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `fullText contains '${safeQuery}' and trashed=false`;

  const params = new URLSearchParams({
    q,
    fields: `next_page_token,files(${DRIVE_FILE_FIELDS})`,
    pageSize: '50',
  });

  if (page_token) {
    params.set('page_token', page_token);
  }

  const url = `${DRIVE_API_BASE}/files?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Google Drive search failed:', { status: response.status, error: errorText });
    throw new OAuthError('Failed to search drive files', 'FILES_SEARCH_FAILED', 'google', response.status);
  }

  const data = (await response.json()) as GoogleDriveListResponse;

  return {
    files: data.files.map((f) => mapGoogleDriveFile(f, connection_id)),
    next_page_token: data.next_page_token,
  };
}

/**
 * Get metadata for a single Google Drive file, including download/export links.
 * Uses the Drive API v3 `/files/{fileId}` endpoint.
 */
export async function getDriveFile(
  access_token: string,
  connection_id: string,
  fileId: string,
): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields: DRIVE_FILE_FIELDS,
  });

  const url = `${DRIVE_API_BASE}/files/${fileId}?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Google Drive get file failed:', { status: response.status, error: errorText });

    if (response.status === 404) {
      throw new OAuthError('Drive file not found', 'FILE_NOT_FOUND', 'google', 404);
    }

    throw new OAuthError('Failed to get drive file', 'FILE_FETCH_FAILED', 'google', response.status);
  }

  const data = (await response.json()) as GoogleDriveFileResource;
  return mapGoogleDriveFile(data, connection_id);
}
