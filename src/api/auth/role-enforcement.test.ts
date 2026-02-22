import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const TEST_SECRET = 'a]Uf9$Lx2!Qm7Kp@Wz4Rn8Yb6Hd3Jt0Vs'; // 36 chars, > 32 bytes

describe('Access enforcement (#1485, #1486, #1571)', () => {
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
    it('should allow readwrite when readwrite is required', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'readwrite' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'readwrite')).not.toThrow();
    });

    it('should allow readwrite when read is required', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'readwrite' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'read')).not.toThrow();
    });

    it('should allow read when read is required', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'read' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'read')).not.toThrow();
    });

    it('should reject read when readwrite is required', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'read' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'readwrite')).toThrow(RoleError);
    });

    it('should always allow M2M tokens regardless of access level', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: true,
        roles: {},
      });

      expect(() => requireMinRole(req, 'test-ns', 'readwrite')).not.toThrow();
    });

    it('should skip check when namespace context is null (auth disabled)', async () => {
      const { requireMinRole } = await loadMiddleware();
      const req = fakeRequestWithContext(null);

      expect(() => requireMinRole(req, 'test-ns', 'readwrite')).not.toThrow();
    });

    it('should reject when user has no access for the namespace', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'other-ns': 'readwrite' },
      });

      expect(() => requireMinRole(req, 'test-ns', 'read')).toThrow(RoleError);
    });

    it('should include access info in error message', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();
      const req = fakeRequestWithContext({
        storeNamespace: 'test-ns',
        queryNamespaces: ['test-ns'],
        isM2M: false,
        roles: { 'test-ns': 'read' },
      });

      try {
        requireMinRole(req, 'test-ns', 'readwrite');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RoleError);
        expect((err as Error).message).toContain('readwrite');
        expect((err as Error).message).toContain('read');
      }
    });
  });

  describe('resolveNamespaces with access levels', () => {
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
            { namespace: 'ns-a', access: 'readwrite', is_home: true },
            { namespace: 'ns-b', access: 'read', is_home: false },
          ],
        }),
      };

      const ctx = await resolveNamespaces(req, mockPool as never);

      expect(ctx).not.toBeNull();
      expect(ctx!.roles).toEqual({
        'ns-a': 'readwrite',
        'ns-b': 'read',
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
      // Auth-disabled mode bypasses access enforcement, so isM2M is always
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
            { namespace: 'ns-a', access: 'readwrite', is_home: true },
            { namespace: 'ns-b', access: 'read', is_home: false },
          ],
        }),
      };

      const ctx = await resolveNamespaces(req, mockPool as never);

      expect(ctx).not.toBeNull();
      expect(ctx!.storeNamespace).toBe('ns-b');
      expect(ctx!.queryNamespaces).toEqual(['ns-b']);
      expect(ctx!.roles).toEqual({ 'ns-a': 'readwrite', 'ns-b': 'read' });
    });
  });

  describe('Access level completeness', () => {
    it('should enforce read < readwrite', async () => {
      const { requireMinRole, RoleError } = await loadMiddleware();

      const levels = ['read', 'readwrite'] as const;

      for (const userAccess of levels) {
        for (const requiredAccess of levels) {
          const req = fakeRequestWithContext({
            storeNamespace: 'ns',
            queryNamespaces: ['ns'],
            isM2M: false,
            roles: { ns: userAccess },
          });

          const userIdx = levels.indexOf(userAccess);
          const reqIdx = levels.indexOf(requiredAccess);

          if (userIdx >= reqIdx) {
            // User has sufficient access
            expect(
              () => requireMinRole(req, 'ns', requiredAccess),
              `${userAccess} should satisfy ${requiredAccess}`,
            ).not.toThrow();
          } else {
            // User has insufficient access
            expect(
              () => requireMinRole(req, 'ns', requiredAccess),
              `${userAccess} should NOT satisfy ${requiredAccess}`,
            ).toThrow(RoleError);
          }
        }
      }
    });
  });
});
