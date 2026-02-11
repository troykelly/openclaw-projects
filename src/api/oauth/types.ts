/**
 * OAuth types and interfaces.
 * Part of Issue #206.
 */

export type OAuthProvider = 'google' | 'microsoft';

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
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
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
  constructor(provider: OAuthProvider, userEmail: string) {
    super(`No OAuth connection found for ${userEmail} with provider ${provider}`, 'NO_CONNECTION', provider, 404);
    this.name = 'NoConnectionError';
  }
}

export class InvalidStateError extends OAuthError {
  constructor() {
    super('Invalid or expired OAuth state', 'INVALID_STATE', undefined, 400);
    this.name = 'InvalidStateError';
  }
}
