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
};

// Full scopes including email and calendar
export const FULL_SCOPES: Record<OAuthProvider, string[]> = {
  microsoft: [MICROSOFT_SCOPES.contacts, MICROSOFT_SCOPES.email, MICROSOFT_SCOPES.calendar, MICROSOFT_SCOPES.profile, MICROSOFT_SCOPES.offline],
  google: [GOOGLE_SCOPES.contacts, GOOGLE_SCOPES.email, GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.profile],
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
  const clientId = getEnvVarWithFallback('MS365_CLIENT_ID', 'AZURE_CLIENT_ID');
  const clientSecret = getEnvVarWithFallback('MS365_CLIENT_SECRET', 'AZURE_CLIENT_SECRET');
  const redirectUri = getEnvVar('MS365_REDIRECT_URI') || getEnvVar('OAUTH_REDIRECT_URI');
  const tenantId = getEnvVar('AZURE_TENANT_ID');

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri: redirectUri || 'http://localhost:3000/api/oauth/callback',
    scopes: DEFAULT_SCOPES.microsoft,
    tenantId,
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
  const clientId = getEnvVarWithFallback('GOOGLE_CLIENT_ID', 'GOOGLE_CLOUD_CLIENT_ID');
  const clientSecret = getEnvVarWithFallback('GOOGLE_CLIENT_SECRET', 'GOOGLE_CLOUD_CLIENT_SECRET');
  const redirectUri = getEnvVar('GOOGLE_REDIRECT_URI') || getEnvVar('OAUTH_REDIRECT_URI');

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri: redirectUri || 'http://localhost:3000/api/oauth/callback',
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
  return providers;
}

/**
 * Return a summary of which providers are configured.
 */
export function getConfigSummary(): {
  microsoft: { configured: boolean };
  google: { configured: boolean };
} {
  return {
    microsoft: { configured: isProviderConfigured('microsoft') },
    google: { configured: isProviderConfigured('google') },
  };
}
