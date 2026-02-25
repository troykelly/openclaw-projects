/**
 * OAuth configuration from environment variables.
 *
 * Supports fallback env var names so the same config works whether
 * credentials are supplied under the canonical names (MS365_*, GOOGLE_*)
 * or the names injected by the devcontainer (AZURE_*, GOOGLE_CLOUD_*).
 *
 * Part of Issue #206, updated in Issue #1047.
 */

import type { OAuthConfig, OAuthProvider } from './types.ts';
import { ProviderNotConfiguredError } from './types.ts';

// Microsoft OAuth scopes
export const MICROSOFT_SCOPES = {
  contacts: 'https://graph.microsoft.com/Contacts.Read',
  email: 'https://graph.microsoft.com/Mail.Read',
  emailSend: 'https://graph.microsoft.com/Mail.Send',
  files: 'https://graph.microsoft.com/Files.Read',
  calendar: 'https://graph.microsoft.com/Calendars.Read',
  profile: 'https://graph.microsoft.com/User.Read',
  offline: 'offline_access',
} as const;

// Google OAuth scopes
export const GOOGLE_SCOPES = {
  contacts: 'https://www.googleapis.com/auth/contacts.readonly',
  email: 'https://www.googleapis.com/auth/gmail.readonly',
  emailSend: 'https://www.googleapis.com/auth/gmail.send',
  files: 'https://www.googleapis.com/auth/drive.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  profile: 'https://www.googleapis.com/auth/userinfo.email',
} as const;

// Default scopes for contact sync
export const DEFAULT_SCOPES: Record<OAuthProvider, string[]> = {
  microsoft: [MICROSOFT_SCOPES.contacts, MICROSOFT_SCOPES.profile, MICROSOFT_SCOPES.offline],
  google: [GOOGLE_SCOPES.contacts, GOOGLE_SCOPES.profile],
  home_assistant: [], // HA doesn't use scopes — IndieAuth
};

// Full scopes including email and calendar
export const FULL_SCOPES: Record<OAuthProvider, string[]> = {
  microsoft: [MICROSOFT_SCOPES.contacts, MICROSOFT_SCOPES.email, MICROSOFT_SCOPES.calendar, MICROSOFT_SCOPES.profile, MICROSOFT_SCOPES.offline],
  google: [GOOGLE_SCOPES.contacts, GOOGLE_SCOPES.email, GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.profile],
  home_assistant: [],
};

function getEnvVar(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/**
 * Return the first defined env var value from the given names.
 * Used to implement fallback chains (e.g. `MS365_CLIENT_ID` -> `AZURE_CLIENT_ID`).
 */
function getEnvVarWithFallback(...names: string[]): string | undefined {
  for (const name of names) {
    const value = getEnvVar(name);
    if (value) return value;
  }
  return undefined;
}

/**
 * Load Microsoft OAuth configuration from environment variables.
 *
 * Env var fallback chain (first non-empty value wins):
 * - Client ID: `MS365_CLIENT_ID` -> `AZURE_CLIENT_ID`
 * - Client secret: `MS365_CLIENT_SECRET` -> `AZURE_CLIENT_SECRET`
 * - Redirect URI: `MS365_REDIRECT_URI` -> `OAUTH_REDIRECT_URI` -> default
 * - Tenant ID: `AZURE_TENANT_ID` (optional; when set, uses tenant-specific Azure AD endpoints)
 *
 * Returns `null` if neither client ID nor client secret can be resolved.
 */
export function getMicrosoftConfig(): OAuthConfig | null {
  const client_id = getEnvVarWithFallback('MS365_CLIENT_ID', 'AZURE_CLIENT_ID');
  const client_secret = getEnvVarWithFallback('MS365_CLIENT_SECRET', 'AZURE_CLIENT_SECRET');
  const redirect_uri = getEnvVar('MS365_REDIRECT_URI') || getEnvVar('OAUTH_REDIRECT_URI');
  const tenant_id = getEnvVar('AZURE_TENANT_ID');

  if (!client_id || !client_secret) {
    return null;
  }

  return {
    client_id,
    client_secret,
    redirect_uri: redirect_uri || 'http://localhost:3000/api/oauth/callback',
    scopes: DEFAULT_SCOPES.microsoft,
    tenant_id,
  };
}

/**
 * Load Google OAuth configuration from environment variables.
 *
 * Env var fallback chain (first non-empty value wins):
 * - Client ID: `GOOGLE_CLIENT_ID` -> `GOOGLE_CLOUD_CLIENT_ID`
 * - Client secret: `GOOGLE_CLIENT_SECRET` -> `GOOGLE_CLOUD_CLIENT_SECRET`
 * - Redirect URI: `GOOGLE_REDIRECT_URI` -> `OAUTH_REDIRECT_URI` -> default
 *
 * Returns `null` if neither client ID nor client secret can be resolved.
 */
export function getGoogleConfig(): OAuthConfig | null {
  const client_id = getEnvVarWithFallback('GOOGLE_CLIENT_ID', 'GOOGLE_CLOUD_CLIENT_ID');
  const client_secret = getEnvVarWithFallback('GOOGLE_CLIENT_SECRET', 'GOOGLE_CLOUD_CLIENT_SECRET');
  const redirect_uri = getEnvVar('GOOGLE_REDIRECT_URI') || getEnvVar('OAUTH_REDIRECT_URI');

  if (!client_id || !client_secret) {
    return null;
  }

  return {
    client_id,
    client_secret,
    redirect_uri: redirect_uri || 'http://localhost:3000/api/oauth/callback',
    scopes: DEFAULT_SCOPES.google,
  };
}

/**
 * Get the OAuth config for a specific provider.
 * Returns `null` if the provider is not configured.
 */
export function getProviderConfig(provider: OAuthProvider): OAuthConfig | null {
  switch (provider) {
    case 'microsoft':
      return getMicrosoftConfig();
    case 'google':
      return getGoogleConfig();
    case 'home_assistant':
      return null; // HA doesn't use centralized config — per-instance
    default:
      return null;
  }
}

/**
 * Get the OAuth config for a provider, throwing if not configured.
 * @throws {ProviderNotConfiguredError} when the provider has no credentials.
 */
export function requireProviderConfig(provider: OAuthProvider): OAuthConfig {
  const config = getProviderConfig(provider);
  if (!config) {
    throw new ProviderNotConfiguredError(provider);
  }
  return config;
}

/**
 * Check whether a provider has enough env vars to be usable.
 */
export function isProviderConfigured(provider: OAuthProvider): boolean {
  return getProviderConfig(provider) !== null;
}

/**
 * Return the list of providers that are currently configured.
 */
export function getConfiguredProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (isProviderConfigured('microsoft')) providers.push('microsoft');
  if (isProviderConfigured('google')) providers.push('google');
  // HA is intentionally excluded — it uses its own authorize endpoint
  // (/api/geolocation/providers/ha/authorize) and geolocation crypto,
  // not the generic OAuth flow or OAUTH_TOKEN_ENCRYPTION_KEY.
  return providers;
}

/**
 * Return a summary of which providers are configured.
 */
export function getConfigSummary(): Record<string, { configured: boolean }> {
  return {
    microsoft: { configured: isProviderConfigured('microsoft') },
    google: { configured: isProviderConfigured('google') },
    // HA not listed — uses its own authorize endpoint, not generic OAuth
  };
}
