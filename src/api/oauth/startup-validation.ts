/**
 * OAuth startup validation.
 * Issue #1080: warn when OAuth configured without OAUTH_TOKEN_ENCRYPTION_KEY.
 *
 * At API startup, checks that OAUTH_TOKEN_ENCRYPTION_KEY is set and valid
 * when any OAuth provider is configured. In production, a missing or invalid
 * key is a fatal error. In development, it emits a prominent warning.
 */

import { getConfiguredProviders } from './config.ts';
import { isEncryptionEnabled } from './crypto.ts';

export interface OAuthStartupValidationResult {
  /** True if the server may proceed. False means it should exit. */
  ok: boolean;
  /** Non-fatal warnings (logged but server continues). */
  warnings: string[];
  /** Fatal errors (server should not start). */
  errors: string[];
}

/**
 * Validate the encryption key format without importing getMasterKey
 * (which throws on invalid key).
 * Returns null if valid, or a description of the problem.
 */
function validateKeyFormat(key: string): string | null {
  if (key.length !== 64) {
    return 'OAUTH_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)';
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    return 'OAUTH_TOKEN_ENCRYPTION_KEY must contain only hexadecimal characters';
  }
  return null;
}

/**
 * Validate OAuth startup configuration.
 *
 * Called during server startup to check that encryption is properly
 * configured when OAuth providers are present.
 */
export function validateOAuthStartup(): OAuthStartupValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const providers = getConfiguredProviders();
  if (providers.length === 0) {
    return { ok: true, warnings, errors };
  }

  const providerList = providers.join(', ');
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isEncryptionEnabled()) {
    const message =
      `OAuth providers configured (${providerList}) but OAUTH_TOKEN_ENCRYPTION_KEY is not set. ` +
      'OAuth tokens will be stored unencrypted. ' +
      'Set OAUTH_TOKEN_ENCRYPTION_KEY to a 64-character hex string to enable token encryption at rest.';

    if (isProduction) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  } else {
    // Key is set but might be malformed — validate format
    const key = process.env.OAUTH_TOKEN_ENCRYPTION_KEY ?? '';
    const formatError = validateKeyFormat(key);
    if (formatError) {
      const message =
        `OAuth providers configured (${providerList}) but OAUTH_TOKEN_ENCRYPTION_KEY is invalid: ${formatError}`;

      if (isProduction) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
  };
}
