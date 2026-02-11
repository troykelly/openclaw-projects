/**
 * Tests for OAuth token encryption at rest.
 * Issue #1056.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encryptToken, decryptToken, isEncryptionEnabled } from './crypto.ts';

const TEST_KEY_HEX = 'a'.repeat(64); // 32-byte key in hex (256 bits)
const TEST_KEY_HEX_ALT = 'b'.repeat(64);

describe('oauth/crypto', () => {
  describe('with OAUTH_TOKEN_ENCRYPTION_KEY set', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', TEST_KEY_HEX);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('round-trips encrypt then decrypt', () => {
      const plaintext = 'ya29.access-token-value-here';
      const rowId = '550e8400-e29b-41d4-a716-446655440000';

      const ciphertext = encryptToken(plaintext, rowId);
      expect(ciphertext).not.toBe(plaintext);

      const decrypted = decryptToken(ciphertext, rowId);
      expect(decrypted).toBe(plaintext);
    });

    it('different row IDs produce different ciphertexts for the same plaintext', () => {
      const plaintext = 'ya29.same-token-for-both';
      const rowA = '550e8400-e29b-41d4-a716-446655440001';
      const rowB = '550e8400-e29b-41d4-a716-446655440002';

      const ciphertextA = encryptToken(plaintext, rowA);
      const ciphertextB = encryptToken(plaintext, rowB);

      expect(ciphertextA).not.toBe(ciphertextB);

      // Both must decrypt to same plaintext with their own row IDs
      expect(decryptToken(ciphertextA, rowA)).toBe(plaintext);
      expect(decryptToken(ciphertextB, rowB)).toBe(plaintext);
    });

    it('decrypting with wrong row ID fails', () => {
      const plaintext = 'secret-token';
      const correctRowId = '550e8400-e29b-41d4-a716-446655440010';
      const wrongRowId = '550e8400-e29b-41d4-a716-446655440099';

      const ciphertext = encryptToken(plaintext, correctRowId);

      expect(() => decryptToken(ciphertext, wrongRowId)).toThrow();
    });

    it('encrypting the same plaintext twice with the same row ID produces different ciphertexts (random IV)', () => {
      const plaintext = 'ya29.token-value';
      const rowId = '550e8400-e29b-41d4-a716-446655440020';

      const ct1 = encryptToken(plaintext, rowId);
      const ct2 = encryptToken(plaintext, rowId);

      // Random IV means different ciphertexts each time
      expect(ct1).not.toBe(ct2);

      // Both still decrypt correctly
      expect(decryptToken(ct1, rowId)).toBe(plaintext);
      expect(decryptToken(ct2, rowId)).toBe(plaintext);
    });

    it('ciphertext is base64-encoded', () => {
      const plaintext = 'token-value';
      const rowId = '550e8400-e29b-41d4-a716-446655440030';

      const ciphertext = encryptToken(plaintext, rowId);

      // base64 characters only
      expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('handles empty string plaintext', () => {
      const rowId = '550e8400-e29b-41d4-a716-446655440040';

      const ciphertext = encryptToken('', rowId);
      expect(decryptToken(ciphertext, rowId)).toBe('');
    });

    it('handles unicode token values', () => {
      const plaintext = 'token-with-unicode-\u{1F600}-emoji';
      const rowId = '550e8400-e29b-41d4-a716-446655440050';

      const ciphertext = encryptToken(plaintext, rowId);
      expect(decryptToken(ciphertext, rowId)).toBe(plaintext);
    });

    it('detects tampered ciphertext', () => {
      const plaintext = 'ya29.original-token';
      const rowId = '550e8400-e29b-41d4-a716-446655440060';

      const ciphertext = encryptToken(plaintext, rowId);
      const buf = Buffer.from(ciphertext, 'base64');
      // Flip a byte in the middle of the ciphertext portion (after IV)
      buf[16] ^= 0xff;
      const tampered = buf.toString('base64');

      expect(() => decryptToken(tampered, rowId)).toThrow();
    });

    it('isEncryptionEnabled returns true when key is set', () => {
      expect(isEncryptionEnabled()).toBe(true);
    });

    it('decrypting with a different master key fails', () => {
      const plaintext = 'ya29.secret';
      const rowId = '550e8400-e29b-41d4-a716-446655440070';

      const ciphertext = encryptToken(plaintext, rowId);

      // Change the key
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', TEST_KEY_HEX_ALT);

      expect(() => decryptToken(ciphertext, rowId)).toThrow();
    });
  });

  describe('without OAUTH_TOKEN_ENCRYPTION_KEY (graceful fallback)', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('encryptToken returns plaintext unchanged', () => {
      const plaintext = 'ya29.unencrypted-token';
      const rowId = '550e8400-e29b-41d4-a716-446655440080';

      expect(encryptToken(plaintext, rowId)).toBe(plaintext);
    });

    it('decryptToken returns value unchanged', () => {
      const value = 'ya29.unencrypted-token';
      const rowId = '550e8400-e29b-41d4-a716-446655440090';

      expect(decryptToken(value, rowId)).toBe(value);
    });

    it('isEncryptionEnabled returns false', () => {
      expect(isEncryptionEnabled()).toBe(false);
    });
  });

  describe('without OAUTH_TOKEN_ENCRYPTION_KEY (env var not set at all)', () => {
    beforeEach(() => {
      delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('encryptToken returns plaintext unchanged', () => {
      const plaintext = 'ya29.unencrypted-token';
      const rowId = '550e8400-e29b-41d4-a716-446655440100';

      expect(encryptToken(plaintext, rowId)).toBe(plaintext);
    });

    it('isEncryptionEnabled returns false', () => {
      expect(isEncryptionEnabled()).toBe(false);
    });
  });
});
