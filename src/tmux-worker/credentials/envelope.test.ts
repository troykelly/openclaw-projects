/**
 * Tests for terminal credential envelope encryption.
 * Issue #1671.
 */
import { describe, it, expect } from 'vitest';
import {
  encryptCredential,
  decryptCredential,
  parseEncryptionKey,
} from './envelope.ts';

const TEST_KEY_HEX = 'a'.repeat(64); // 32-byte key in hex
const TEST_KEY_HEX_ALT = 'b'.repeat(64);

describe('credentials/envelope', () => {
  const masterKey = parseEncryptionKey(TEST_KEY_HEX);
  const altMasterKey = parseEncryptionKey(TEST_KEY_HEX_ALT);

  describe('parseEncryptionKey', () => {
    it('parses a valid 64-char hex string', () => {
      const key = parseEncryptionKey(TEST_KEY_HEX);
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('throws for too-short key', () => {
      expect(() => parseEncryptionKey('aabb')).toThrow(
        '64-character hex string',
      );
    });

    it('throws for too-long key', () => {
      expect(() => parseEncryptionKey('a'.repeat(66))).toThrow(
        '64-character hex string',
      );
    });

    it('throws for non-hex characters', () => {
      expect(() => parseEncryptionKey('g'.repeat(64))).toThrow(
        'hexadecimal characters',
      );
    });
  });

  describe('encrypt/decrypt roundtrip', () => {
    it('round-trips an SSH private key', () => {
      const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBE9JE2FjkGbGpVKL0JNqJkh3HhPxQ5W2DMKY0BwhikHwAAAJi0vMJStLzC
UgAAAAtzc2gtZWQyNTUxOQAAACBE9JE2FjkGbGpVKL0JNqJkh3HhPxQ5W2DMKY0BwhikHw
AAAEBtest-key-data-here-not-a-real-key
-----END OPENSSH PRIVATE KEY-----`;
      const rowId = '550e8400-e29b-41d4-a716-446655440000';

      const encrypted = encryptCredential(privateKey, masterKey, rowId);
      expect(encrypted).toBeInstanceOf(Buffer);
      expect(encrypted.length).toBeGreaterThan(28); // IV + tag minimum

      const decrypted = decryptCredential(encrypted, masterKey, rowId);
      expect(decrypted).toBe(privateKey);
    });

    it('round-trips a password', () => {
      const password = 'super-secret-p@ssw0rd!';
      const rowId = '550e8400-e29b-41d4-a716-446655440001';

      const encrypted = encryptCredential(password, masterKey, rowId);
      const decrypted = decryptCredential(encrypted, masterKey, rowId);
      expect(decrypted).toBe(password);
    });

    it('handles empty string', () => {
      const rowId = '550e8400-e29b-41d4-a716-446655440002';
      const encrypted = encryptCredential('', masterKey, rowId);
      const decrypted = decryptCredential(encrypted, masterKey, rowId);
      expect(decrypted).toBe('');
    });

    it('handles unicode content', () => {
      const value = 'credential-with-unicode-\u{1F512}-lock';
      const rowId = '550e8400-e29b-41d4-a716-446655440003';

      const encrypted = encryptCredential(value, masterKey, rowId);
      const decrypted = decryptCredential(encrypted, masterKey, rowId);
      expect(decrypted).toBe(value);
    });
  });

  describe('per-row key derivation', () => {
    it('different row IDs produce different ciphertexts', () => {
      const plaintext = 'same-credential-for-both';
      const rowA = '550e8400-e29b-41d4-a716-446655440010';
      const rowB = '550e8400-e29b-41d4-a716-446655440011';

      const ctA = encryptCredential(plaintext, masterKey, rowA);
      const ctB = encryptCredential(plaintext, masterKey, rowB);

      expect(ctA.equals(ctB)).toBe(false);

      // Both must decrypt correctly with their own row IDs
      expect(decryptCredential(ctA, masterKey, rowA)).toBe(plaintext);
      expect(decryptCredential(ctB, masterKey, rowB)).toBe(plaintext);
    });

    it('decrypting with wrong row ID fails', () => {
      const plaintext = 'secret-key-data';
      const correctRowId = '550e8400-e29b-41d4-a716-446655440020';
      const wrongRowId = '550e8400-e29b-41d4-a716-446655440021';

      const encrypted = encryptCredential(plaintext, masterKey, correctRowId);

      expect(() =>
        decryptCredential(encrypted, masterKey, wrongRowId),
      ).toThrow();
    });
  });

  describe('random IV', () => {
    it('same plaintext + same row ID produces different ciphertexts', () => {
      const plaintext = 'repeated-credential';
      const rowId = '550e8400-e29b-41d4-a716-446655440030';

      const ct1 = encryptCredential(plaintext, masterKey, rowId);
      const ct2 = encryptCredential(plaintext, masterKey, rowId);

      expect(ct1.equals(ct2)).toBe(false);

      // Both still decrypt correctly
      expect(decryptCredential(ct1, masterKey, rowId)).toBe(plaintext);
      expect(decryptCredential(ct2, masterKey, rowId)).toBe(plaintext);
    });
  });

  describe('key mismatch', () => {
    it('decrypting with a different master key fails', () => {
      const plaintext = 'secret-value';
      const rowId = '550e8400-e29b-41d4-a716-446655440040';

      const encrypted = encryptCredential(plaintext, masterKey, rowId);

      expect(() =>
        decryptCredential(encrypted, altMasterKey, rowId),
      ).toThrow();
    });
  });

  describe('tamper detection', () => {
    it('detects tampered ciphertext', () => {
      const plaintext = 'original-credential';
      const rowId = '550e8400-e29b-41d4-a716-446655440050';

      const encrypted = encryptCredential(plaintext, masterKey, rowId);

      // Flip a byte in the encrypted portion
      const tampered = Buffer.from(encrypted);
      tampered[16] ^= 0xff;

      expect(() =>
        decryptCredential(tampered, masterKey, rowId),
      ).toThrow();
    });

    it('rejects ciphertext that is too short', () => {
      const rowId = '550e8400-e29b-41d4-a716-446655440060';
      const tooShort = Buffer.alloc(10); // less than IV + tag

      expect(() =>
        decryptCredential(tooShort, masterKey, rowId),
      ).toThrow('too short');
    });
  });
});
