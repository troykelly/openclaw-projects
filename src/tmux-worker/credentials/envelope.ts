/**
 * Envelope encryption for terminal credentials using AES-256-GCM with
 * per-row HKDF-derived keys.
 *
 * Follows the same pattern as src/api/oauth/crypto.ts but operates on
 * Buffer (bytea) values for database storage, since terminal_credential
 * uses a bytea column for encrypted_value.
 *
 * Ciphertext format: IV (12 bytes) || ciphertext || auth tag (16 bytes)
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const DERIVED_KEY_LENGTH = 32; // 256 bits
const HKDF_HASH = 'sha256';
const HKDF_INFO_PREFIX = 'openclaw-terminal-credential';

/**
 * Validate and parse a hex encryption key into a 32-byte Buffer.
 * @throws Error if key is not a valid 64-character hex string.
 */
export function parseEncryptionKey(hexKey: string): Buffer {
  if (hexKey.length !== 64) {
    throw new Error(
      'Encryption key must be a 64-character hex string (32 bytes)',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error(
      'Encryption key must contain only hexadecimal characters',
    );
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * Derive a per-row encryption key from the master key and row ID via HKDF.
 * Each credential row gets a unique derived key, limiting blast radius if
 * a single derived key is compromised.
 */
function deriveKey(masterKey: Buffer, rowId: string): Buffer {
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
 * Encrypt a plaintext credential value for database storage.
 *
 * @param plaintext - The credential value (SSH key, password) to encrypt
 * @param masterKey - 32-byte master encryption key
 * @param rowId - The credential row UUID, used as HKDF salt
 * @returns Binary ciphertext (IV + encrypted data + auth tag) for bytea column
 */
export function encryptCredential(
  plaintext: string,
  masterKey: Buffer,
  rowId: string,
): Buffer {
  const derivedKey = deriveKey(masterKey, rowId);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: IV (12) || ciphertext || auth tag (16)
  return Buffer.concat([iv, encrypted, authTag]);
}

/**
 * Decrypt a credential value read from database storage.
 *
 * @param ciphertext - Binary ciphertext from bytea column
 * @param masterKey - 32-byte master encryption key
 * @param rowId - The credential row UUID, used as HKDF salt
 * @returns Decrypted plaintext credential
 * @throws Error if decryption fails (wrong key, tampered data, wrong row ID)
 */
export function decryptCredential(
  ciphertext: Buffer,
  masterKey: Buffer,
  rowId: string,
): string {
  if (ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid ciphertext: too short');
  }

  const derivedKey = deriveKey(masterKey, rowId);

  const iv = ciphertext.subarray(0, IV_LENGTH);
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_LENGTH);
  const encrypted = ciphertext.subarray(
    IV_LENGTH,
    ciphertext.length - AUTH_TAG_LENGTH,
  );

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
