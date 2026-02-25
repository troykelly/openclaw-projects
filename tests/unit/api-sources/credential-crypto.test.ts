/**
 * Unit tests for credential encryption wrapper.
 * Part of API Onboarding feature (#1771).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encryptCredentialReference,
  decryptCredentialReference,
  maskCredentialReference,
} from '../../../src/api/api-sources/credential-crypto.ts';

const TEST_KEY_HEX = 'a'.repeat(64); // 32-byte key in hex
const TEST_CREDENTIAL_ID = '01234567-89ab-cdef-0123-456789abcdef';

describe('credential-crypto', () => {
  describe('encrypt / decrypt round-trip', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', TEST_KEY_HEX);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('encrypts to a different value', () => {
      const plaintext = 'sk-secret-api-key-12345';
      const encrypted = encryptCredentialReference(plaintext, TEST_CREDENTIAL_ID);
      expect(encrypted).not.toBe(plaintext);
    });

    it('decrypts back to the original value', () => {
      const plaintext = 'sk-secret-api-key-12345';
      const encrypted = encryptCredentialReference(plaintext, TEST_CREDENTIAL_ID);
      const decrypted = decryptCredentialReference(encrypted, TEST_CREDENTIAL_ID);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext for different credential IDs', () => {
      const plaintext = 'same-secret';
      const enc1 = encryptCredentialReference(plaintext, TEST_CREDENTIAL_ID);
      const enc2 = encryptCredentialReference(plaintext, 'ffffffff-ffff-ffff-ffff-ffffffffffff');
      expect(enc1).not.toBe(enc2);
    });

    it('fails to decrypt with wrong credential ID', () => {
      const plaintext = 'secret-value';
      const encrypted = encryptCredentialReference(plaintext, TEST_CREDENTIAL_ID);
      expect(() => {
        decryptCredentialReference(encrypted, 'wrong-id-00000000-0000-0000-0000');
      }).toThrow();
    });
  });

  describe('passthrough when encryption disabled', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns plaintext unchanged when no encryption key set', () => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '');
      const plaintext = 'sk-secret-api-key-12345';
      const result = encryptCredentialReference(plaintext, TEST_CREDENTIAL_ID);
      expect(result).toBe(plaintext);
    });
  });

  describe('maskCredentialReference', () => {
    it('masks short strings entirely', () => {
      expect(maskCredentialReference('short')).toBe('***');
    });

    it('masks strings of exactly 20 chars entirely', () => {
      const twentyChars = 'a'.repeat(20);
      expect(maskCredentialReference(twentyChars)).toBe('***');
    });

    it('shows first 15 chars for strings longer than 20 chars', () => {
      const longValue = 'op read "op://Personal/TfNSW/credential"';
      const masked = maskCredentialReference(longValue);
      expect(masked).toBe('op read "op://P***');
      expect(masked).toHaveLength(18);
    });

    it('masks a long API key showing prefix', () => {
      const apiKey = 'sk-proj-1234567890abcdefghijklmnop';
      const masked = maskCredentialReference(apiKey);
      expect(masked).toBe('sk-proj-1234567***');
      expect(masked.endsWith('***')).toBe(true);
    });
  });
});
