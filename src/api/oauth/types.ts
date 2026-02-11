/**
 * OAuth types and interfaces.
 * Part of Issue #206, updated in Issue #1045 for multi-account support.
 */

export type OAuthProvider = 'google' | 'microsoft';

/** Permission levels for OAuth connections. */
export type OAuthPermissionLevel = 'read' | 'read_write';

/** Valid features that can be enabled on an OAuth connection. */
export const ALLOWED_FEATURES = ['contacts', 'email', 'files', 'calendar'] as const;
export type OAuthFeature = (typeof ALLOWED_FEATURES)[number];

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  /** Microsoft Azure AD tenant ID. When set, tenant-specific endpoints are used instead of /common/. */
  tenantId?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType: string;
  scopes: string[];
}

export interface OAuthConnection {
  id: string;
  userEmail: string;
  provider: OAuthProvider;
  accessToken: string;
  refreshToken?: string;
  scopes: string[];
  expiresAt?: Date;
  tokenMetadata: Record<string, unknown>;
  /** User-defined label for this connection (e.g. "Work Gmail"). */
  label: string;
  /** Provider-side unique account identifier. */
  providerAccountId?: string;
  /** Email address of the connected provider account. */
  providerAccountEmail?: string;
  /** User-chosen access level: read-only or read-write. */
  permissionLevel: OAuthPermissionLevel;
  /** Active feature flags: contacts, email, files, calendar. */
  enabledFeatures: OAuthFeature[];
  /** Soft disable toggle — false disables sync without disconnecting. */
  isActive: boolean;
  /** Timestamp of last completed sync of any type. */
  lastSyncAt?: Date;
  /** Per-feature sync tracking. */
  syncStatus: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields that can be updated on an existing connection. */
export interface OAuthConnectionUpdate {
  label?: string;
  permissionLevel?: OAuthPermissionLevel;
  enabledFeatures?: OAuthFeature[];
  isActive?: boolean;
}

export interface OAuthAuthorizationUrl {
  url: string;
  state: string;
  provider: OAuthProvider;
  scopes: string[];
  codeVerifier: string; // PKCE code verifier (store server-side)
}

export interface OAuthStateData {
  provider: OAuthProvider;
  codeVerifier: string;
  scopes: string[];
  userEmail?: string;
  redirectPath?: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface OAuthCallbackResult {
  provider: OAuthProvider;
  userEmail: string;
  tokens: OAuthTokens;
}

export interface ProviderContact {
  id: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  emailAddresses: string[];
  phoneNumbers: string[];
  company?: string;
  jobTitle?: string;
  metadata: Record<string, unknown>;
}

export interface ContactSyncResult {
  provider: OAuthProvider;
  userEmail: string;
  syncedCount: number;
  createdCount: number;
  updatedCount: number;
  syncCursor?: string;
}

export interface SyncProgress {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  provider: OAuthProvider;
  userEmail: string;
  progress?: number;
  totalItems?: number;
  processedItems?: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: OAuthProvider,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export class TokenExpiredError extends OAuthError {
  constructor(provider: OAuthProvider) {
    super('Access token has expired', 'TOKEN_EXPIRED', provider, 401);
    this.name = 'TokenExpiredError';
  }
}

export class TokenRefreshError extends OAuthError {
  constructor(provider: OAuthProvider, reason: string) {
    super(`Failed to refresh token: ${reason}`, 'TOKEN_REFRESH_FAILED', provider, 401);
    this.name = 'TokenRefreshError';
  }
}

export class ProviderNotConfiguredError extends OAuthError {
  constructor(provider: OAuthProvider) {
    super(`OAuth provider ${provider} is not configured`, 'PROVIDER_NOT_CONFIGURED', provider, 500);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class NoConnectionError extends OAuthError {
  constructor(provider: OAuthProvider, userEmail: string);
  constructor(connectionId: string);
  constructor(providerOrId: OAuthProvider | string, userEmail?: string) {
    if (userEmail !== undefined) {
      super(`No OAuth connection found for ${userEmail} with provider ${providerOrId}`, 'NO_CONNECTION', providerOrId as OAuthProvider, 404);
    } else {
      super(`No OAuth connection found with id ${providerOrId}`, 'NO_CONNECTION', undefined, 404);
    }
    this.name = 'NoConnectionError';
  }
}

export class InvalidStateError extends OAuthError {
  constructor() {
    super('Invalid or expired OAuth state', 'INVALID_STATE', undefined, 400);
    this.name = 'InvalidStateError';
  }
}
