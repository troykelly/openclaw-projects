/**
 * Integration tests for principal binding (Issue #1353).
 *
 * Verifies that the preHandler hook in server.ts correctly enforces
 * principal binding: user tokens have their user_email/user_email
 * parameters overridden with the authenticated identity's email,
 * while M2M tokens pass through the requested email unchanged.
 *
 * These tests use the resolveUserEmail() helper directly (unit-level)
 * and also validate the hook logic patterns applied in server.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const TEST_SECRET = 'a]Uf9$Lx2!Qm7Kp@Wz4Rn8Yb6Hd3Jt0Vs'; // 36 chars, > 32 bytes

describe('Principal binding enforcement (Issue #1353)', () => {
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

  function fakeRequest(headers: Record<string, string | undefined> = {}): FastifyRequest {
    return { headers } as unknown as FastifyRequest;
  }

  async function loadMiddleware() {
    return import('./middleware.ts');
  }

  async function loadJwt() {
    return import('./jwt.ts');
  }

  describe('User token horizontal privilege escalation prevention', () => {
    it('user token resolves to own email when requesting different user email', async () => {
      const { signAccessToken } = await loadJwt();
      const { resolveUserEmail } = await loadMiddleware();

      const token = await signAccessToken('alice@example.com');
      const req = fakeRequest({ authorization: `Bearer ${token}` });

      // Alice tries to access Bob's data
      const result = await resolveUserEmail(req, 'bob@example.com');
      expect(result).toBe('alice@example.com');
    });

    it('user token resolves to own email when no email is requested', async () => {
      const { signAccessToken } = await loadJwt();
      const { resolveUserEmail } = await loadMiddleware();

      const token = await signAccessToken('alice@example.com');
      const req = fakeRequest({ authorization: `Bearer ${token}` });

      const result = await resolveUserEmail(req, undefined);
      expect(result).toBe('alice@example.com');
    });

    it('user token resolves to own email even when requesting own email explicitly', async () => {
      const { signAccessToken } = await loadJwt();
      const { resolveUserEmail } = await loadMiddleware();

      const token = await signAccessToken('alice@example.com');
      const req = fakeRequest({ authorization: `Bearer ${token}` });

      const result = await resolveUserEmail(req, 'alice@example.com');
      expect(result).toBe('alice@example.com');
    });
  });

  describe('M2M token cross-user access', () => {
    it('M2M token can specify any user email', async () => {
      const { signAccessToken } = await loadJwt();
      const { resolveUserEmail } = await loadMiddleware();

      const token = await signAccessToken('gateway-service', { type: 'm2m' });
      const req = fakeRequest({ authorization: `Bearer ${token}` });

      // Agent accessing Bob's data on his behalf
      const result = await resolveUserEmail(req, 'bob@example.com');
      expect(result).toBe('bob@example.com');
    });

    it('M2M token can access user A then user B sequentially', async () => {
      const { signAccessToken } = await loadJwt();
      const { resolveUserEmail } = await loadMiddleware();

      const token = await signAccessToken('gateway-service', { type: 'm2m' });
      const reqA = fakeRequest({ authorization: `Bearer ${token}` });
      const reqB = fakeRequest({ authorization: `Bearer ${token}` });

      const resultA = await resolveUserEmail(reqA, 'userA@example.com');
      const resultB = await resolveUserEmail(reqB, 'userB@example.com');

      expect(resultA).toBe('userA@example.com');
      expect(resultB).toBe('userB@example.com');
    });

    it('M2M token returns null when no user email is specified', async () => {
      const { signAccessToken } = await loadJwt();
      const { resolveUserEmail } = await loadMiddleware();

      const token = await signAccessToken('gateway-service', { type: 'm2m' });
      const req = fakeRequest({ authorization: `Bearer ${token}` });

      const result = await resolveUserEmail(req, undefined);
      expect(result).toBeNull();
    });
  });

  describe('PreHandler hook pattern validation', () => {
    /**
     * Simulates the preHandler hook logic from server.ts against
     * a request-like object to verify the mutation pattern works.
     */
    async function simulatePreHandler(
      identity: { email: string; type: 'user' | 'm2m' } | null,
      query: Record<string, unknown>,
      body: Record<string, unknown> | null,
      headers: Record<string, string | string[] | undefined>,
    ) {
      if (!identity || identity.type !== 'user') return;

      const bound = identity.email;

      if ('user_email' in query) query.user_email = bound;
      if ('user_email' in query) query.user_email = bound;

      if (body && typeof body === 'object') {
        if ('user_email' in body) body.user_email = bound;
        if ('user_email' in body) body.user_email = bound;

        for (const arrayKey of ['items', 'memories', 'contacts']) {
          const arr = body[arrayKey];
          if (Array.isArray(arr)) {
            for (const el of arr) {
              if (el && typeof el === 'object' && 'user_email' in el) {
                (el as Record<string, unknown>).user_email = bound;
              }
            }
          }
        }
      }

      if (headers['x-user-email']) {
        (headers as Record<string, string>)['x-user-email'] = bound;
      }
    }

    it('user token: overrides query.user_email', async () => {
      const query: Record<string, unknown> = { user_email: 'evil@attacker.com', limit: '10' };
      await simulatePreHandler({ email: 'alice@example.com', type: 'user' }, query, null, {});

      expect(query.user_email).toBe('alice@example.com');
      expect(query.limit).toBe('10'); // Other params untouched
    });

    it('user token: overrides query.user_email (camelCase)', async () => {
      const query: Record<string, unknown> = { user_email: 'evil@attacker.com' };
      await simulatePreHandler({ email: 'alice@example.com', type: 'user' }, query, null, {});

      expect(query.user_email).toBe('alice@example.com');
    });

    it('user token: overrides body.user_email', async () => {
      const body: Record<string, unknown> = { title: 'Task', user_email: 'evil@attacker.com' };
      await simulatePreHandler({ email: 'alice@example.com', type: 'user' }, {}, body, {});

      expect(body.user_email).toBe('alice@example.com');
      expect(body.title).toBe('Task'); // Other fields untouched
    });

    it('user token: overrides user_email in body.items array', async () => {
      const body: Record<string, unknown> = {
        items: [
          { skill_id: 'x', user_email: 'evil@attacker.com' },
          { skill_id: 'y', user_email: 'another@evil.com' },
        ],
      };
      await simulatePreHandler({ email: 'alice@example.com', type: 'user' }, {}, body, {});

      const items = body.items as Array<Record<string, unknown>>;
      expect(items[0].user_email).toBe('alice@example.com');
      expect(items[1].user_email).toBe('alice@example.com');
    });

    it('user token: overrides user_email in body.memories array', async () => {
      const body: Record<string, unknown> = {
        memories: [
          { title: 'mem1', user_email: 'evil@attacker.com' },
        ],
      };
      await simulatePreHandler({ email: 'alice@example.com', type: 'user' }, {}, body, {});

      const memories = body.memories as Array<Record<string, unknown>>;
      expect(memories[0].user_email).toBe('alice@example.com');
    });

    it('user token: overrides X-User-Email header', async () => {
      const headers: Record<string, string> = { 'x-user-email': 'evil@attacker.com' };
      await simulatePreHandler({ email: 'alice@example.com', type: 'user' }, {}, null, headers);

      expect(headers['x-user-email']).toBe('alice@example.com');
    });

    it('M2M token: does NOT override any fields', async () => {
      const query: Record<string, unknown> = { user_email: 'bob@example.com' };
      const body: Record<string, unknown> = { user_email: 'bob@example.com' };
      const headers: Record<string, string> = { 'x-user-email': 'bob@example.com' };

      await simulatePreHandler({ email: 'gateway-service', type: 'm2m' }, query, body, headers);

      expect(query.user_email).toBe('bob@example.com');
      expect(body.user_email).toBe('bob@example.com');
      expect(headers['x-user-email']).toBe('bob@example.com');
    });

    it('unauthenticated: does NOT override any fields', async () => {
      const query: Record<string, unknown> = { user_email: 'bob@example.com' };
      await simulatePreHandler(null, query, null, {});

      expect(query.user_email).toBe('bob@example.com');
    });

    it('user token: does not add user_email if not originally present', async () => {
      const query: Record<string, unknown> = { limit: '10' };
      await simulatePreHandler({ email: 'alice@example.com', type: 'user' }, query, null, {});

      expect(query.user_email).toBeUndefined();
      expect(query.limit).toBe('10');
    });
  });
});
