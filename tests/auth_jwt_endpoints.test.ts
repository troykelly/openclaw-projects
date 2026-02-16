import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrate } from './helpers/migrate.ts';
import { buildServer } from '../src/api/server.ts';
import { createPool } from '../src/db.ts';
import { createHash, randomBytes } from 'node:crypto';

// JWT signing requires a secret. Set it before any module imports that need it.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';

/**
 * Integration tests for JWT auth endpoints (Issue #1325, Epic #1322).
 *
 * Tests the full lifecycle:
 *   POST /api/auth/consume      -- magic link -> JWT + refresh cookie
 *   POST /api/auth/refresh      -- rotate refresh token
 *   POST /api/auth/revoke       -- revoke refresh family + clear cookie
 *   POST /api/auth/exchange     -- one-time OAuth code -> JWT + refresh cookie
 *   POST /api/auth/request-link -- updated magic link URL
 *
 * NOTE: These tests create tokens directly in the DB to avoid race conditions
 * with concurrent test suites that truncate tables.
 */
describe('JWT auth endpoints', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Helper: create a magic link token directly in the DB.
   * Returns the raw token string (not hashed).
   */
  async function createMagicLinkToken(email: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tokenSha = createHash('sha256').update(token).digest('hex');
    const pool = createPool({ max: 1 });
    await pool.query(
      `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      [email, tokenSha],
    );
    await pool.end();
    return token;
  }

  /**
   * Helper: consume a magic link token via POST /api/auth/consume.
   * Returns the response from the inject call.
   */
  async function consumeMagicLink(token: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/consume',
      payload: { token },
    });
  }

  /** Helper: extract the refresh cookie value from set-cookie headers. */
  function extractRefreshCookie(headers: Record<string, string | string[] | undefined>): {
    value: string;
    raw: string;
  } | null {
    const setCookie = headers['set-cookie'];
    if (!setCookie) return null;

    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of cookies) {
      if (c.startsWith('projects_refresh=')) {
        const value = c.split(';')[0].split('=').slice(1).join('=');
        return { value, raw: c };
      }
    }
    return null;
  }

  /**
   * Helper: get a valid refresh cookie by creating a magic link and consuming it.
   * Does both steps in quick succession to minimize truncation windows.
   */
  async function getRefreshCookie(email: string): Promise<{ value: string; raw: string }> {
    const token = await createMagicLinkToken(email);
    const res = await consumeMagicLink(token);
    expect(res.statusCode).toBe(200);
    const cookie = extractRefreshCookie(res.headers);
    expect(cookie).toBeTruthy();
    return cookie!;
  }

  // ── POST /api/auth/consume ─────────────────────────────────────────

  describe('POST /api/auth/consume', () => {
    it('consumes magic link and returns accessToken + refresh cookie', async () => {
      const token = await createMagicLinkToken('jwt-consume@example.com');
      const res = await consumeMagicLink(token);

      expect(res.statusCode).toBe(200);
      const body = res.json() as { accessToken?: string };
      expect(body.accessToken).toBeTruthy();
      // JWT format: header.payload.signature
      expect(body.accessToken!.split('.')).toHaveLength(3);

      // Should set refresh cookie
      const cookie = extractRefreshCookie(res.headers);
      expect(cookie).toBeTruthy();
      expect(cookie!.raw.toLowerCase()).toContain('httponly');
      expect(cookie!.raw.toLowerCase()).toContain('samesite=strict');
      expect(cookie!.raw.toLowerCase()).toContain('path=/api/auth');
    });

    it('rejects missing token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'token is required' });
    });

    it('rejects invalid token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token: 'not-a-real-token' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid or expired token' });
    });

    it('rejects already-used token (single-use)', async () => {
      const token = await createMagicLinkToken('jwt-single-use@example.com');

      // First use
      const first = await consumeMagicLink(token);
      expect(first.statusCode).toBe(200);

      // Second use
      const second = await consumeMagicLink(token);
      expect(second.statusCode).toBe(400);
      expect(second.json()).toEqual({ error: 'invalid or expired token' });
    });

    it('rejects expired magic link token', async () => {
      const token = randomBytes(32).toString('base64url');
      const tokenSha = createHash('sha256').update(token).digest('hex');
      const pool = createPool({ max: 1 });
      // Insert with already-expired timestamp
      await pool.query(
        `INSERT INTO auth_magic_link (email, token_sha256, expires_at)
         VALUES ($1, $2, now() - interval '1 minute')`,
        ['jwt-expired@example.com', tokenSha],
      );
      await pool.end();

      const res = await consumeMagicLink(token);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid or expired token' });
    });
  });

  // ── POST /api/auth/refresh ─────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('rotates refresh token and returns new accessToken', async () => {
      const oldCookie = await getRefreshCookie('jwt-refresh@example.com');

      // Refresh
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: {
          cookie: `projects_refresh=${oldCookie.value}`,
        },
      });

      expect(refreshRes.statusCode).toBe(200);
      const body = refreshRes.json() as { accessToken?: string };
      expect(body.accessToken).toBeTruthy();
      expect(body.accessToken!.split('.')).toHaveLength(3);

      // Should set a NEW refresh cookie (rotation)
      const newCookie = extractRefreshCookie(refreshRes.headers);
      expect(newCookie).toBeTruthy();
      expect(newCookie!.value).not.toBe(oldCookie.value);
    });

    it('returns 401 without refresh cookie', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'no refresh token' });
    });

    it('returns 401 with invalid refresh token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: {
          cookie: 'projects_refresh=invalid-token-value',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('detects token reuse and revokes family', async () => {
      const oldCookie = await getRefreshCookie('jwt-reuse@example.com');

      // First refresh -- should succeed
      const firstRefresh = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: {
          cookie: `projects_refresh=${oldCookie.value}`,
        },
      });
      expect(firstRefresh.statusCode).toBe(200);
      const newCookie = extractRefreshCookie(firstRefresh.headers);
      expect(newCookie).toBeTruthy();

      // Expire the grace window so the reuse is detected
      const pool = createPool({ max: 1 });
      await pool.query(
        `UPDATE auth_refresh_token SET grace_expires_at = now() - interval '1 second' WHERE email = $1`,
        ['jwt-reuse@example.com'],
      );
      await pool.end();

      // Attempt to reuse the OLD token -- should trigger family revocation
      const reuseRes = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: {
          cookie: `projects_refresh=${oldCookie.value}`,
        },
      });
      expect(reuseRes.statusCode).toBe(401);

      // The NEW token should also be revoked (entire family revoked)
      const afterRevokeRes = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: {
          cookie: `projects_refresh=${newCookie!.value}`,
        },
      });
      expect(afterRevokeRes.statusCode).toBe(401);
    });
  });

  // ── POST /api/auth/revoke ──────────────────────────────────────────

  describe('POST /api/auth/revoke', () => {
    it('revokes refresh family and clears cookie', async () => {
      const cookie = await getRefreshCookie('jwt-revoke@example.com');

      // Revoke
      const revokeRes = await app.inject({
        method: 'POST',
        url: '/api/auth/revoke',
        headers: {
          cookie: `projects_refresh=${cookie.value}`,
        },
      });

      expect(revokeRes.statusCode).toBe(200);
      expect(revokeRes.json()).toEqual({ ok: true });

      // Check cookie is cleared (empty value or max-age=0)
      const clearedCookie = extractRefreshCookie(revokeRes.headers);
      if (clearedCookie) {
        // Cookie should be cleared -- empty value or max-age=0
        const raw = clearedCookie.raw.toLowerCase();
        const isCleared = clearedCookie.value === '' || raw.includes('max-age=0');
        expect(isCleared).toBe(true);
      }

      // Attempt to refresh with the old token -- should fail
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: {
          cookie: `projects_refresh=${cookie.value}`,
        },
      });
      expect(refreshRes.statusCode).toBe(401);
    });

    it('returns ok even without refresh cookie (idempotent)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/revoke',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  // ── POST /api/auth/exchange ────────────────────────────────────────

  describe('POST /api/auth/exchange', () => {
    /** Helper: create a one-time code directly in the DB. */
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

    it('exchanges valid code for accessToken + refresh cookie', async () => {
      const code = await createOneTimeCode('jwt-exchange@example.com');

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { accessToken?: string };
      expect(body.accessToken).toBeTruthy();
      expect(body.accessToken!.split('.')).toHaveLength(3);

      const cookie = extractRefreshCookie(res.headers);
      expect(cookie).toBeTruthy();
      expect(cookie!.raw.toLowerCase()).toContain('httponly');
    });

    it('rejects missing code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'code is required' });
    });

    it('rejects invalid code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code: 'bogus-code' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid or expired code' });
    });

    it('rejects already-used code (single-use)', async () => {
      const code = await createOneTimeCode('jwt-exchange-reuse@example.com');

      // First use
      const first = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code },
      });
      expect(first.statusCode).toBe(200);

      // Second use
      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code },
      });
      expect(second.statusCode).toBe(400);
      expect(second.json()).toEqual({ error: 'invalid or expired code' });
    });

    it('rejects expired code', async () => {
      const code = randomBytes(32).toString('base64url');
      const codeSha = createHash('sha256').update(code).digest('hex');
      const pool = createPool({ max: 1 });
      await pool.query(
        `INSERT INTO auth_one_time_code (code_sha256, email, expires_at)
         VALUES ($1, $2, now() - interval '1 second')`,
        [codeSha, 'jwt-exchange-expired@example.com'],
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

  // ── POST /api/auth/request-link (updated URL) ─────────────────────

  describe('POST /api/auth/request-link (updated magic link URL)', () => {
    it('generates magic link pointing to app domain /app/auth/consume', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/request-link',
        payload: { email: 'jwt-link-url@example.com' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { loginUrl?: string };
      expect(body.loginUrl).toBeTruthy();

      // URL should point to /app/auth/consume (SPA route), not /api/auth/consume
      const url = new URL(body.loginUrl!);
      expect(url.pathname).toBe('/app/auth/consume');
      expect(url.searchParams.get('token')).toBeTruthy();
    });
  });

  // ── Old GET /api/auth/consume removed ──────────────────────────────

  describe('Old GET /api/auth/consume removed', () => {
    it('returns 404 for GET /api/auth/consume', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/consume?token=anything',
      });
      // Should be 404 (route no longer exists)
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Auth skip paths ────────────────────────────────────────────────

  describe('Auth skip paths include new endpoints', () => {
    it('POST /api/auth/consume does not require Bearer token', async () => {
      // Even without a Bearer token, should get 400 (bad request) not 401
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/consume',
        payload: { token: 'test' },
      });
      // Should be 400 (invalid token), not 401 (unauthorized)
      expect(res.statusCode).toBe(400);
    });

    it('POST /api/auth/refresh does not require Bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
      });
      // Should be 401 (no refresh cookie), not from the auth middleware
      expect(res.json()).toEqual({ error: 'no refresh token' });
    });

    it('POST /api/auth/revoke does not require Bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/revoke',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('POST /api/auth/exchange does not require Bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/exchange',
        payload: { code: 'test' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
