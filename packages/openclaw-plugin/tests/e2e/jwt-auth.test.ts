/**
 * JWT Auth E2E Tests — Issue #1351
 *
 * Tests the full JWT authentication lifecycle against an auth-enabled backend.
 * Unlike the standard E2E suite (which runs with auth disabled), this suite
 * verifies:
 *   - Magic link request -> consume -> JWT returned
 *   - JWT used for authenticated API calls
 *   - Token refresh flow (cookie-based)
 *   - Token revocation (logout)
 *   - M2M token authentication
 *
 * Requires:
 *   - backend-auth-test service from docker-compose.test.yml (port 3002)
 *   - JWT_SECRET configured on the backend
 *   - RUN_E2E=true environment variable
 */

import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { testData, waitForService } from './setup.js';

/** Well-known test JWT secret matching docker-compose.test.yml */
const TEST_JWT_SECRET = 'e2e-test-jwt-secret-that-is-at-least-32-bytes-long';

/** Base URL for the auth-enabled backend */
const AUTH_API_URL = process.env.E2E_AUTH_API_URL || 'http://localhost:3002';

const RUN_E2E = process.env.RUN_E2E === 'true';

/**
 * Raw fetch wrapper that preserves response headers and cookies.
 * The standard E2E apiClient discards headers, but auth tests need
 * access to Set-Cookie and status codes.
 */
