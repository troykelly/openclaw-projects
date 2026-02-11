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
  scopes?: string[],
  opts?: { includeGrantedScopes?: boolean },
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
    codeVerifier,
  };
}

export async function exchangeCodeForTokens(code: string, config?: OAuthConfig, codeVerifier?: string): Promise<OAuthTokens> {
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
    throw new OAuthError('Failed to complete OAuth authorization', 'TOKEN_EXCHANGE_FAILED', 'google', response.status);
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

export async function refreshAccessToken(refreshToken: string, config?: OAuthConfig): Promise<OAuthTokens> {
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
    throw new OAuthError('Failed to get user profile', 'PROFILE_FETCH_FAILED', 'google', response.status);
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
  options?: { syncToken?: string; pageToken?: string; pageSize?: number },
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
      throw new OAuthError('Sync token expired, full sync required', 'SYNC_TOKEN_EXPIRED', 'google', 410);
    }

    throw new OAuthError('Failed to fetch contacts', 'CONTACTS_FETCH_FAILED', 'google', response.status);
  }

  const data = (await response.json()) as GoogleConnectionsResponse;

  return {
    contacts: (data.connections || []).map(mapGoogleContact),
    nextPageToken: data.nextPageToken,
    syncToken: data.nextSyncToken,
  };
}

export async function fetchAllContacts(accessToken: string, syncCursor?: string): Promise<{ contacts: ProviderContact[]; syncCursor?: string }> {
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
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

/** Map a Google Drive file resource to the normalized DriveFile interface. */
function mapGoogleDriveFile(file: GoogleDriveFileResource, connectionId: string): DriveFile {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? parseInt(file.size, 10) : undefined,
    createdAt: file.createdTime ? new Date(file.createdTime) : undefined,
    modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
    parentId: file.parents?.[0],
    webUrl: file.webViewLink,
    downloadUrl: file.webContentLink,
    thumbnailUrl: file.thumbnailLink,
    isFolder: file.mimeType === GOOGLE_FOLDER_MIME,
    provider: 'google',
    connectionId,
    metadata: {},
  };
}

/**
 * List files in a Google Drive folder (or root).
 * Uses the Drive API v3 `/files` endpoint with a `parents` query filter.
 */
export async function listDriveFiles(
  accessToken: string,
  connectionId: string,
  folderId?: string,
  pageToken?: string,
): Promise<DriveListResult> {
  const parentId = folderId || 'root';
  const q = `'${parentId}' in parents and trashed=false`;

  const params = new URLSearchParams({
    q,
    fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
    pageSize: '100',
    orderBy: 'folder,name',
  });

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  const url = `${DRIVE_API_BASE}/files?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Google Drive list failed:', { status: response.status, error: errorText });
    throw new OAuthError('Failed to list drive files', 'FILES_LIST_FAILED', 'google', response.status);
  }

  const data = (await response.json()) as GoogleDriveListResponse;

  return {
    files: data.files.map((f) => mapGoogleDriveFile(f, connectionId)),
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Search files across a Google Drive.
 * Uses the Drive API v3 `/files` endpoint with a `fullText contains` query.
 */
export async function searchDriveFiles(
  accessToken: string,
  connectionId: string,
  query: string,
  pageToken?: string,
): Promise<DriveListResult> {
  const q = `fullText contains '${query}' and trashed=false`;

  const params = new URLSearchParams({
    q,
    fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
    pageSize: '50',
  });

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  const url = `${DRIVE_API_BASE}/files?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth] Google Drive search failed:', { status: response.status, error: errorText });
    throw new OAuthError('Failed to search drive files', 'FILES_SEARCH_FAILED', 'google', response.status);
  }

  const data = (await response.json()) as GoogleDriveListResponse;

  return {
    files: data.files.map((f) => mapGoogleDriveFile(f, connectionId)),
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Get metadata for a single Google Drive file, including download/export links.
 * Uses the Drive API v3 `/files/{fileId}` endpoint.
 */
export async function getDriveFile(
  accessToken: string,
  connectionId: string,
  fileId: string,
): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields: DRIVE_FILE_FIELDS,
  });

  const url = `${DRIVE_API_BASE}/files/${fileId}?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
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
  return mapGoogleDriveFile(data, connectionId);
}
