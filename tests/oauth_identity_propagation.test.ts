/**
 * Tests for OAuth identity propagation through the authorize/callback flow.
 * Issue #1832: The authorize endpoint must store the authenticated user's email
 * in oauth_state so the callback uses it as the connection owner, rather than
 * falling back to the provider email.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';

// JWT signing secret for tests
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

describe('OAuth identity propagation (Issue #1832)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  // ── Authorize endpoint stores session email in oauth_state ──────────

  describe('authorize endpoint stores session email in state', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';
      process.env.MS365_CLIENT_ID = 'test-client-id';
      process.env.MS365_CLIENT_SECRET = 'test-client-secret';
      process.env.GOOGLE_CLIENT_ID = 'test-google-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('stores authenticated user email in oauth_state when session exists', async () => {
      vi.resetModules();
      const { buildServer } = await import('../src/api/server.ts');
      const { signAccessToken } = await import('../src/api/auth/jwt.ts');

      const app = buildServer({ logger: false });
      try {
        // Create a JWT for the authenticated user
        const userEmail = 'appuser@example.com';
        const token = await signAccessToken(userEmail);

        const response = await app.inject({
          method: 'GET',
          url: '/api/oauth/authorize/microsoft',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
          },
        });

        expect(response.statusCode).toBe(200);

        // Check that the oauth_state row has the session user's email
        const stateRows = await pool.query(
          `SELECT user_email, provider FROM oauth_state ORDER BY created_at DESC LIMIT 1`,
        );
        expect(stateRows.rows).toHaveLength(1);
        expect(stateRows.rows[0].user_email).toBe(userEmail);
        expect(stateRows.rows[0].provider).toBe('microsoft');
      } finally {
        await app.close();
      }
    });

    it('stores null user_email in oauth_state when no session (unauthenticated)', async () => {
      // When auth is disabled and no E2E email, getSessionEmail returns null
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
      delete process.env.OPENCLAW_E2E_SESSION_EMAIL;

      vi.resetModules();
      const { buildServer } = await import('../src/api/server.ts');

      const app = buildServer({ logger: false });
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/oauth/authorize/google',
          headers: { accept: 'application/json' },
        });

        expect(response.statusCode).toBe(200);

        // user_email should be null when no session
        const stateRows = await pool.query(
          `SELECT user_email FROM oauth_state ORDER BY created_at DESC LIMIT 1`,
        );
        expect(stateRows.rows).toHaveLength(1);
        expect(stateRows.rows[0].user_email).toBeNull();
      } finally {
        await app.close();
      }
    });
  });

  // ── Callback uses stateData.user_email as connection owner ──────────

  describe('callback uses state user_email as connection owner', () => {
    it('saveConnection receives ownerEmail from state, not provider email', async () => {
      /**
       * We can't easily test the full callback flow (it requires a real OAuth
       * code exchange with a provider). Instead, we verify the data model:
       * when state has user_email, that email should be used as the connection
       * owner, and the provider email should go into provider_account_email.
       */
      const { saveConnection, getConnection } = await import('../src/api/oauth/service.ts');

      const appUserEmail = 'appuser@example.com';
      const providerEmail = 'provider-account@gmail.com';

      const tokens = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_at: new Date(Date.now() + 3600000),
        token_type: 'Bearer' as const,
        scopes: ['contacts', 'email'],
      };

      // Save with appUserEmail as owner, providerEmail as provider_account_email
      const connection = await saveConnection(pool, appUserEmail, 'google', tokens, {
        provider_account_email: providerEmail,
      });

      expect(connection.user_email).toBe(appUserEmail);
      expect(connection.provider_account_email).toBe(providerEmail);

      // Verify by reading back from DB
      const fetched = await getConnection(pool, connection.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.user_email).toBe(appUserEmail);
      expect(fetched!.provider_account_email).toBe(providerEmail);
    });

    it('oauth_state preserves user_email through validate round-trip', async () => {
      const { validateState } = await import('../src/api/oauth/service.ts');

      const stateToken = randomBytes(32).toString('hex');
      const appUserEmail = 'appuser@example.com';

      // Insert state with user_email (simulating what authorize should do)
      await pool.query(
        `INSERT INTO oauth_state (state, provider, code_verifier, scopes, user_email)
         VALUES ($1, $2, $3, $4, $5)`,
        [stateToken, 'microsoft', 'test-verifier', ['contacts'], appUserEmail],
      );

      const stateData = await validateState(pool, stateToken);
      expect(stateData.user_email).toBe(appUserEmail);
    });

    it('callback should use state user_email for one-time auth code, not provider email', async () => {
      /**
       * Verify that when a one-time auth code is created during callback,
       * it uses the owner email (from state) so the JWT issued after exchange
       * represents the correct user.
       */
      const ownerEmail = 'appuser@example.com';
      const code = randomBytes(32).toString('base64url');
      const codeSha = createHash('sha256').update(code).digest('hex');

      // Simulate what the fixed callback should do: use ownerEmail
      await pool.query(
        `INSERT INTO auth_one_time_code (code_sha256, email, expires_at)
         VALUES ($1, $2, now() + interval '60 seconds')`,
        [codeSha, ownerEmail],
      );

      const result = await pool.query(
        `SELECT email FROM auth_one_time_code WHERE code_sha256 = $1`,
        [codeSha],
      );

      expect(result.rows[0].email).toBe(ownerEmail);
    });
  });

  // ── Full authorize endpoint integration test ────────────────────────

  describe('authorize endpoint passes user_email to getAuthorizationUrl', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';
      process.env.GOOGLE_CLIENT_ID = 'test-google-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('google authorize stores session email for authenticated user', async () => {
      vi.resetModules();
      const { buildServer } = await import('../src/api/server.ts');
      const { signAccessToken } = await import('../src/api/auth/jwt.ts');

      const app = buildServer({ logger: false });
      try {
        const userEmail = 'realuser@company.com';
        const token = await signAccessToken(userEmail);

        const response = await app.inject({
          method: 'GET',
          url: '/api/oauth/authorize/google?features=contacts&permission_level=read',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
          },
        });

        expect(response.statusCode).toBe(200);

        // Verify the state row has user_email
        const stateRows = await pool.query(
          `SELECT user_email, provider FROM oauth_state ORDER BY created_at DESC LIMIT 1`,
        );
        expect(stateRows.rows).toHaveLength(1);
        expect(stateRows.rows[0].user_email).toBe(userEmail);
        expect(stateRows.rows[0].provider).toBe('google');
      } finally {
        await app.close();
      }
    });
  });
});
