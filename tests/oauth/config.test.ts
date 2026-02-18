/**
 * Tests for OAuth config env var fallback chains.
 * Issue #1047: Align OAuth environment variable naming with devcontainer credentials.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('OAuth Config — env var fallback chains', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clone env so mutations don't leak between tests
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── Microsoft config ──────────────────────────────────────────────

  describe('getMicrosoftConfig()', () => {
    it('returns null when no Microsoft env vars are set', async () => {
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AZURE_CLIENT_SECRET;

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      expect(getMicrosoftConfig()).toBeNull();
    });

    it('uses MS365_* env vars when set', async () => {
      process.env.MS365_CLIENT_ID = 'ms365-id';
      process.env.MS365_CLIENT_SECRET = 'ms365-secret';
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AZURE_CLIENT_SECRET;

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      const config = getMicrosoftConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('ms365-id');
      expect(config?.client_secret).toBe('ms365-secret');
    });

    it('falls back to AZURE_* env vars when MS365_* are not set', async () => {
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      process.env.AZURE_CLIENT_ID = 'azure-id';
      process.env.AZURE_CLIENT_SECRET = 'azure-secret';

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      const config = getMicrosoftConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('azure-id');
      expect(config?.client_secret).toBe('azure-secret');
    });

    it('prefers MS365_* over AZURE_* when both are set', async () => {
      process.env.MS365_CLIENT_ID = 'ms365-id';
      process.env.MS365_CLIENT_SECRET = 'ms365-secret';
      process.env.AZURE_CLIENT_ID = 'azure-id';
      process.env.AZURE_CLIENT_SECRET = 'azure-secret';

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      const config = getMicrosoftConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('ms365-id');
      expect(config?.client_secret).toBe('ms365-secret');
    });

    it('includes tenant_id from AZURE_TENANT_ID when set', async () => {
      process.env.MS365_CLIENT_ID = 'ms365-id';
      process.env.MS365_CLIENT_SECRET = 'ms365-secret';
      process.env.AZURE_TENANT_ID = 'my-tenant-id';

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      const config = getMicrosoftConfig();
      expect(config).not.toBeNull();
      expect(config?.tenant_id).toBe('my-tenant-id');
    });

    it('tenant_id is undefined when AZURE_TENANT_ID is not set', async () => {
      process.env.MS365_CLIENT_ID = 'ms365-id';
      process.env.MS365_CLIENT_SECRET = 'ms365-secret';
      delete process.env.AZURE_TENANT_ID;

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      const config = getMicrosoftConfig();
      expect(config).not.toBeNull();
      expect(config?.tenant_id).toBeUndefined();
    });

    it('requires both client ID and secret (ID only returns null)', async () => {
      process.env.AZURE_CLIENT_ID = 'azure-id';
      delete process.env.AZURE_CLIENT_SECRET;
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      expect(getMicrosoftConfig()).toBeNull();
    });

    it('requires both client ID and secret (secret only returns null)', async () => {
      delete process.env.AZURE_CLIENT_ID;
      process.env.AZURE_CLIENT_SECRET = 'azure-secret';
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      expect(getMicrosoftConfig()).toBeNull();
    });

    it('can mix MS365_CLIENT_ID with AZURE_CLIENT_SECRET fallback', async () => {
      process.env.MS365_CLIENT_ID = 'ms365-id';
      delete process.env.MS365_CLIENT_SECRET;
      delete process.env.AZURE_CLIENT_ID;
      process.env.AZURE_CLIENT_SECRET = 'azure-secret';

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      const config = getMicrosoftConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('ms365-id');
      expect(config?.client_secret).toBe('azure-secret');
    });
  });

  // ── Google config ─────────────────────────────────────────────────

  describe('getGoogleConfig()', () => {
    it('returns null when no Google env vars are set', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLOUD_CLIENT_ID;
      delete process.env.GOOGLE_CLOUD_CLIENT_SECRET;

      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');
      expect(getGoogleConfig()).toBeNull();
    });

    it('uses GOOGLE_* env vars when set', async () => {
      process.env.GOOGLE_CLIENT_ID = 'google-id';
      process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
      delete process.env.GOOGLE_CLOUD_CLIENT_ID;
      delete process.env.GOOGLE_CLOUD_CLIENT_SECRET;

      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');
      const config = getGoogleConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('google-id');
      expect(config?.client_secret).toBe('google-secret');
    });

    it('falls back to GOOGLE_CLOUD_* env vars when GOOGLE_* are not set', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      process.env.GOOGLE_CLOUD_CLIENT_ID = 'gcloud-id';
      process.env.GOOGLE_CLOUD_CLIENT_SECRET = 'gcloud-secret';

      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');
      const config = getGoogleConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('gcloud-id');
      expect(config?.client_secret).toBe('gcloud-secret');
    });

    it('prefers GOOGLE_* over GOOGLE_CLOUD_* when both are set', async () => {
      process.env.GOOGLE_CLIENT_ID = 'google-id';
      process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
      process.env.GOOGLE_CLOUD_CLIENT_ID = 'gcloud-id';
      process.env.GOOGLE_CLOUD_CLIENT_SECRET = 'gcloud-secret';

      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');
      const config = getGoogleConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('google-id');
      expect(config?.client_secret).toBe('google-secret');
    });

    it('requires both client ID and secret (ID only returns null)', async () => {
      process.env.GOOGLE_CLOUD_CLIENT_ID = 'gcloud-id';
      delete process.env.GOOGLE_CLOUD_CLIENT_SECRET;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');
      expect(getGoogleConfig()).toBeNull();
    });

    it('can mix GOOGLE_CLIENT_ID with GOOGLE_CLOUD_CLIENT_SECRET fallback', async () => {
      process.env.GOOGLE_CLIENT_ID = 'google-id';
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLOUD_CLIENT_ID;
      process.env.GOOGLE_CLOUD_CLIENT_SECRET = 'gcloud-secret';

      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');
      const config = getGoogleConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('google-id');
      expect(config?.client_secret).toBe('gcloud-secret');
    });
  });

  // ── Provider detection with fallback vars ─────────────────────────

  describe('isProviderConfigured() with fallback vars', () => {
    it('detects Microsoft configured via AZURE_* vars', async () => {
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      process.env.AZURE_CLIENT_ID = 'azure-id';
      process.env.AZURE_CLIENT_SECRET = 'azure-secret';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLOUD_CLIENT_ID;
      delete process.env.GOOGLE_CLOUD_CLIENT_SECRET;

      const { isProviderConfigured } = await import('../../src/api/oauth/config.ts');
      expect(isProviderConfigured('microsoft')).toBe(true);
      expect(isProviderConfigured('google')).toBe(false);
    });

    it('detects Google configured via GOOGLE_CLOUD_* vars', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      process.env.GOOGLE_CLOUD_CLIENT_ID = 'gcloud-id';
      process.env.GOOGLE_CLOUD_CLIENT_SECRET = 'gcloud-secret';
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AZURE_CLIENT_SECRET;

      const { isProviderConfigured } = await import('../../src/api/oauth/config.ts');
      expect(isProviderConfigured('google')).toBe(true);
      expect(isProviderConfigured('microsoft')).toBe(false);
    });

    it('getConfiguredProviders() lists providers from fallback vars', async () => {
      process.env.AZURE_CLIENT_ID = 'azure-id';
      process.env.AZURE_CLIENT_SECRET = 'azure-secret';
      process.env.GOOGLE_CLOUD_CLIENT_ID = 'gcloud-id';
      process.env.GOOGLE_CLOUD_CLIENT_SECRET = 'gcloud-secret';
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const { getConfiguredProviders } = await import('../../src/api/oauth/config.ts');
      const providers = getConfiguredProviders();
      expect(providers).toContain('microsoft');
      expect(providers).toContain('google');
    });
  });

  // ── Microsoft authorization URL with tenant ───────────────────────

  describe('Microsoft authorization URL with AZURE_TENANT_ID', () => {
    it('uses tenant-specific URL when tenant_id is set', async () => {
      process.env.MS365_CLIENT_ID = 'ms365-id';
      process.env.MS365_CLIENT_SECRET = 'ms365-secret';
      process.env.AZURE_TENANT_ID = 'my-tenant-uuid';

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      const { buildAuthorizationUrl } = await import('../../src/api/oauth/microsoft.ts');

      const config = getMicrosoftConfig()!;
      const result = buildAuthorizationUrl(config, 'test-state');

      expect(result.url).toContain('login.microsoftonline.com/my-tenant-uuid/oauth2/v2.0/authorize');
      expect(result.url).not.toContain('/common/');
    });

    it('uses /common/ URL when tenant_id is not set', async () => {
      process.env.MS365_CLIENT_ID = 'ms365-id';
      process.env.MS365_CLIENT_SECRET = 'ms365-secret';
      delete process.env.AZURE_TENANT_ID;

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      const { buildAuthorizationUrl } = await import('../../src/api/oauth/microsoft.ts');

      const config = getMicrosoftConfig()!;
      const result = buildAuthorizationUrl(config, 'test-state');

      expect(result.url).toContain('login.microsoftonline.com/common/oauth2/v2.0/authorize');
    });
  });

  // ── getConfigSummary ──────────────────────────────────────────────

  describe('getConfigSummary()', () => {
    it('reports both providers configured via fallback vars', async () => {
      process.env.AZURE_CLIENT_ID = 'azure-id';
      process.env.AZURE_CLIENT_SECRET = 'azure-secret';
      process.env.GOOGLE_CLOUD_CLIENT_ID = 'gcloud-id';
      process.env.GOOGLE_CLOUD_CLIENT_SECRET = 'gcloud-secret';
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const { getConfigSummary } = await import('../../src/api/oauth/config.ts');
      const summary = getConfigSummary();
      expect(summary.microsoft.configured).toBe(true);
      expect(summary.google.configured).toBe(true);
    });
  });
});
