/**
 * Tests for OAuth service.
 * Part of Issue #206.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';

describe('OAuth Service', () => {
  let pool: Pool;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    pool = createTestPool();
    await runMigrate('up');
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
  });

  describe('Configuration', () => {
    it('returns null when Microsoft not configured', async () => {
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AZURE_CLIENT_SECRET;

      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');
      expect(getMicrosoftConfig()).toBeNull();
    });

    it('returns config when Microsoft is configured', async () => {
      process.env.MS365_CLIENT_ID = 'test-client-id';
      process.env.MS365_CLIENT_SECRET = 'test-client-secret';

      // Clear module cache to pick up new env vars
      vi.resetModules();
      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');

      const config = getMicrosoftConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('test-client-id');
      expect(config?.client_secret).toBe('test-client-secret');
    });

    it('returns null when Google not configured', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLOUD_CLIENT_ID;
      delete process.env.GOOGLE_CLOUD_CLIENT_SECRET;

      vi.resetModules();
      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');
      expect(getGoogleConfig()).toBeNull();
    });

    it('returns config when Google is configured', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-google-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';

      vi.resetModules();
      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');

      const config = getGoogleConfig();
      expect(config).not.toBeNull();
      expect(config?.client_id).toBe('test-google-id');
      expect(config?.client_secret).toBe('test-google-secret');
    });

    it('lists configured providers', async () => {
      process.env.MS365_CLIENT_ID = 'test-id';
      process.env.MS365_CLIENT_SECRET = 'test-secret';
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLOUD_CLIENT_ID;
      delete process.env.GOOGLE_CLOUD_CLIENT_SECRET;

      vi.resetModules();
      const { getConfiguredProviders } = await import('../../src/api/oauth/config.ts');

      const providers = getConfiguredProviders();
      expect(providers).toContain('microsoft');
      expect(providers).not.toContain('google');
    });
  });

  describe('Authorization URL Generation', () => {
    beforeEach(() => {
      process.env.MS365_CLIENT_ID = 'test-client-id';
      process.env.MS365_CLIENT_SECRET = 'test-client-secret';
      process.env.GOOGLE_CLIENT_ID = 'test-google-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
      vi.resetModules();
    });

    it('generates Microsoft authorization URL', async () => {
      const { buildAuthorizationUrl } = await import('../../src/api/oauth/microsoft.ts');
      const { getMicrosoftConfig } = await import('../../src/api/oauth/config.ts');

      const config = getMicrosoftConfig()!;
      const result = buildAuthorizationUrl(config, 'test-state');

      expect(result.url).toContain('login.microsoftonline.com');
      expect(result.url).toContain('client_id=test-client-id');
      expect(result.url).toContain('state=test-state');
      expect(result.provider).toBe('microsoft');
      expect(result.state).toBe('test-state');
    });

    it('generates Google authorization URL', async () => {
      const { buildAuthorizationUrl } = await import('../../src/api/oauth/google.ts');
      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');

      const config = getGoogleConfig()!;
      const result = buildAuthorizationUrl(config, 'test-state');

      expect(result.url).toContain('accounts.google.com');
      expect(result.url).toContain('client_id=test-google-id');
      expect(result.url).toContain('state=test-state');
      expect(result.provider).toBe('google');
    });

    it('includes custom scopes in URL', async () => {
      const { buildAuthorizationUrl } = await import('../../src/api/oauth/google.ts');
      const { getGoogleConfig } = await import('../../src/api/oauth/config.ts');

      const config = getGoogleConfig()!;
      const customScopes = ['https://www.googleapis.com/auth/contacts.readonly'];
      const result = buildAuthorizationUrl(config, 'state', customScopes);

      expect(result.url).toContain(encodeURIComponent(customScopes[0]));
      expect(result.scopes).toEqual(customScopes);
    });
  });

  describe('Connection Storage', () => {
    it('saves new OAuth connection', async () => {
      const { saveConnection } = await import('../../src/api/oauth/service.ts');

      const tokens = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_at: new Date(Date.now() + 3600000),
        token_type: 'Bearer',
        scopes: ['contacts', 'email'],
      };

      const connection = await saveConnection(pool, 'test@example.com', 'google', tokens);

      expect(connection.user_email).toBe('test@example.com');
      expect(connection.provider).toBe('google');
      expect(connection.access_token).toBe('test-access-token');
      expect(connection.refresh_token).toBe('test-refresh-token');
      expect(connection.scopes).toEqual(['contacts', 'email']);
    });

    it('updates existing connection on conflict', async () => {
      const { saveConnection, getConnection } = await import('../../src/api/oauth/service.ts');

      const tokens1 = {
        access_token: 'old-token',
        refresh_token: 'old-refresh',
        token_type: 'Bearer',
        scopes: ['contacts'],
      };

      const saved = await saveConnection(pool, 'test@example.com', 'google', tokens1);

      const tokens2 = {
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
        scopes: ['contacts', 'email'],
      };

      await saveConnection(pool, 'test@example.com', 'google', tokens2);

      const connection = await getConnection(pool, saved.id);
      expect(connection?.access_token).toBe('new-token');
      expect(connection?.refresh_token).toBe('new-refresh');
      expect(connection?.scopes).toEqual(['contacts', 'email']);
    });

    it('gets connection by id', async () => {
      const { saveConnection, getConnection } = await import('../../src/api/oauth/service.ts');

      const tokens = {
        access_token: 'test-token',
        token_type: 'Bearer',
        scopes: ['contacts'],
      };

      const saved = await saveConnection(pool, 'test@example.com', 'google', tokens);

      const connection = await getConnection(pool, saved.id);
      expect(connection).not.toBeNull();
      expect(connection?.access_token).toBe('test-token');

      const noConnection = await getConnection(pool, '00000000-0000-0000-0000-000000000000');
      expect(noConnection).toBeNull();
    });
  });

  describe('Error Types', () => {
    it('OAuthError has correct properties', async () => {
      const { OAuthError } = await import('../../src/api/oauth/types.ts');

      const error = new OAuthError('Test error', 'TEST_CODE', 'google', 401);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.provider).toBe('google');
      expect(error.status_code).toBe(401);
      expect(error.name).toBe('OAuthError');
    });

    it('NoConnectionError has correct properties', async () => {
      const { NoConnectionError } = await import('../../src/api/oauth/types.ts');

      const error = new NoConnectionError('google', 'test@example.com');
      expect(error.message).toContain('test@example.com');
      expect(error.code).toBe('NO_CONNECTION');
      expect(error.provider).toBe('google');
      expect(error.status_code).toBe(404);
    });

    it('ProviderNotConfiguredError has correct properties', async () => {
      const { ProviderNotConfiguredError } = await import('../../src/api/oauth/types.ts');

      const error = new ProviderNotConfiguredError('microsoft');
      expect(error.message).toContain('microsoft');
      expect(error.code).toBe('PROVIDER_NOT_CONFIGURED');
      expect(error.status_code).toBe(500);
    });
  });
});
