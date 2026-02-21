import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const TEST_SECRET = 'a]Uf9$Lx2!Qm7Kp@Wz4Rn8Yb6Hd3Jt0Vs'; // 36 chars, > 32 bytes

describe('Role enforcement (#1485, #1486)', () => {
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

  async function loadMiddleware() {
    return import('./middleware.ts');
  }

  function fakeRequestWithContext(
    ctx: import('./middleware.ts').NamespaceContext | null,
  ): FastifyRequest {
    return { namespaceContext: ctx, headers: {} } as unknown as FastifyRequest;
  }

  describe('requireMinRole', () => {
    it('should allow owner when owner is required', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'owner' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'owner')).not.toThrow();
    });

    it('should allow admin when member is required', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'admin' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'member')).not.toThrow();
    });

    it('should allow member when member is required', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'member' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'member')).not.toThrow();
    });

    it('should reject observer when member is required', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'observer' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'member')).toThrow(RoleError);
    });

    it('should reject member when admin is required', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'member' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'admin')).toThrow(RoleError);
    });

    it('should reject observer when admin is required', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'observer' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'admin')).toThrow(RoleError);
    });

    it('should allow observer when observer is required (read-only)', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'observer' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'observer')).not.toThrow();
    });

    it('should always allow M2M tokens regardless of role', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: true,
        roles: {},
      });

      expect(() => requireMinRole(req, 'test-ns', 'owner')).not.toThrow();
    });

    it('should skip check when namespace context is null (auth disabled)', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext(null);

      expect(() => requireMinRole(req, 'test-ns', 'owner')).not.toThrow();
    });

    it('should reject when user has no role for the namespace', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'other-ns': 'owner' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'observer')).toThrow(RoleError);
    });

    it('should include role info in error message', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'observer' },
      });

      try {
        requireMinRole(req, 'test-ns', 'member');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RoleError);
        expect((err as Error).message).toContain('member');
        expect((err as Error).message).toContain('observer');
      }
    });
  });

  describe('resolveNamespaces with roles', () => {
    it('should populate roles map for user tokens', async () => {
      const { resolveNamespaces } = await loadMiddleware();
      const { signAccessToken } = await import('./jwt.ts');

      const token = await signAccessToken('alice@example.com');
      const req = {
        headers: { authorization: `Bearer ${token}` },
        query: {},
        body: null,
      } as unknown as FastifyRequest;

      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [
            { namespace: 'ns-a', role: 'admin', is_default: true },
            { namespace: 'ns-b', role: 'observer', is_default: false },
          ],
        }),
      };

      const ctx = await resolveNamespaces(req, mockPool as never);

      expect(ctx).not.toBeNull();
      expect(ctx!.roles).toEqual({
        'ns-a': 'admin',
        'ns-b': 'observer',
      });
      expect(ctx!.storeNamespace).toBe('ns-a');
      expect(ctx!.queryNamespaces).toEqual(['ns-a', 'ns-b']);
      expect(ctx!.isM2M).toBe(false);
    });

    it('should return empty roles for M2M tokens', async () => {
      const { resolveNamespaces } = await loadMiddleware();
      const { signAccessToken } = await import('./jwt.ts');

      const token = await signAccessToken('gateway-service', { type: 'm2m' });
      const req = {
        headers: { authorization: `Bearer ${token}` },
        query: {},
        body: null,
      } as unknown as FastifyRequest;

      const mockPool = { query: vi.fn() };
      const ctx = await resolveNamespaces(req, mockPool as never);

      expect(ctx).not.toBeNull();
      expect(ctx!.roles).toEqual({});
      expect(ctx!.isM2M).toBe(true);
    });

    it('should return empty roles and isM2M=true when auth is disabled', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.resetModules();

      const { resolveNamespaces } = await loadMiddleware();
      const req = {
        headers: { 'x-namespace': 'test' },
        query: {},
        body: null,
      } as unknown as FastifyRequest;

      const mockPool = { query: vi.fn() };
      const ctx = await resolveNamespaces(req, mockPool as never);

      expect(ctx).not.toBeNull();
      expect(ctx!.roles).toEqual({});
      // Auth-disabled mode bypasses role enforcement, so isM2M is always
      // true to ensure requireMinRole skips checks.
      expect(ctx!.isM2M).toBe(true);
    });

    it('should set isM2M=true when auth disabled with M2M JWT present', async () => {
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
      vi.resetModules();

      const { resolveNamespaces } = await loadMiddleware();
      const { signAccessToken } = await import('./jwt.ts');

      const token = await signAccessToken('gateway-service', { type: 'm2m' });
      const req = {
        headers: { authorization: `Bearer ${token}`, 'x-namespace': 'test-ns' },
        query: {},
        body: null,
      } as unknown as FastifyRequest;

      const mockPool = { query: vi.fn() };
      const ctx = await resolveNamespaces(req, mockPool as never);

      expect(ctx).not.toBeNull();
      expect(ctx!.storeNamespace).toBe('test-ns');
      expect(ctx!.isM2M).toBe(true);
      expect(ctx!.roles).toEqual({});
    });

    it('should populate roles when a specific namespace is requested', async () => {
      const { resolveNamespaces } = await loadMiddleware();
      const { signAccessToken } = await import('./jwt.ts');

      const token = await signAccessToken('alice@example.com');
      const req = {
        headers: { authorization: `Bearer ${token}`, 'x-namespace': 'ns-b' },
        query: {},
        body: null,
      } as unknown as FastifyRequest;

      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [
            { namespace: 'ns-a', role: 'owner', is_default: true },
            { namespace: 'ns-b', role: 'observer', is_default: false },
          ],
        }),
      };

      const ctx = await resolveNamespaces(req, mockPool as never);

      expect(ctx).not.toBeNull();
      expect(ctx!.storeNamespace).toBe('ns-b');
      expect(ctx!.queryNamespaces).toEqual(['ns-b']);
      expect(ctx!.roles).toEqual({ 'ns-a': 'owner', 'ns-b': 'observer' });
    });
  });

  describe('Role hierarchy completeness', () => {
    it('should enforce observer < member < admin < owner', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();

      const roles = ['observer', 'member', 'admin', 'owner'] as const;

      for (let i = 0; i < roles.length; i++) {
        for (let j = 0; j < roles.length; j++) {
          const userRole = roles[i];
          const requiredRole = roles[j];

          const req = fakeRequestWithContext({
            storeNamespace: 'ns',
            queryNamespaces: ['ns'],
            isM2M: false,
            roles: { ns: userRole },
          });

          if (i >= j) {
            // User has sufficient privilege
            expect(
              () => requireMinRole(req, 'ns', requiredRole),
              `${userRole} should satisfy ${requiredRole}`,
            ).not.toThrow();
          } else {
            // User has insufficient privilege
            expect(
              () => requireMinRole(req, 'ns', requiredRole),
              `${userRole} should NOT satisfy ${requiredRole}`,
            ).toThrow(RoleError);
          }
        }
      }
    });
  });
});
