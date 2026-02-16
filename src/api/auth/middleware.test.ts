import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const TEST_SECRET = 'a]Uf9$Lx2!Qm7Kp@Wz4Rn8Yb6Hd3Jt0Vs'; // 36 chars, > 32 bytes

describe('JWT auth middleware', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
    vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Create a minimal fake FastifyRequest with the given headers. */
  function fakeRequest(headers: Record<string, string | undefined> = {}): FastifyRequest {
    return { headers } as unknown as FastifyRequest;
  }

  async function loadMiddleware() {
    return import('./middleware.ts');
  }

  async function loadJwt() {
    return import('./jwt.ts');
  }

  describe('getAuthIdentity', () => {
    it('should return identity for a valid user JWT', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('user@example.com');
      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(
        fakeRequest({ authorization: `Bearer ${token}` }),
      );

      expect(identity).not.toBeNull();
      expect(identity!.email).toBe('user@example.com');
      expect(identity!.type).toBe('user');
      expect(identity!.scopes).toBeUndefined();
    });

    it('should return identity for a valid M2M JWT with scopes', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('service@example.com', {
        type: 'm2m',
        scopes: ['read:work-items', 'write:work-items'],
      });
      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(
        fakeRequest({ authorization: `Bearer ${token}` }),
      );

      expect(identity).not.toBeNull();
      expect(identity!.email).toBe('service@example.com');
      expect(identity!.type).toBe('m2m');
      expect(identity!.scopes).toEqual(['read:work-items', 'write:work-items']);
    });

    it('should return null when no Authorization header is present', async () => {
      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(fakeRequest());
      expect(identity).toBeNull();
    });

    it('should return null for non-Bearer authorization', async () => {
      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(
        fakeRequest({ authorization: 'Basic dXNlcjpwYXNz' }),
      );
      expect(identity).toBeNull();
    });

    it('should return null for empty Bearer token', async () => {
      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(
        fakeRequest({ authorization: 'Bearer ' }),
      );
      expect(identity).toBeNull();
    });

    it('should return null for an invalid JWT', async () => {
      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(
        fakeRequest({ authorization: 'Bearer not-a-valid-jwt' }),
      );
      expect(identity).toBeNull();
    });

    it('should return null for an expired JWT', async () => {
      const { SignJWT } = await import('jose');

      const nowSec = Math.floor(Date.now() / 1000);
      const expiredToken = await new SignJWT({ type: 'user' })
        .setProtectedHeader({ alg: 'HS256', kid: 'test' })
        .setSubject('user@example.com')
        .setIssuedAt(nowSec - 20 * 60)
        .setExpirationTime(nowSec - 2 * 60)
        .setJti('expired-jti')
        .sign(new TextEncoder().encode(TEST_SECRET));

      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(
        fakeRequest({ authorization: `Bearer ${expiredToken}` }),
      );
      expect(identity).toBeNull();
    });

    it('should return null for a JWT signed with wrong secret', async () => {
      const { SignJWT } = await import('jose');

      const nowSec = Math.floor(Date.now() / 1000);
      const wrongKeyToken = await new SignJWT({ type: 'user' })
        .setProtectedHeader({ alg: 'HS256', kid: 'test' })
        .setSubject('user@example.com')
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + 900)
        .setJti('wrong-key-jti')
        .sign(new TextEncoder().encode('Z9a8b7c6d5e4f3g2h1i0j9k8l7m6n5o4'));

      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(
        fakeRequest({ authorization: `Bearer ${wrongKeyToken}` }),
      );
      expect(identity).toBeNull();
    });

    it('should return E2E bypass identity when auth disabled and E2E email set', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', 'e2e@test.com');
      vi.resetModules();

      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(fakeRequest());
      expect(identity).not.toBeNull();
      expect(identity!.email).toBe('e2e@test.com');
      expect(identity!.type).toBe('user');
    });

    it('should prefer JWT over E2E bypass when both are available (Issue #1353)', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', 'e2e@test.com');
      vi.resetModules();

      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('jwt-user@example.com');
      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(
        fakeRequest({ authorization: `Bearer ${token}` }),
      );

      expect(identity).not.toBeNull();
      expect(identity!.email).toBe('jwt-user@example.com');
      expect(identity!.type).toBe('user');
    });

    it('should prefer M2M JWT over E2E bypass when both are available (Issue #1353)', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', 'e2e@test.com');
      vi.resetModules();

      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('gateway-service', { type: 'm2m' });
      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(
        fakeRequest({ authorization: `Bearer ${token}` }),
      );

      expect(identity).not.toBeNull();
      expect(identity!.email).toBe('gateway-service');
      expect(identity!.type).toBe('m2m');
    });

    it('should NOT E2E bypass when only auth is disabled (no E2E email)', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.resetModules();

      const { getAuthIdentity } = await loadMiddleware();

      const identity = await getAuthIdentity(fakeRequest());
      expect(identity).toBeNull();
    });

    it('should NOT E2E bypass when only E2E email is set (auth not disabled)', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', '');
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', 'e2e@test.com');
      vi.resetModules();

      const { getAuthIdentity } = await loadMiddleware();

      // No JWT → null (E2E bypass requires BOTH conditions)
      const identity = await getAuthIdentity(fakeRequest());
      expect(identity).toBeNull();
    });
  });

  describe('getSessionEmail', () => {
    it('should return the email from a valid JWT', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('user@example.com');
      const { getSessionEmail } = await loadMiddleware();

      const email = await getSessionEmail(
        fakeRequest({ authorization: `Bearer ${token}` }),
      );

      expect(email).toBe('user@example.com');
    });

    it('should return null when no valid JWT is present', async () => {
      const { getSessionEmail } = await loadMiddleware();

      const email = await getSessionEmail(fakeRequest());
      expect(email).toBeNull();
    });

    it('should return E2E email when E2E bypass is active', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', 'e2e@test.com');
      vi.resetModules();

      const { getSessionEmail } = await loadMiddleware();

      const email = await getSessionEmail(fakeRequest());
      expect(email).toBe('e2e@test.com');
    });

    it('should return email from M2M token', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('service@example.com', { type: 'm2m' });
      const { getSessionEmail } = await loadMiddleware();

      const email = await getSessionEmail(
        fakeRequest({ authorization: `Bearer ${token}` }),
      );

      expect(email).toBe('service@example.com');
    });
  });

  describe('resolveUserEmail', () => {
    it('should return the authenticated user email for user tokens, ignoring requested email', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('alice@example.com');
      const { resolveUserEmail } = await loadMiddleware();

      const result = await resolveUserEmail(
        fakeRequest({ authorization: `Bearer ${token}` }),
        'bob@example.com', // attacker tries to access bob's data
      );

      expect(result).toBe('alice@example.com');
    });

    it('should return the authenticated user email even when no requested email is provided', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('alice@example.com');
      const { resolveUserEmail } = await loadMiddleware();

      const result = await resolveUserEmail(
        fakeRequest({ authorization: `Bearer ${token}` }),
        undefined,
      );

      expect(result).toBe('alice@example.com');
    });

    it('should allow M2M tokens to pass through any requested email', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('gateway-service', { type: 'm2m' });
      const { resolveUserEmail } = await loadMiddleware();

      const result = await resolveUserEmail(
        fakeRequest({ authorization: `Bearer ${token}` }),
        'bob@example.com',
      );

      expect(result).toBe('bob@example.com');
    });

    it('should return null for M2M tokens when no requested email is provided', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('gateway-service', { type: 'm2m' });
      const { resolveUserEmail } = await loadMiddleware();

      const result = await resolveUserEmail(
        fakeRequest({ authorization: `Bearer ${token}` }),
        undefined,
      );

      expect(result).toBeNull();
    });

    it('should return null when no authentication is present', async () => {
      const { resolveUserEmail } = await loadMiddleware();

      const result = await resolveUserEmail(fakeRequest(), 'bob@example.com');

      expect(result).toBeNull();
    });

    it('should passthrough requested email when auth is disabled', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.resetModules();

      const { resolveUserEmail } = await loadMiddleware();

      const result = await resolveUserEmail(fakeRequest(), 'bob@example.com');

      expect(result).toBe('bob@example.com');
    });

    it('should return null when auth is disabled and no email is provided', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.resetModules();

      const { resolveUserEmail } = await loadMiddleware();

      const result = await resolveUserEmail(fakeRequest(), undefined);

      expect(result).toBeNull();
    });

    it('should trim whitespace from requested email for M2M tokens', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('gateway-service', { type: 'm2m' });
      const { resolveUserEmail } = await loadMiddleware();

      const result = await resolveUserEmail(
        fakeRequest({ authorization: `Bearer ${token}` }),
        '  bob@example.com  ',
      );

      expect(result).toBe('bob@example.com');
    });

    it('should return user email when user token sends empty string as requested email', async () => {
      const { signAccessToken } = await loadJwt();
      const token = await signAccessToken('alice@example.com');
      const { resolveUserEmail } = await loadMiddleware();

      const result = await resolveUserEmail(
        fakeRequest({ authorization: `Bearer ${token}` }),
        '',
      );

      expect(result).toBe('alice@example.com');
    });
  });
});
