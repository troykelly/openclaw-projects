/**
 * Magic Link Single-Use Token Tests
 * Part of Issue #781 - Documents and verifies the single-use token security behavior
 *
 * IMPORTANT: Magic link tokens are SINGLE-USE by design.
 * - Tokens are consumed on first use (via POST /api/auth/consume endpoint)
 * - Attempting to reuse a consumed token returns 400 (invalid/expired token)
 * - This is a critical security feature - do not change without security review
 *
 * Developer Note: When testing magic links during development:
 * - Generate a new link for each browser session
 * - Do NOT test with curl/wget before opening in browser
 * - The scripts/dev-setup.sh --link command warns about this
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

const TEST_TIMEOUT = 30_000;
const HOOK_TIMEOUT = 60_000;

describe('Magic Link Single-Use Security (Issue #781)', () => {
  vi.setConfig({ testTimeout: TEST_TIMEOUT, hookTimeout: HOOK_TIMEOUT });

  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  describe('Token Security', () => {
    it('token can only be used once (single-use security)', async () => {
      const testEmail = 'single-use@example.com';

      // Step 1: Request a magic link
      const requestRes = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        payload: { email: testEmail },
      });

      expect(requestRes.statusCode).toBe(201);
      const { loginUrl } = requestRes.json() as { loginUrl: string };
      const token = new URL(loginUrl).searchParams.get('token')!;

      // Step 2: First use - should succeed (POST with token in body)
      const firstUse = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token },
      });

      expect(firstUse.statusCode).toBe(200);
      const firstBody = firstUse.json() as { accessToken?: string };
      expect(firstBody.accessToken).toBeDefined();

      // Step 3: Second use - should fail (token already consumed)
      const secondUse = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token },
      });

      // Token should be invalid after first use (API returns 400 for invalid tokens)
      expect(secondUse.statusCode).toBe(400);
      expect(secondUse.json()).toHaveProperty('error');
    });

    it('expired tokens are rejected', async () => {
      const testEmail = 'expired@example.com';

      // Request a link
      const requestRes = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        payload: { email: testEmail },
      });

      const { loginUrl } = requestRes.json() as { loginUrl: string };
      const token = new URL(loginUrl).searchParams.get('token')!;

      // Manually expire the token in the database
      await pool.query(`UPDATE auth_magic_link SET expires_at = NOW() - INTERVAL '1 hour' WHERE email = $1`, [testEmail]);

      // Try to use expired token
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token },
      });

      // API returns 400 for invalid/expired tokens
      expect(res.statusCode).toBe(400);
    });

    it('invalid tokens are rejected', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token: 'invalid-token-that-does-not-exist' },
      });

      // API returns 400 for invalid tokens
      expect(res.statusCode).toBe(400);
      expect(res.json()).toHaveProperty('error');
    });

    it('missing token parameter returns error', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('User Experience', () => {
    it('returns JSON with accessToken for API requests', async () => {
      const testEmail = 'api@example.com';

      // Request a link
      const requestRes = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        payload: { email: testEmail },
      });

      const { loginUrl } = requestRes.json() as { loginUrl: string };
      const token = new URL(loginUrl).searchParams.get('token')!;

      // Consume token
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { accessToken?: string };
      expect(body.accessToken).toBeDefined();
      expect(typeof body.accessToken).toBe('string');
    });

    it('sets refresh cookie on successful authentication', async () => {
      const testEmail = 'session@example.com';

      // Request a link
      const requestRes = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        payload: { email: testEmail },
      });

      const { loginUrl } = requestRes.json() as { loginUrl: string };
      const token = new URL(loginUrl).searchParams.get('token')!;

      // Consume token
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token },
      });

      expect(res.statusCode).toBe(200);

      // Should set a refresh cookie
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
    });
  });

  describe('Rate Limiting Awareness', () => {
    it('allows multiple link requests for same email', async () => {
      const testEmail = 'multiple@example.com';

      // Request multiple links in succession
      const requests = Array(3)
        .fill(null)
        .map(() =>
          app.inject({
            method: 'POST',
            url: '/api/auth/request-link',
            payload: { email: testEmail },
          }),
        );

      const responses = await Promise.all(requests);

      // All should succeed (rate limiting disabled in test mode)
      expect(responses.every((r) => r.statusCode === 201)).toBe(true);
    });
  });
});
