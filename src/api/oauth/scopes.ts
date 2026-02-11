/**
 * Feature-to-scope mapping for granular OAuth permissions.
 * Part of Issue #1050.
 *
 * Maps each OAuthFeature + permissionLevel to the required OAuth scopes
 * for each provider. Used to build incremental authorization URLs.
 */

import type { OAuthProvider, OAuthFeature, OAuthPermissionLevel } from './types.ts';

/**
 * Scope definitions per provider, feature, and permission level.
 *
 * Each entry maps a feature to its read-only and read_write scopes.
 * The read_write scopes are additive — they include what's needed for write
 * on top of any read scopes the provider requires.
 */
const SCOPE_MAP: Record<OAuthProvider, Record<OAuthFeature, { read: string[]; read_write: string[] }>> = {
  google: {
    contacts: {
      read: ['https://www.googleapis.com/auth/contacts.readonly'],
      read_write: ['https://www.googleapis.com/auth/contacts'],
    },
    email: {
      read: ['https://www.googleapis.com/auth/gmail.readonly'],
      read_write: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
    },
    files: {
      read: ['https://www.googleapis.com/auth/drive.readonly'],
      read_write: ['https://www.googleapis.com/auth/drive.file'],
    },
    calendar: {
      read: ['https://www.googleapis.com/auth/calendar.readonly'],
      read_write: ['https://www.googleapis.com/auth/calendar'],
    },
  },
  microsoft: {
    contacts: {
      read: ['https://graph.microsoft.com/Contacts.Read'],
      read_write: ['https://graph.microsoft.com/Contacts.ReadWrite'],
    },
    email: {
      read: ['https://graph.microsoft.com/Mail.Read'],
      read_write: ['https://graph.microsoft.com/Mail.ReadWrite'],
    },
    files: {
      read: ['https://graph.microsoft.com/Files.Read'],
      read_write: ['https://graph.microsoft.com/Files.ReadWrite'],
    },
    calendar: {
      read: ['https://graph.microsoft.com/Calendars.Read'],
      read_write: ['https://graph.microsoft.com/Calendars.ReadWrite'],
    },
  },
};

/**
 * Base scopes always requested regardless of features.
 * These are required for basic authentication and token refresh.
 */
const BASE_SCOPES: Record<OAuthProvider, string[]> = {
  google: ['https://www.googleapis.com/auth/userinfo.email'],
  microsoft: ['https://graph.microsoft.com/User.Read', 'offline_access'],
};

/**
 * Compute the full set of OAuth scopes required for the given features and permission level.
 *
 * Always includes base scopes (profile/offline). Deduplicates the result.
 */
export function getRequiredScopes(
  provider: OAuthProvider,
  features: OAuthFeature[],
  permissionLevel: OAuthPermissionLevel = 'read',
): string[] {
  const scopes = new Set<string>(BASE_SCOPES[provider]);

  for (const feature of features) {
    const featureScopes = SCOPE_MAP[provider][feature];
    for (const scope of featureScopes[permissionLevel]) {
      scopes.add(scope);
    }
  }

  return [...scopes];
}

/**
 * Determine which scopes are missing compared to what a connection already has.
 *
 * Returns the list of scopes that need to be requested via re-authorization.
 * An empty array means no re-auth is needed.
 */
export function getMissingScopes(
  currentScopes: string[],
  requiredScopes: string[],
): string[] {
  const current = new Set(currentScopes);
  return requiredScopes.filter((s) => !current.has(s));
}
