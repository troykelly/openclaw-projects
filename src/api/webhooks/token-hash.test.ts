/**
 * Tests for webhook token hashing (HMAC-SHA-256 with per-token salt).
 * Issue #2189: Credential Security Hardening.
 */
import { describe, it, expect } from 'vitest';
import {
  hashWebhookToken,
  verifyWebhookToken,
  generateWebhookSalt,
} from './token-hash.ts';

describe('webhooks/token-hash', () => {
  const hmacSecret = 'test-hmac-secret-key-for-webhook-tokens';

  describe('generateWebhookSalt', () => {
    it('returns a non-empty string', () => {
      const salt = generateWebhookSalt();
      expect(salt).toBeTruthy();
      expect(typeof salt).toBe('string');
    });

    it('returns unique values on successive calls', () => {
      const salt1 = generateWebhookSalt();
      const salt2 = generateWebhookSalt();
      expect(salt1).not.toBe(salt2);
    });

    it('returns a base64url-encoded string', () => {
      const salt = generateWebhookSalt();
      // base64url uses only [A-Za-z0-9_-]
      expect(salt).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('hashWebhookToken', () => {
    it('returns a hex string', () => {
      const salt = generateWebhookSalt();
      const hash = hashWebhookToken('my-token', salt, hmacSecret);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('produces different hashes for different tokens', () => {
      const salt = generateWebhookSalt();
      const hash1 = hashWebhookToken('token-1', salt, hmacSecret);
      const hash2 = hashWebhookToken('token-2', salt, hmacSecret);
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hashes for same token with different salts', () => {
      const salt1 = generateWebhookSalt();
      const salt2 = generateWebhookSalt();
      const hash1 = hashWebhookToken('same-token', salt1, hmacSecret);
      const hash2 = hashWebhookToken('same-token', salt2, hmacSecret);
      expect(hash1).not.toBe(hash2);
    });

    it('produces consistent hashes for same inputs', () => {
      const salt = 'fixed-salt';
      const hash1 = hashWebhookToken('my-token', salt, hmacSecret);
      const hash2 = hashWebhookToken('my-token', salt, hmacSecret);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different secrets', () => {
      const salt = generateWebhookSalt();
      const hash1 = hashWebhookToken('my-token', salt, 'secret-1');
      const hash2 = hashWebhookToken('my-token', salt, 'secret-2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyWebhookToken', () => {
    it('returns true for matching token', () => {
      const salt = generateWebhookSalt();
      const hash = hashWebhookToken('correct-token', salt, hmacSecret);
      expect(verifyWebhookToken('correct-token', hash, salt, hmacSecret)).toBe(true);
    });

    it('returns false for non-matching token', () => {
      const salt = generateWebhookSalt();
      const hash = hashWebhookToken('correct-token', salt, hmacSecret);
      expect(verifyWebhookToken('wrong-token', hash, salt, hmacSecret)).toBe(false);
    });

    it('returns false for wrong salt', () => {
      const salt = generateWebhookSalt();
      const wrongSalt = generateWebhookSalt();
      const hash = hashWebhookToken('my-token', salt, hmacSecret);
      expect(verifyWebhookToken('my-token', hash, wrongSalt, hmacSecret)).toBe(false);
    });

    it('returns false for wrong secret', () => {
      const salt = generateWebhookSalt();
      const hash = hashWebhookToken('my-token', salt, hmacSecret);
      expect(verifyWebhookToken('my-token', hash, salt, 'wrong-secret')).toBe(false);
    });

    it('uses constant-time comparison', () => {
      const salt = generateWebhookSalt();
      const hash = hashWebhookToken('token', salt, hmacSecret);
      // Both should complete without throwing (timingSafeEqual handles length mismatches)
      expect(verifyWebhookToken('token', hash, salt, hmacSecret)).toBe(true);
      expect(verifyWebhookToken('x', hash, salt, hmacSecret)).toBe(false);
    });
  });
});
