/**
 * Credential encryption wrapper for API source credentials.
 * Thin wrapper around the existing OAuth crypto module (AES-256-GCM with HKDF).
 * Part of API Onboarding feature.
 */

import { encryptToken, decryptToken } from '../oauth/crypto.ts';

/**
 * Encrypt a credential resolve_reference for storage.
 *
 * @param plaintext - The credential value to encrypt
 * @param credentialId - The credential row UUID, used as HKDF salt
 * @returns Encrypted ciphertext (or plaintext if encryption disabled)
 */
export function encryptCredentialReference(
  plaintext: string,
  credentialId: string,
): string {
  return encryptToken(plaintext, credentialId);
}

/**
 * Decrypt a credential resolve_reference read from storage.
 *
 * @param ciphertext - The encrypted credential value
 * @param credentialId - The credential row UUID, used as HKDF salt
 * @returns Decrypted plaintext
 */
export function decryptCredentialReference(
  ciphertext: string,
  credentialId: string,
): string {
  return decryptToken(ciphertext, credentialId);
}

/**
 * Mask a resolve_reference for display purposes.
 * Shows first 15 chars + '***' if longer than 20 chars, else all '***'.
 *
 * @param reference - The plaintext resolve_reference
 * @returns Masked string safe for display
 */
export function maskCredentialReference(reference: string): string {
  if (reference.length > 20) {
    return reference.slice(0, 15) + '***';
  }
  return '***';
}
