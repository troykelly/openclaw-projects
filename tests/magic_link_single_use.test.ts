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
 *
 * Updated for JWT auth migration (Issue #1325): GET /api/auth/consume replaced by POST.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

// JWT signing requires a secret.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

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

      // Step 2: First use - should succeed (POST /api/auth/consume)
      const firstUse = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token },
      });

      expect(firstUse.statusCode).toBe(200);
      const body = firstUse.json() as { accessToken?: string };
      expect(body.accessToken).toBeTruthy();
      expect(firstUse.headers['set-cookie']).toBeDefined();

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
    it('returns accessToken and refresh cookie on consume', async () => {
      const testEmail = 'jwt-consume@example.com';

      // Request a link
      const requestRes = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        payload: { email: testEmail },
      });

      const { loginUrl } = requestRes.json() as { loginUrl: string };
      const token = new URL(loginUrl).searchParams.get('token')!;

      // Consume via POST
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { accessToken?: string };
      expect(body.accessToken).toBeTruthy();
      // JWT format: header.payload.signature
      expect(body.accessToken!.split('.')).toHaveLength(3);
    });

    it('sets HttpOnly refresh cookie on successful authentication', async () => {
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

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();

      // Verify cookie contains refresh token identifier
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie!];
      const refreshCookie = cookies.find((c: string) => c.startsWith('projects_refresh='));
      expect(refreshCookie).toBeTruthy();

      // Verify security attributes
      const cookieLower = refreshCookie!.toLowerCase();
      expect(cookieLower).toContain('httponly');
      expect(cookieLower).toContain('samesite=strict');
      expect(cookieLower).toContain('path=/api/auth');
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
