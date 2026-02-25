/**
 * OAuth types and interfaces.
 * Part of Issue #206, updated in Issue #1045 for multi-account support.
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 */

export type OAuthProvider = 'google' | 'microsoft' | 'home_assistant';

/** Permission levels for OAuth connections. */
export type OAuthPermissionLevel = 'read' | 'read_write';

/** Valid features that can be enabled on an OAuth connection. */
export const ALLOWED_FEATURES = ['contacts', 'email', 'files', 'calendar'] as const;
export type OAuthFeature = (typeof ALLOWED_FEATURES)[number];

export interface OAuthConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  scopes: string[];
  /** Microsoft Azure AD tenant ID. When set, tenant-specific endpoints are used instead of /common/. */
  tenant_id?: string;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: Date;
  token_type: string;
  scopes: string[];
}

export interface OAuthConnection {
  id: string;
  user_email: string;
  provider: OAuthProvider;
  access_token: string;
  refresh_token?: string;
  scopes: string[];
  expires_at?: Date;
  token_metadata: Record<string, unknown>;
  /** User-defined label for this connection (e.g. "Work Gmail"). */
  label: string;
  /** Provider-side unique account identifier. */
  provider_account_id?: string;
  /** Email address of the connected provider account. */
  provider_account_email?: string;
  /** User-chosen access level: read-only or read-write. */
  permission_level: OAuthPermissionLevel;
  /** Active feature flags: contacts, email, files, calendar. */
  enabled_features: OAuthFeature[];
  /** Soft disable toggle — false disables sync without disconnecting. */
  is_active: boolean;
  /** Timestamp of last completed sync of any type. */
  last_sync_at?: Date;
  /** Per-feature sync tracking. */
  sync_status: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/** Fields that can be updated on an existing connection. */
export interface OAuthConnectionUpdate {
  label?: string;
  permission_level?: OAuthPermissionLevel;
  enabled_features?: OAuthFeature[];
  is_active?: boolean;
}

export interface OAuthAuthorizationUrl {
  url: string;
  state: string;
  provider: OAuthProvider;
  scopes: string[];
  code_verifier: string; // PKCE code verifier (store server-side)
}

export interface OAuthStateData {
  provider: OAuthProvider;
  code_verifier: string;
  scopes: string[];
  user_email?: string;
  redirect_path?: string;
  created_at: Date;
  expires_at: Date;
}

export interface OAuthCallbackResult {
  provider: OAuthProvider;
  user_email: string;
  tokens: OAuthTokens;
}

export interface ProviderContact {
  id: string;
  display_name?: string;
  given_name?: string;
  family_name?: string;
  email_addresses: string[];
  phone_numbers: string[];
  company?: string;
  job_title?: string;
  metadata: Record<string, unknown>;
}

export interface ContactSyncResult {
  provider: OAuthProvider;
  user_email: string;
  synced_count: number;
  created_count: number;
  updated_count: number;
  sync_cursor?: string;
}

export interface SyncProgress {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  provider: OAuthProvider;
  user_email: string;
  progress?: number;
  total_items?: number;
  processed_items?: number;
  error?: string;
  started_at?: Date;
  completed_at?: Date;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: OAuthProvider,
    public status_code: number = 400,
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
  constructor(provider: OAuthProvider, user_email: string);
  constructor(connection_id: string);
  constructor(providerOrId: OAuthProvider | string, user_email?: string) {
    if (user_email !== undefined) {
      super(`No OAuth connection found for ${user_email} with provider ${providerOrId}`, 'NO_CONNECTION', providerOrId as OAuthProvider, 404);
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
