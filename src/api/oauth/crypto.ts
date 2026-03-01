/**
 * OAuth token encryption at rest using AES-256-GCM with per-row HKDF-derived keys.
 * Issue #1056.
 *
 * When OAUTH_TOKEN_ENCRYPTION_KEY is set (64-char hex = 32-byte master key),
 * tokens are encrypted before database writes and decrypted after reads.
 * When unset, tokens pass through unchanged (dev mode graceful fallback).
 *
 * Ciphertext format (base64-encoded): IV (12 bytes) || ciphertext || auth tag (16 bytes)
 */

import { createCipheriv, createDecipheriv, hkdf, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const DERIVED_KEY_LENGTH = 32; // 256 bits
const HKDF_HASH = 'sha256';
const HKDF_INFO_PREFIX = 'openclaw-oauth-token';

/**
 * Check whether token encryption is enabled via environment variable.
 */
export function isEncryptionEnabled(): boolean {
  const key = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  return typeof key === 'string' && key.length > 0;
}

/**
 * Get the master key from the environment, validated.
 * @throws Error if key is not a valid 64-character hex string.
 */
function getMasterKey(): Buffer {
  const hex = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'OAUTH_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
    );
  }
  // Validate hex characters
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'OAUTH_TOKEN_ENCRYPTION_KEY must contain only hexadecimal characters',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Derive a per-row encryption key from the master key and row UUID using HKDF.
 * This ensures each row uses a unique derived key, limiting blast radius if
 * a single derived key is compromised.
 */
function deriveKey(masterKey: Buffer, rowId: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    hkdf(
      HKDF_HASH,
      masterKey,
      rowId, // salt = row UUID, ensuring unique derived key per row
      HKDF_INFO_PREFIX, // info/context string
      DERIVED_KEY_LENGTH,
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(Buffer.from(derivedKey));
      },
    );
  });
}

/**
 * Synchronous key derivation for encrypt/decrypt which need to be synchronous.
 * Uses HKDF via the synchronous crypto API.
 */
function deriveKeySync(masterKey: Buffer, rowId: string): Buffer {
  const derived = hkdfSync(
    HKDF_HASH,
    masterKey,
    rowId,
    HKDF_INFO_PREFIX,
    DERIVED_KEY_LENGTH,
  );
  return Buffer.from(derived);
}

/**
 * Encrypt a plaintext token for storage.
 *
 * If OAUTH_TOKEN_ENCRYPTION_KEY is not set, returns plaintext unchanged (dev mode).
 *
 * @param plaintext - The token value to encrypt
 * @param rowId - The row UUID, used as HKDF salt for per-row key derivation
 * @returns Base64-encoded ciphertext (IV + encrypted data + auth tag), or plaintext if encryption disabled
 */
export function encryptToken(plaintext: string, rowId: string): string {
  if (!isEncryptionEnabled()) {
    return plaintext;
  }

  const masterKey = getMasterKey();
  const derivedKey = deriveKeySync(masterKey, rowId);
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
 * Decrypt a ciphertext token read from storage.
 *
 * If OAUTH_TOKEN_ENCRYPTION_KEY is not set, returns the value unchanged (dev mode).
 *
 * @param ciphertext - Base64-encoded ciphertext (IV + encrypted data + auth tag), or plaintext if unencrypted
 * @param rowId - The row UUID, used as HKDF salt for per-row key derivation
 * @returns Decrypted plaintext token
 * @throws Error if decryption fails (wrong key, tampered data, wrong row ID)
 */
export function decryptToken(ciphertext: string, rowId: string): string {
  if (!isEncryptionEnabled()) {
    return ciphertext;
  }

  const masterKey = getMasterKey();
  const derivedKey = deriveKeySync(masterKey, rowId);

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
