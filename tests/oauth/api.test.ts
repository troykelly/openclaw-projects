/**
 * Tests for OAuth API endpoints.
 * Part of Issue #206.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildServer } from '../../src/api/server.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';

describe('OAuth API Endpoints', () => {
  const originalEnv = process.env;
  let pool: Pool;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

    pool = createTestPool();
    await runMigrate('up');
    await truncateAllTables(pool);

    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
    await app.close();
  });

  describe('GET /api/oauth/providers', () => {
    it('lists no providers when none configured', async () => {
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AZURE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.GOOGLE_CLOUD_CLIENT_ID;
      delete process.env.GOOGLE_CLOUD_CLIENT_SECRET;

      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/providers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.providers).toHaveLength(0);
      expect(body.unconfigured).toHaveLength(2);
    });

    it('lists configured providers', async () => {
      process.env.MS365_CLIENT_ID = 'test-id';
      process.env.MS365_CLIENT_SECRET = 'test-secret';

      // Need to rebuild server to pick up new env vars
      await app.close();
      app = buildServer({ logger: false });

      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/providers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.providers.some((p: { name: string }) => p.name === 'microsoft')).toBe(true);
    });
  });

  describe('GET /api/oauth/authorize/:provider', () => {
    it('returns error when provider not configured', async () => {
      delete process.env.MS365_CLIENT_ID;
      delete process.env.MS365_CLIENT_SECRET;
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AZURE_CLIENT_SECRET;

      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/authorize/microsoft',
      });

      expect(response.statusCode).toBe(503);
      const body = response.json();
      expect(body.error).toContain('not configured');
    });

    it('redirects to authorization URL when configured', async () => {
      process.env.MS365_CLIENT_ID = 'test-client-id';
      process.env.MS365_CLIENT_SECRET = 'test-client-secret';

      await app.close();
      app = buildServer({ logger: false });

      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/authorize/microsoft',
      });

      expect(response.statusCode).toBe(302);
      const location = response.headers.location as string;
      expect(location).toContain('login.microsoftonline.com');
    });

    it('returns error for invalid provider', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/authorize/invalid',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/oauth/callback', () => {
    it('returns error when authorization failed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?error=access_denied',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('authorization failed');
    });

    it('returns error when code is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('Missing authorization code');
    });

    it('returns error when state is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?code=test-code',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('Missing OAuth state');
    });

    it('returns error when state is invalid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?code=test-code&state=invalid-state',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe('INVALID_STATE');
    });
  });

  describe('GET /api/oauth/connections', () => {
    it('returns empty list when no connections', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/connections',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.connections).toHaveLength(0);
    });

    it('returns connections for user', async () => {
      // Insert a test connection
      await pool.query(
        `INSERT INTO oauth_connection (user_email, provider, access_token, scopes)
         VALUES ('test@example.com', 'google', 'test-token', ARRAY['contacts'])`,
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/connections?userEmail=test@example.com',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.connections).toHaveLength(1);
      expect(body.connections[0].provider).toBe('google');
    });
  });

  describe('DELETE /api/oauth/connections/:id', () => {
    it('deletes existing connection', async () => {
      const insertResult = await pool.query(
        `INSERT INTO oauth_connection (user_email, provider, access_token, scopes)
         VALUES ('test@example.com', 'google', 'test-token', ARRAY['contacts'])
         RETURNING id::text`,
      );
      const connectionId = insertResult.rows[0].id;

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/oauth/connections/${connectionId}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify deletion
      const checkResult = await pool.query('SELECT id FROM oauth_connection WHERE id = $1', [connectionId]);
      expect(checkResult.rows).toHaveLength(0);
    });

    it('returns 404 for non-existent connection', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/oauth/connections/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/sync/contacts', () => {
    it('returns error when no connection exists', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/contacts',
        payload: {
          connectionId: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('No OAuth connection');
    });

    it('returns error when connectionId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sync/contacts',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('connectionId is required');
    });
  });
});
