/**
 * Tests for geolocation credential encryption at rest.
 * Issue #1245.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encryptCredentials,
  decryptCredentials,
  isGeoEncryptionEnabled,
} from './crypto.ts';

const TEST_KEY_HEX = 'a'.repeat(64); // 32-byte key in hex (256 bits)
const TEST_KEY_HEX_ALT = 'b'.repeat(64);

describe('geolocation/crypto', () => {
  describe('with GEO_TOKEN_ENCRYPTION_KEY set', () => {
    beforeEach(() => {
      vi.stubEnv('GEO_TOKEN_ENCRYPTION_KEY', TEST_KEY_HEX);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('round-trips encrypt then decrypt', () => {
      const plaintext = '{"token": "ha-long-lived-access-token"}';
      const providerId = '550e8400-e29b-41d4-a716-446655440000';

      const ciphertext = encryptCredentials(plaintext, providerId);
      expect(ciphertext).not.toBe(plaintext);

      const decrypted = decryptCredentials(ciphertext, providerId);
      expect(decrypted).toBe(plaintext);
    });

    it('different provider IDs produce different ciphertexts', () => {
      const plaintext = '{"token": "same-creds"}';
      const providerA = '550e8400-e29b-41d4-a716-446655440001';
      const providerB = '550e8400-e29b-41d4-a716-446655440002';

      const ciphertextA = encryptCredentials(plaintext, providerA);
      const ciphertextB = encryptCredentials(plaintext, providerB);

      expect(ciphertextA).not.toBe(ciphertextB);

      // Both must decrypt to same plaintext with their own provider IDs
      expect(decryptCredentials(ciphertextA, providerA)).toBe(plaintext);
      expect(decryptCredentials(ciphertextB, providerB)).toBe(plaintext);
    });

    it('raw base64 does not contain the plaintext', () => {
      const plaintext = 'my-secret-token-value';
      const providerId = '550e8400-e29b-41d4-a716-446655440010';

      const ciphertext = encryptCredentials(plaintext, providerId);
      const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
      expect(decoded).not.toContain(plaintext);
    });

    it('ciphertext is base64-encoded', () => {
      const plaintext = 'credentials-value';
      const providerId = '550e8400-e29b-41d4-a716-446655440030';

      const ciphertext = encryptCredentials(plaintext, providerId);
      expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('decrypting with wrong provider ID fails', () => {
      const plaintext = 'secret-creds';
      const correctId = '550e8400-e29b-41d4-a716-446655440010';
      const wrongId = '550e8400-e29b-41d4-a716-446655440099';

      const ciphertext = encryptCredentials(plaintext, correctId);
      expect(() => decryptCredentials(ciphertext, wrongId)).toThrow();
    });

    it('encrypting twice with same provider ID produces different ciphertexts (random IV)', () => {
      const plaintext = '{"key": "value"}';
      const providerId = '550e8400-e29b-41d4-a716-446655440020';

      const ct1 = encryptCredentials(plaintext, providerId);
      const ct2 = encryptCredentials(plaintext, providerId);

      expect(ct1).not.toBe(ct2);

      expect(decryptCredentials(ct1, providerId)).toBe(plaintext);
      expect(decryptCredentials(ct2, providerId)).toBe(plaintext);
    });

    it('isGeoEncryptionEnabled returns true', () => {
      expect(isGeoEncryptionEnabled()).toBe(true);
    });

    it('detects tampered ciphertext', () => {
      const plaintext = 'original-credentials';
      const providerId = '550e8400-e29b-41d4-a716-446655440060';

      const ciphertext = encryptCredentials(plaintext, providerId);
      const buf = Buffer.from(ciphertext, 'base64');
      buf[16] ^= 0xff;
      const tampered = buf.toString('base64');

      expect(() => decryptCredentials(tampered, providerId)).toThrow();
    });
  });

  describe('fallback to OAUTH_TOKEN_ENCRYPTION_KEY', () => {
    beforeEach(() => {
      delete process.env.GEO_TOKEN_ENCRYPTION_KEY;
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', TEST_KEY_HEX);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('uses OAUTH_TOKEN_ENCRYPTION_KEY when GEO key not set', () => {
      const plaintext = 'fallback-creds';
      const providerId = '550e8400-e29b-41d4-a716-446655440070';

      const ciphertext = encryptCredentials(plaintext, providerId);
      expect(ciphertext).not.toBe(plaintext);
      expect(decryptCredentials(ciphertext, providerId)).toBe(plaintext);
    });

    it('isGeoEncryptionEnabled returns true', () => {
      expect(isGeoEncryptionEnabled()).toBe(true);
    });
  });

  describe('without any encryption key (graceful fallback)', () => {
    beforeEach(() => {
      delete process.env.GEO_TOKEN_ENCRYPTION_KEY;
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('encryptCredentials returns plaintext unchanged', () => {
      const plaintext = 'unencrypted-creds';
      const providerId = '550e8400-e29b-41d4-a716-446655440080';

      expect(encryptCredentials(plaintext, providerId)).toBe(plaintext);
    });

    it('decryptCredentials returns value unchanged', () => {
      const value = 'unencrypted-creds';
      const providerId = '550e8400-e29b-41d4-a716-446655440090';

      expect(decryptCredentials(value, providerId)).toBe(value);
    });

    it('isGeoEncryptionEnabled returns false', () => {
      expect(isGeoEncryptionEnabled()).toBe(false);
    });
  });
});
