/**
 * Geolocation credential encryption at rest using AES-256-GCM with per-row HKDF-derived keys.
 * Issue #1245.
 *
 * When GEO_TOKEN_ENCRYPTION_KEY (or fallback OAUTH_TOKEN_ENCRYPTION_KEY) is set
 * (64-char hex = 32-byte master key), credentials are encrypted before database
 * writes and decrypted after reads.
 * When unset, credentials pass through unchanged (dev mode graceful fallback).
 *
 * Ciphertext format (base64-encoded): IV (12 bytes) || ciphertext || auth tag (16 bytes)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const DERIVED_KEY_LENGTH = 32; // 256 bits
const HKDF_HASH = 'sha256';
const HKDF_INFO_PREFIX = 'openclaw-geo-credentials';

/**
 * Check whether geo credential encryption is enabled via environment variable.
 * Falls back to OAUTH_TOKEN_ENCRYPTION_KEY if GEO_TOKEN_ENCRYPTION_KEY is not set.
 */
export function isGeoEncryptionEnabled(): boolean {
  const geoKey = process.env.GEO_TOKEN_ENCRYPTION_KEY;
  if (typeof geoKey === 'string' && geoKey.length > 0) return true;
  const oauthKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  return typeof oauthKey === 'string' && oauthKey.length > 0;
}

/**
 * Get the master key from the environment, validated.
 * Prefers GEO_TOKEN_ENCRYPTION_KEY, falls back to OAUTH_TOKEN_ENCRYPTION_KEY.
 * @throws Error if key is not a valid 64-character hex string.
 */
function getMasterKey(): Buffer {
  const hex = process.env.GEO_TOKEN_ENCRYPTION_KEY || process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'GEO_TOKEN_ENCRYPTION_KEY (or OAUTH_TOKEN_ENCRYPTION_KEY) must be a 64-character hex string (32 bytes)',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'Encryption key must contain only hexadecimal characters',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Synchronous key derivation using HKDF.
 * Derives a per-provider encryption key from the master key and provider UUID.
 */
function deriveKeySync(masterKey: Buffer, providerId: string): Buffer {
  const { hkdfSync } = require('node:crypto') as typeof import('node:crypto');
  const derived = hkdfSync(
    HKDF_HASH,
    masterKey,
    providerId,
    HKDF_INFO_PREFIX,
    DERIVED_KEY_LENGTH,
  );
  return Buffer.from(derived);
}

/**
 * Encrypt credentials for storage.
 *
 * If no encryption key is set, returns plaintext unchanged (dev mode).
 *
 * @param plaintext - The credentials to encrypt
 * @param providerId - The provider UUID, used as HKDF salt for per-row key derivation
 * @returns Base64-encoded ciphertext, or plaintext if encryption disabled
 */
export function encryptCredentials(plaintext: string, providerId: string): string {
  if (!isGeoEncryptionEnabled()) {
    return plaintext;
  }

  const masterKey = getMasterKey();
  const derivedKey = deriveKeySync(masterKey, providerId);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: IV || ciphertext || auth tag
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString('base64');
}

/**
 * Decrypt credentials read from storage.
 *
 * If no encryption key is set, returns the value unchanged (dev mode).
 *
 * @param ciphertext - Base64-encoded ciphertext, or plaintext if unencrypted
 * @param providerId - The provider UUID, used as HKDF salt for per-row key derivation
 * @returns Decrypted plaintext credentials
 * @throws Error if decryption fails (wrong key, tampered data, wrong provider ID)
 */
export function decryptCredentials(ciphertext: string, providerId: string): string {
  if (!isGeoEncryptionEnabled()) {
    return ciphertext;
  }

  const masterKey = getMasterKey();
  const derivedKey = deriveKeySync(masterKey, providerId);

  const combined = Buffer.from(ciphertext, 'base64');

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid ciphertext: too short');
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
