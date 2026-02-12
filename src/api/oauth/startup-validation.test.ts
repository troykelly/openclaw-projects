/**
 * Tests for OAuth startup validation.
 * Issue #1080: warn when OAuth configured without OAUTH_TOKEN_ENCRYPTION_KEY.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateOAuthStartup } from './startup-validation.ts';

const VALID_KEY = 'a'.repeat(64);

describe('oauth/startup-validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('when no OAuth provider is configured', () => {
    beforeEach(() => {
      // Clear all OAuth provider env vars
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AZURE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLOUD_CLIENT_ID;
      delete process.env.GOOGLE_CLOUD_CLIENT_SECRET;
      delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
      delete process.env.NODE_ENV;
    });

    it('returns ok with no warnings when no providers configured', () => {
      const result = validateOAuthStartup();
      expect(result.ok).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('when OAuth provider is configured with valid encryption key', () => {
    beforeEach(() => {
      vi.stubEnv('MS365_CLIENT_ID', 'test-client-id');
      vi.stubEnv('MS365_CLIENT_SECRET', 'test-client-secret');
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', VALID_KEY);
      delete process.env.NODE_ENV;
    });

    it('returns ok with no warnings', () => {
      const result = validateOAuthStartup();
      expect(result.ok).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('when OAuth provider is configured without encryption key (development)', () => {
    beforeEach(() => {
      vi.stubEnv('MS365_CLIENT_ID', 'test-client-id');
      vi.stubEnv('MS365_CLIENT_SECRET', 'test-client-secret');
      delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
      vi.stubEnv('NODE_ENV', 'development');
    });

    it('returns ok with a warning', () => {
      const result = validateOAuthStartup();
      expect(result.ok).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('OAUTH_TOKEN_ENCRYPTION_KEY');
    });
  });

  describe('when OAuth provider is configured without encryption key (no NODE_ENV)', () => {
    beforeEach(() => {
      vi.stubEnv('GOOGLE_CLIENT_ID', 'test-google-id');
      vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-google-secret');
      delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
      delete process.env.NODE_ENV;
    });

    it('returns ok with a warning (non-production defaults to warning)', () => {
      const result = validateOAuthStartup();
      expect(result.ok).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('OAUTH_TOKEN_ENCRYPTION_KEY');
    });
  });

  describe('when OAuth provider is configured without encryption key (production)', () => {
    beforeEach(() => {
      vi.stubEnv('MS365_CLIENT_ID', 'test-client-id');
      vi.stubEnv('MS365_CLIENT_SECRET', 'test-client-secret');
      delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
      vi.stubEnv('NODE_ENV', 'production');
    });

    it('returns not ok (fatal error in production)', () => {
      const result = validateOAuthStartup();
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('OAUTH_TOKEN_ENCRYPTION_KEY');
    });
  });

  describe('when OAuth provider is configured with invalid encryption key', () => {
    beforeEach(() => {
      vi.stubEnv('MS365_CLIENT_ID', 'test-client-id');
      vi.stubEnv('MS365_CLIENT_SECRET', 'test-client-secret');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns error when key is too short', () => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', 'abcdef');
      vi.stubEnv('NODE_ENV', 'production');
      const result = validateOAuthStartup();
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('64-character hex');
    });

    it('returns error when key contains non-hex characters', () => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', 'g'.repeat(64));
      vi.stubEnv('NODE_ENV', 'production');
      const result = validateOAuthStartup();
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('hexadecimal');
    });

    it('returns warning for invalid key in development', () => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', 'too-short');
      vi.stubEnv('NODE_ENV', 'development');
      const result = validateOAuthStartup();
      expect(result.ok).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('OAUTH_TOKEN_ENCRYPTION_KEY');
    });
  });

  describe('when multiple OAuth providers are configured', () => {
    beforeEach(() => {
      vi.stubEnv('MS365_CLIENT_ID', 'test-ms-id');
      vi.stubEnv('MS365_CLIENT_SECRET', 'test-ms-secret');
      vi.stubEnv('GOOGLE_CLIENT_ID', 'test-google-id');
      vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-google-secret');
      delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    });

    it('lists configured providers in the warning', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const result = validateOAuthStartup();
      expect(result.ok).toBe(true);
      expect(result.warnings[0]).toContain('microsoft');
      expect(result.warnings[0]).toContain('google');
    });

    it('lists configured providers in the error (production)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const result = validateOAuthStartup();
      expect(result.ok).toBe(false);
      expect(result.errors[0]).toContain('microsoft');
      expect(result.errors[0]).toContain('google');
    });
  });
});
