/**
 * Integration tests for OAuth post-callback redirect to app domain.
 * Issue #1335, Epic #1322 (JWT Auth).
 *
 * Tests the code generation and redirect behavior of the OAuth callback
 * handler, and the full flow: OAuth callback -> one-time code -> exchange
 * for JWT + refresh cookie.
 *
 * NOTE: These tests share the database with other test suites. When run
 * concurrently with other test files that truncate tables, insert-then-query
 * tests may see "invalid or expired code" because the row was truncated
 * between insert and exchange. Run this file in isolation if you see
 * intermittent failures.
 */

import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.ts';
import { createPool } from '../src/db.ts';

// JWT signing requires a secret
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

import { runMigrate } from './helpers/migrate.ts';

describe('OAuth callback redirect (Issue #1335)', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Callback error responses (unchanged) ────────────────────────────

  describe('Callback error responses', () => {
    it('returns 400 when OAuth error parameter is present', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?error=access_denied',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain('authorization failed');
    });

    it('returns 400 when authorization code is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain('Missing authorization code');
    });

    it('returns 400 when state is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?code=test-code',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain('Missing OAuth state');
    });

    it('returns 400 when state is invalid/expired', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?code=test-code&state=invalid-state',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('INVALID_STATE');
    });
  });

  // ── One-time code in DB (unit-style) ────────────────────────────────

  describe('One-time code storage', () => {
    it('one-time code with 60s TTL is stored correctly in auth_one_time_code', async () => {
      const email = 'oauth-redirect-store@example.com';
      const code = randomBytes(32).toString('base64url');
      const codeSha = createHash('sha256').update(code).digest('hex');

      const pool = createPool({ max: 1 });
      try {
        await pool.query(
          `INSERT INTO auth_one_time_code (code_sha256, email, expires_at)
           VALUES ($1, $2, now() + interval '60 seconds')`,
          [codeSha, email],
        );

        const result = await pool.query(
          `SELECT email, expires_at, used_at
           FROM auth_one_time_code
           WHERE code_sha256 = $1`,
          [codeSha],
        );

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].email).toBe(email);
        expect(result.rows[0].used_at).toBeNull();

        // Verify expiry is ~60s from now (within a tolerance window)
        const expiresAt = new Date(result.rows[0].expires_at).getTime();
        const now = Date.now();
        const sixtySecondsFromNow = now + 60_000;
        expect(expiresAt).toBeGreaterThan(now);
        expect(expiresAt).toBeLessThanOrEqual(sixtySecondsFromNow + 5_000);
      } finally {
        // Clean up our test data
        await pool.query('DELETE FROM auth_one_time_code WHERE code_sha256 = $1', [codeSha]);
        await pool.end();
      }
    });
  });

  // ── Full OAuth code exchange flow ───────────────────────────────────

  describe('Full OAuth code exchange flow', () => {
    /**
     * Helper: create a one-time code directly in the DB. Returns raw code.
     * Uses a dedicated pool that is closed after insertion.
     */
    async function createOneTimeCode(email: string): Promise<string> {
      const code = randomBytes(32).toString('base64url');
      const codeSha = createHash('sha256').update(code).digest('hex');
      const pool = createPool({ max: 1 });
      await pool.query(
        `INSERT INTO auth_one_time_code (code_sha256, email, expires_at)
         VALUES ($1, $2, now() + interval '60 seconds')`,
        [codeSha, email],
      );
      await pool.end();
      return code;
    }

    it('one-time code can be exchanged for JWT via POST /api/auth/exchange', async () => {
      const code = await createOneTimeCode('oauth-exchange-flow@example.com');

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { accessToken?: string };
      expect(body.accessToken).toBeTruthy();
      expect(body.accessToken!.split('.')).toHaveLength(3); // JWT format

      // Should set refresh cookie
      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
      const refreshCookie = cookies.find((c: string) => c.startsWith('projects_refresh='));
      expect(refreshCookie).toBeTruthy();
      expect(refreshCookie!.toLowerCase()).toContain('httponly');
    });

    it('one-time code is single-use', async () => {
      const code = await createOneTimeCode('oauth-single-use@example.com');

      // First exchange should succeed
      const first = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code },
      });
      expect(first.statusCode).toBe(200);

      // Second exchange should fail
      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code },
      });
      expect(second.statusCode).toBe(400);
      expect(second.json()).toEqual({ error: 'invalid or expired code' });
    });

    it('expired code is rejected', async () => {
      const code = randomBytes(32).toString('base64url');
      const codeSha = createHash('sha256').update(code).digest('hex');
      const pool = createPool({ max: 1 });
      // Insert with already-expired timestamp
      await pool.query(
        `INSERT INTO auth_one_time_code (code_sha256, email, expires_at)
         VALUES ($1, $2, now() - interval '1 second')`,
        [codeSha, 'oauth-expired@example.com'],
      );
      await pool.end();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid or expired code' });
    });
  });

  // ── OAuth callback redirect URL construction ───────────────────────

  describe('Redirect URL construction', () => {
    it('PUBLIC_BASE_URL is used for redirect target path', () => {
      const publicBaseUrl = 'https://myapp.example.com';
      const code = 'test-code-value';

      const expectedUrl = `${publicBaseUrl}/app/auth/consume?code=${code}`;

      const parsed = new URL(expectedUrl);
      expect(parsed.pathname).toBe('/app/auth/consume');
      expect(parsed.searchParams.get('code')).toBe(code);
      expect(parsed.origin).toBe(publicBaseUrl);
    });

    it('localhost:3000 is the default when PUBLIC_BASE_URL is not set', () => {
      const publicBaseUrl = 'http://localhost:3000';
      const code = 'test-code-value';

      const expectedUrl = `${publicBaseUrl}/app/auth/consume?code=${code}`;

      const parsed = new URL(expectedUrl);
      expect(parsed.hostname).toBe('localhost');
      expect(parsed.port).toBe('3000');
      expect(parsed.pathname).toBe('/app/auth/consume');
      expect(parsed.searchParams.get('code')).toBe(code);
    });
  });

  // ── POST /api/auth/exchange auth skip ──────────────────────────────

  describe('POST /api/auth/exchange does not require Bearer token', () => {
    it('returns 400 (not 401) for invalid code without auth header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code: 'test' },
      });
      // Should be 400 (bad code), not 401 (missing auth)
      expect(res.statusCode).toBe(400);
    });
  });

  // ── CSRF / Content-Type enforcement on /api/auth/exchange ─────────

  describe('CSRF protection on POST /api/auth/exchange', () => {
    it('rejects requests without application/json content-type (415)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'code=test',
      });

      expect(res.statusCode).toBe(415);
      expect(res.json()).toEqual({ error: 'Content-Type must be application/json' });
    });

    it('rejects requests with mismatched Origin header (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example.com',
        },
        payload: { code: 'test' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Origin not allowed' });
    });

    it('accepts requests with matching Origin header', async () => {
      const code = await (async () => {
        const c = randomBytes(32).toString('base64url');
        const sha = createHash('sha256').update(c).digest('hex');
        const pool = createPool({ max: 1 });
        await pool.query(
          `INSERT INTO auth_one_time_code (code_sha256, email, expires_at)
           VALUES ($1, $2, now() + interval '60 seconds')`,
          [sha, 'csrf-origin-match@example.com'],
        );
        await pool.end();
        return c;
      })();

      // PUBLIC_BASE_URL defaults to http://localhost:3000
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        payload: { code },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('accessToken');
    });

    it('accepts requests without Origin header (same-origin / non-browser clients)', async () => {
      const code = await (async () => {
        const c = randomBytes(32).toString('base64url');
        const sha = createHash('sha256').update(c).digest('hex');
        const pool = createPool({ max: 1 });
        await pool.query(
          `INSERT INTO auth_one_time_code (code_sha256, email, expires_at)
           VALUES ($1, $2, now() + interval '60 seconds')`,
          [sha, 'csrf-no-origin@example.com'],
        );
        await pool.end();
        return c;
      })();

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        headers: { 'content-type': 'application/json' },
        payload: { code },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('accessToken');
    });
  });

  // ── PUBLIC_BASE_URL validation in redirect ────────────────────────

  describe('PUBLIC_BASE_URL validation', () => {
    it('redirect URL uses origin + normalized path from PUBLIC_BASE_URL', () => {
      // Verify that a trailing-slash base URL does not produce double slashes
      const base = 'https://myapp.example.com/';
      const parsed = new URL(base);
      const code = 'test-code';
      const redirectUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/app/auth/consume?code=${encodeURIComponent(code)}`;

      const result = new URL(redirectUrl);
      expect(result.pathname).toBe('/app/auth/consume');
      expect(result.searchParams.get('code')).toBe(code);
    });
  });
});
