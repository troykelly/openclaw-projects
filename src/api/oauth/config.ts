/**
 * OAuth configuration from environment variables.
 * Part of Issue #206.
 */

import type { OAuthConfig, OAuthProvider } from './types.ts';
import { ProviderNotConfiguredError } from './types.ts';

// Microsoft OAuth scopes
export const MICROSOFT_SCOPES = {
  contacts: 'https://graph.microsoft.com/Contacts.Read',
  email: 'https://graph.microsoft.com/Mail.Read',
  emailSend: 'https://graph.microsoft.com/Mail.Send',
  calendar: 'https://graph.microsoft.com/Calendars.Read',
  profile: 'https://graph.microsoft.com/User.Read',
  offline: 'offline_access',
} as const;

// Google OAuth scopes
export const GOOGLE_SCOPES = {
  contacts: 'https://www.googleapis.com/auth/contacts.readonly',
  email: 'https://www.googleapis.com/auth/gmail.readonly',
  emailSend: 'https://www.googleapis.com/auth/gmail.send',
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  profile: 'https://www.googleapis.com/auth/userinfo.email',
} as const;

// Default scopes for contact sync
export const DEFAULT_SCOPES: Record<OAuthProvider, string[]> = {
  microsoft: [
    MICROSOFT_SCOPES.contacts,
    MICROSOFT_SCOPES.profile,
    MICROSOFT_SCOPES.offline,
  ],
  google: [
    GOOGLE_SCOPES.contacts,
    GOOGLE_SCOPES.profile,
  ],
};

// Full scopes including email and calendar
export const FULL_SCOPES: Record<OAuthProvider, string[]> = {
  microsoft: [
    MICROSOFT_SCOPES.contacts,
    MICROSOFT_SCOPES.email,
    MICROSOFT_SCOPES.calendar,
    MICROSOFT_SCOPES.profile,
    MICROSOFT_SCOPES.offline,
  ],
  google: [
    GOOGLE_SCOPES.contacts,
    GOOGLE_SCOPES.email,
    GOOGLE_SCOPES.calendar,
    GOOGLE_SCOPES.profile,
  ],
};

function getEnvVar(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function getRequiredEnvVar(name: string, provider: OAuthProvider): string {
  const value = getEnvVar(name);
  if (!value) {
    throw new ProviderNotConfiguredError(provider);
  }
  return value;
}

export function getMicrosoftConfig(): OAuthConfig | null {
  const clientId = getEnvVar('MS365_CLIENT_ID');
  const clientSecret = getEnvVar('MS365_CLIENT_SECRET');
  const redirectUri = getEnvVar('MS365_REDIRECT_URI') || getEnvVar('OAUTH_REDIRECT_URI');

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri: redirectUri || 'http://localhost:3000/api/oauth/callback',
    scopes: DEFAULT_SCOPES.microsoft,
  };
}

export function getGoogleConfig(): OAuthConfig | null {
  const clientId = getEnvVar('GOOGLE_CLIENT_ID');
  const clientSecret = getEnvVar('GOOGLE_CLIENT_SECRET');
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

export function requireProviderConfig(provider: OAuthProvider): OAuthConfig {
  const config = getProviderConfig(provider);
  if (!config) {
    throw new ProviderNotConfiguredError(provider);
  }
  return config;
}

export function isProviderConfigured(provider: OAuthProvider): boolean {
  return getProviderConfig(provider) !== null;
}

export function getConfiguredProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (isProviderConfigured('microsoft')) providers.push('microsoft');
  if (isProviderConfigured('google')) providers.push('google');
  return providers;
}

export function getConfigSummary(): {
  microsoft: { configured: boolean };
  google: { configured: boolean };
} {
  return {
    microsoft: { configured: isProviderConfigured('microsoft') },
    google: { configured: isProviderConfigured('google') },
  };
}
