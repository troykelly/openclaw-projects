/**
 * Unit tests for user token multi-namespace support in resolveNamespaces.
 * Issue #2359 — Epic #2345: User Namespace Selection in UI
 *
 * Tests:
 * - User tokens with X-Namespaces header resolve to multiple queryNamespaces
 * - User tokens with invalid namespaces in header are rejected
 * - User tokens with no namespace header fall back to active_namespaces from user_setting
 * - User tokens with no namespace header and no active_namespaces fall back to home namespace
 * - M2M behavior remains unchanged
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';

/** Helper to create a mock request */
function mockReq(overrides: {
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown> | null;
}): FastifyRequest {
  return {
    headers: overrides.headers ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? null,
  } as unknown as FastifyRequest;
}

/** Helper to create a mock pg Pool that returns configurable grant rows and setting rows */
function mockPool(grants: { namespace: string; access: string; is_home: boolean }[], activeNamespaces?: string[]) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('namespace_grant')) {
        return { rows: grants };
      }
      if (sql.includes('user_setting') && sql.includes('active_namespaces')) {
        return {
          rows: activeNamespaces
            ? [{ active_namespaces: activeNamespaces }]
            : [],
        };
      }
      return { rows: [] };
    }),
  } as unknown as import('pg').Pool;
}

describe('resolveNamespaces user token multi-namespace (Issue #2359)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should parse X-Namespaces header for user tokens', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'alice@example.com', type: 'user' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: {
        authorization: 'Bearer valid-token',
        'x-namespaces': 'troy,household',
      },
    });

    const pool = mockPool([
      { namespace: 'troy', access: 'readwrite', is_home: true },
      { namespace: 'household', access: 'readwrite', is_home: false },
      { namespace: 'work', access: 'read', is_home: false },
    ]);

    const result = await resolveNamespaces(req, pool);
    expect(result).not.toBeNull();
    expect(result!.queryNamespaces).toEqual(['troy', 'household']);
    expect(result!.storeNamespace).toBe('troy');
    expect(result!.isM2M).toBe(false);
  });

  it('should filter out namespaces user lacks grants for', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'alice@example.com', type: 'user' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: {
        authorization: 'Bearer valid-token',
        'x-namespaces': 'troy,noaccess',
      },
    });

    const pool = mockPool([
      { namespace: 'troy', access: 'readwrite', is_home: true },
      { namespace: 'household', access: 'readwrite', is_home: false },
    ]);

    const result = await resolveNamespaces(req, pool);
    expect(result).not.toBeNull();
    expect(result!.queryNamespaces).toEqual(['troy']);
    expect(result!.storeNamespace).toBe('troy');
  });

  it('should return null when ALL requested namespaces are invalid', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'alice@example.com', type: 'user' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: {
        authorization: 'Bearer valid-token',
        'x-namespaces': 'noaccess1,noaccess2',
      },
    });

    const pool = mockPool([
      { namespace: 'troy', access: 'readwrite', is_home: true },
    ]);

    const result = await resolveNamespaces(req, pool);
    expect(result).toBeNull();
  });

  it('should fall back to active_namespaces from user_setting when no header sent', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'alice@example.com', type: 'user' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: { authorization: 'Bearer valid-token' },
    });

    const pool = mockPool(
      [
        { namespace: 'troy', access: 'readwrite', is_home: true },
        { namespace: 'household', access: 'readwrite', is_home: false },
        { namespace: 'work', access: 'read', is_home: false },
      ],
      ['troy', 'household'], // active_namespaces from user_setting
    );

    const result = await resolveNamespaces(req, pool);
    expect(result).not.toBeNull();
    // Should use only active_namespaces, not ALL grants
    expect(result!.queryNamespaces).toEqual(['troy', 'household']);
    expect(result!.storeNamespace).toBe('troy');
  });

  it('should fall back to home namespace when no header and no active_namespaces pref', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'alice@example.com', type: 'user' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: { authorization: 'Bearer valid-token' },
    });

    const pool = mockPool(
      [
        { namespace: 'troy', access: 'readwrite', is_home: true },
        { namespace: 'household', access: 'readwrite', is_home: false },
        { namespace: 'work', access: 'read', is_home: false },
      ],
      // No active_namespaces — empty result
    );

    const result = await resolveNamespaces(req, pool);
    expect(result).not.toBeNull();
    // Should fall back to home namespace only, NOT all grants
    expect(result!.queryNamespaces).toEqual(['troy']);
    expect(result!.storeNamespace).toBe('troy');
  });

  it('should sanitize active_namespaces against current grants (revoked grant)', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'alice@example.com', type: 'user' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: { authorization: 'Bearer valid-token' },
    });

    // User has active_namespaces including 'revoked-ns' but grant was removed
    const pool = mockPool(
      [
        { namespace: 'troy', access: 'readwrite', is_home: true },
      ],
      ['troy', 'revoked-ns'], // revoked-ns is in prefs but no longer in grants
    );

    const result = await resolveNamespaces(req, pool);
    expect(result).not.toBeNull();
    expect(result!.queryNamespaces).toEqual(['troy']);
    expect(result!.storeNamespace).toBe('troy');
  });

  it('should not break M2M multi-namespace behavior', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'agent@m2m', type: 'm2m' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: {
        authorization: 'Bearer valid-token',
        'x-namespaces': 'troy,household',
      },
    });
    const pool = {} as import('pg').Pool;

    const result = await resolveNamespaces(req, pool);
    expect(result).not.toBeNull();
    expect(result!.queryNamespaces).toEqual(['troy', 'household']);
    expect(result!.storeNamespace).toBe('troy');
    expect(result!.isM2M).toBe(true);
  });

  it('should build correct roles map for user tokens with multi-namespace', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'alice@example.com', type: 'user' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: {
        authorization: 'Bearer valid-token',
        'x-namespaces': 'troy,work',
      },
    });

    const pool = mockPool([
      { namespace: 'troy', access: 'readwrite', is_home: true },
      { namespace: 'work', access: 'read', is_home: false },
    ]);

    const result = await resolveNamespaces(req, pool);
    expect(result).not.toBeNull();
    expect(result!.roles).toEqual({
      troy: 'readwrite',
      work: 'read',
    });
  });

  it('should still work with single X-Namespace header for user tokens', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'alice@example.com', type: 'user' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: {
        authorization: 'Bearer valid-token',
        'x-namespace': 'troy',
      },
    });

    const pool = mockPool([
      { namespace: 'troy', access: 'readwrite', is_home: true },
      { namespace: 'household', access: 'readwrite', is_home: false },
    ]);

    const result = await resolveNamespaces(req, pool);
    expect(result).not.toBeNull();
    expect(result!.queryNamespaces).toEqual(['troy']);
    expect(result!.storeNamespace).toBe('troy');
  });
});