async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${AUTH_API_URL}${path}`, options);
}

/**
 * Extracts the projects_refresh cookie value from a Set-Cookie header.
 */
function extractRefreshCookie(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/projects_refresh=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Signs a test M2M token using the well-known test secret.
 * This simulates what an external service (e.g. OpenClaw gateway) would do.
 */
async function signTestM2MToken(serviceId: string, scopes: string[] = ['api:full']): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  const claims: Record<string, unknown> = { type: 'm2m' };
  if (scopes.length > 0) {
    claims.scope = scopes.join(' ');
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', kid: 'e2e-test' })
    .setSubject(serviceId)
    .setIssuer('openclaw-projects')
    .setIssuedAt()
    .setExpirationTime('1h')
    .setJti(crypto.randomUUID())
    .sign(secret);
}

describe.skipIf(!RUN_E2E)('JWT Auth E2E', () => {
  beforeAll(async () => {
    await waitForService(`${AUTH_API_URL}/api/health`, 30, 2000);
  });

  describe('Unauthenticated Access', () => {
    it('should return 401 for API calls without a token', async () => {
      const response = await authFetch('/api/work-items');
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('unauthorized');
    });

    it('should allow access to health endpoints without auth', async () => {
      const response = await authFetch('/api/health');
      expect(response.ok).toBe(true);
    });

    it('should allow access to capabilities endpoint without auth', async () => {
      const response = await authFetch('/api/capabilities');
      expect(response.ok).toBe(true);
    });
  });

  describe('Magic Link -> Consume -> JWT', () => {
    let magicLinkToken: string;
    let access_token: string;
    let refreshCookie: string;
    const testEmail = testData.uniqueEmail();

    it('should request a magic link', async () => {
      const response = await authFetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.ok).toBe(true);
      // In test mode, email is not delivered so loginUrl is returned
      expect(body.loginUrl).toBeDefined();

      // Extract the token from the login URL
      const url = new URL(body.loginUrl);
      magicLinkToken = url.searchParams.get('token')!;
      expect(magicLinkToken).toBeTruthy();
    });

    it('should consume the magic link and return a JWT', async () => {
      const response = await authFetch('/api/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: magicLinkToken }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.access_token).toBeDefined();
      expect(typeof body.access_token).toBe('string');
      access_token = body.access_token;

      // Should set a refresh token cookie
      const cookie = extractRefreshCookie(response);
      expect(cookie).toBeTruthy();
      refreshCookie = cookie!;
    });

    it('should reject a consumed magic link token', async () => {
      const response = await authFetch('/api/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: magicLinkToken }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/invalid or expired/);
    });

    it('should make authenticated API calls with the JWT', async () => {
      const response = await authFetch('/api/work-items', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.items).toBeDefined();
    });

    it('should return user identity via /api/me', async () => {
      const response = await authFetch('/api/me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.email).toBe(testEmail);
    });
  });

  describe('Token Refresh Flow', () => {
    let access_token: string;
    let refreshCookie: string;
    const testEmail = testData.uniqueEmail();

    beforeAll(async () => {
      // Get initial tokens via magic link flow
      const linkRes = await authFetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });
      const linkBody = await linkRes.json();
      const token = new URL(linkBody.loginUrl).searchParams.get('token')!;

      const consumeRes = await authFetch('/api/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const consumeBody = await consumeRes.json();
      access_token = consumeBody.access_token;
      refreshCookie = extractRefreshCookie(consumeRes)!;
    });

    it('should refresh the access token using the refresh cookie', async () => {
      const response = await authFetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          Cookie: `projects_refresh=${refreshCookie}`,
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.access_token).toBeDefined();
      expect(typeof body.access_token).toBe('string');
      // New access token should be different from the old one
      expect(body.access_token).not.toBe(access_token);

      // Should set a new refresh cookie (rotation)
      const newCookie = extractRefreshCookie(response);
      expect(newCookie).toBeTruthy();
      expect(newCookie).not.toBe(refreshCookie);

      // New access token should work
      const apiRes = await authFetch('/api/work-items', {
        headers: { Authorization: `Bearer ${body.access_token}` },
      });
      expect(apiRes.ok).toBe(true);
    });

    it('should reject refresh without a cookie', async () => {
      const response = await authFetch('/api/auth/refresh', {
        method: 'POST',
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toMatch(/no refresh token/);
    });

    it('should reject refresh with an invalid cookie', async () => {
      const response = await authFetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          Cookie: 'projects_refresh=invalid-token-value',
        },
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Token Revocation (Logout)', () => {
    let refreshCookie: string;

    beforeAll(async () => {
      const testEmail = testData.uniqueEmail();
      const linkRes = await authFetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });
      const linkBody = await linkRes.json();
      const token = new URL(linkBody.loginUrl).searchParams.get('token')!;

      const consumeRes = await authFetch('/api/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      refreshCookie = extractRefreshCookie(consumeRes)!;
    });

    it('should revoke the refresh token family (logout)', async () => {
      const response = await authFetch('/api/auth/revoke', {
        method: 'POST',
        headers: {
          Cookie: `projects_refresh=${refreshCookie}`,
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);

      // Should clear the refresh cookie (maxAge=0)
      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toContain('projects_refresh=');
      expect(setCookie).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);
    });

    it('should reject refresh after revocation', async () => {
      const response = await authFetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          Cookie: `projects_refresh=${refreshCookie}`,
        },
      });

      expect(response.status).toBe(401);
    });

    it('should handle revoke with no cookie gracefully', async () => {
      const response = await authFetch('/api/auth/revoke', {
        method: 'POST',
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
    });
  });

  describe('M2M Token Authentication', () => {
    it('should authenticate with a valid M2M token', async () => {
      const m2mToken = await signTestM2MToken('e2e-test-service');

      const response = await authFetch('/api/work-items', {
        headers: { Authorization: `Bearer ${m2mToken}` },
      });

      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.items).toBeDefined();
    });

    it('should reject M2M token with wrong secret', async () => {
      const wrongSecret = new TextEncoder().encode('wrong-secret-that-is-at-least-32-bytes-long!!');
      const badToken = await new SignJWT({ type: 'm2m' })
        .setProtectedHeader({ alg: 'HS256', kid: 'wrong' })
        .setSubject('bad-service')
        .setIssuer('openclaw-projects')
        .setIssuedAt()
        .setExpirationTime('1h')
        .setJti(crypto.randomUUID())
        .sign(wrongSecret);

      const response = await authFetch('/api/work-items', {
        headers: { Authorization: `Bearer ${badToken}` },
      });

      expect(response.status).toBe(401);
    });

    it('should reject an expired M2M token', async () => {
      const secret = new TextEncoder().encode(TEST_JWT_SECRET);
      const expiredToken = await new SignJWT({ type: 'm2m' })
        .setProtectedHeader({ alg: 'HS256', kid: 'e2e-test' })
        .setSubject('expired-service')
        .setIssuer('openclaw-projects')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .setJti(crypto.randomUUID())
        .sign(secret);

      const response = await authFetch('/api/work-items', {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });

      expect(response.status).toBe(401);
    });

    it('should reject a token with invalid issuer for M2M type', async () => {
      const secret = new TextEncoder().encode(TEST_JWT_SECRET);
      const badIssuerToken = await new SignJWT({ type: 'm2m' })
        .setProtectedHeader({ alg: 'HS256', kid: 'e2e-test' })
        .setSubject('bad-issuer-service')
        .setIssuer('wrong-issuer')
        .setIssuedAt()
        .setExpirationTime('1h')
        .setJti(crypto.randomUUID())
        .sign(secret);

      const response = await authFetch('/api/work-items', {
        headers: { Authorization: `Bearer ${badIssuerToken}` },
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Invalid Token Handling', () => {
    it('should reject a malformed JWT', async () => {
      const response = await authFetch('/api/work-items', {
        headers: { Authorization: 'Bearer not-a-jwt' },
      });

      expect(response.status).toBe(401);
    });

    it('should reject an empty Bearer token', async () => {
      const response = await authFetch('/api/work-items', {
        headers: { Authorization: 'Bearer ' },
      });

      expect(response.status).toBe(401);
    });

    it('should reject non-Bearer authorization', async () => {
      const response = await authFetch('/api/work-items', {
        headers: { Authorization: 'Basic dGVzdDp0ZXN0' },
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Magic Link Edge Cases', () => {
    it('should reject consume with no token', async () => {
      const response = await authFetch('/api/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/token is required/);
    });

    it('should reject consume with an invalid token', async () => {
      const response = await authFetch('/api/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'completely-invalid-token' }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/invalid or expired/);
    });

    it('should reject request-link with invalid email', async () => {
      const response = await authFetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      });

      expect(response.status).toBe(400);
    });

    it('should reject request-link with no email', async () => {
      const response = await authFetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    });
  });
});
