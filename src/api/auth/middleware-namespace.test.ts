/**
 * Unit tests for M2M multi-namespace query support in auth middleware.
 * Issue #1534 — Epic #1533
 *
 * Tests:
 * - extractRequestedNamespaces parses all sources correctly
 * - M2M tokens resolve to multiple queryNamespaces
 * - Backward compatibility with single ?namespace=
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';

// Helper to create a mock request
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

describe('extractRequestedNamespaces (Issue #1534)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should parse comma-separated ?namespaces= query param', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'troy,mattytroy,default' } });
    expect(extractRequestedNamespaces(req)).toEqual(['troy', 'mattytroy', 'default']);
  });

  it('should parse single ?namespace= as single-element array', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespace: 'troy' } });
    expect(extractRequestedNamespaces(req)).toEqual(['troy']);
  });

  it('should parse X-Namespace header as single-element array', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ headers: { 'x-namespace': 'troy' } });
    expect(extractRequestedNamespaces(req)).toEqual(['troy']);
  });

  it('should parse X-Namespaces header as comma-separated', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ headers: { 'x-namespaces': 'troy,mattytroy' } });
    expect(extractRequestedNamespaces(req)).toEqual(['troy', 'mattytroy']);
  });

  it('should parse body.namespaces array', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ body: { namespaces: ['troy', 'default'] } });
    expect(extractRequestedNamespaces(req)).toEqual(['troy', 'default']);
  });

  it('should return empty array when no namespaces specified', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({});
    expect(extractRequestedNamespaces(req)).toEqual([]);
  });

  it('should trim whitespace from comma-separated values', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: ' troy , mattytroy , default ' } });
    expect(extractRequestedNamespaces(req)).toEqual(['troy', 'mattytroy', 'default']);
  });

  it('should filter out empty strings from comma-separated values', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'troy,,default,' } });
    expect(extractRequestedNamespaces(req)).toEqual(['troy', 'default']);
  });

  it('should prefer X-Namespaces header over query params', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({
      headers: { 'x-namespaces': 'from-header' },
      query: { namespaces: 'from-query' },
    });
    expect(extractRequestedNamespaces(req)).toEqual(['from-header']);
  });

  it('should fall back from body.namespace (singular) to single-element array', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ body: { namespace: 'troy' } });
    expect(extractRequestedNamespaces(req)).toEqual(['troy']);
  });
});

describe('extractRequestedNamespaces validation (Issue #1533 review)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject namespace names with uppercase letters', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'UPPER,valid' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should reject namespace names with spaces', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'has space,valid' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should reject namespace names starting with a hyphen', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: '-invalid,valid' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should reject namespace names longer than 63 characters', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const longName = 'a'.repeat(64);
    const req = mockReq({ query: { namespaces: `${longName},valid` } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should limit to 20 namespaces per request', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const names = Array.from({ length: 25 }, (_, i) => `ns${i}`).join(',');
    const req = mockReq({ query: { namespaces: names } });
    const result = extractRequestedNamespaces(req);
    expect(result).toHaveLength(20);
    expect(result[0]).toBe('ns0');
    expect(result[19]).toBe('ns19');
  });

  it('should accept valid namespace names with dots, hyphens, underscores', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'my-ns,my.ns,my_ns,ns123' } });
    expect(extractRequestedNamespaces(req)).toEqual(['my-ns', 'my.ns', 'my_ns', 'ns123']);
  });

  it('should reject namespace names with special characters', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'valid,ns@bad,ns!bad,ns/bad' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should handle body.namespaces with invalid entries', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ body: { namespaces: ['valid', 'INVALID', '', 'also-valid'] } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid', 'also-valid']);
  });
});

describe('resolveNamespaces M2M multi-namespace (Issue #1534)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should resolve M2M with comma-separated namespaces', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'agent@m2m', type: 'm2m' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: { authorization: 'Bearer valid-token' },
      query: { namespaces: 'troy,mattytroy,default' },
    });
    const mockPool = {} as import('pg').Pool;

    const result = await resolveNamespaces(req, mockPool);
    expect(result).not.toBeNull();
    expect(result!.queryNamespaces).toEqual(['troy', 'mattytroy', 'default']);
    expect(result!.storeNamespace).toBe('troy');
    expect(result!.isM2M).toBe(true);
  });

  it('should still work with single ?namespace= for M2M (backward compat)', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'agent@m2m', type: 'm2m' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: { authorization: 'Bearer valid-token' },
      query: { namespace: 'troy' },
    });
    const mockPool = {} as import('pg').Pool;

    const result = await resolveNamespaces(req, mockPool);
    expect(result).not.toBeNull();
    expect(result!.queryNamespaces).toEqual(['troy']);
    expect(result!.storeNamespace).toBe('troy');
    expect(result!.isM2M).toBe(true);
  });

  it('should default to ["default"] when M2M has no namespace specified', async () => {
    vi.doMock('./jwt.ts', () => ({
      isAuthDisabled: () => false,
      verifyAccessToken: async () => ({ sub: 'agent@m2m', type: 'm2m' }),
    }));

    const { resolveNamespaces } = await import('./middleware.ts');

    const req = mockReq({
      headers: { authorization: 'Bearer valid-token' },
    });
    const mockPool = {} as import('pg').Pool;

    const result = await resolveNamespaces(req, mockPool);
    expect(result).not.toBeNull();
    expect(result!.queryNamespaces).toEqual(['default']);
    expect(result!.storeNamespace).toBe('default');
    expect(result!.isM2M).toBe(true);
  });
});
