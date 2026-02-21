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

  it('should reject namespace names containing unicode characters', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'valid,ns\u00e9bad,ns\u2603,\u4f60\u597d' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should reject SQL injection attempts in namespace names', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({
      query: { namespaces: "valid,'; DROP TABLE namespace_grant;--,ns' OR '1'='1" },
    });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should reject namespace names with path traversal attempts', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'valid,../etc/passwd,ns/../../root' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should reject namespace names with control characters', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'valid,ns\x00bad,ns\ttab,ns\nnewline' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should accept exactly 63-character namespace name and reject 64', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const exactly63 = 'a'.repeat(63);
    const exactly64 = 'a'.repeat(64);
    const req = mockReq({ query: { namespaces: `${exactly63},${exactly64}` } });
    expect(extractRequestedNamespaces(req)).toEqual([exactly63]);
  });

  it('should reject namespace names that are only dots or hyphens', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'valid,.,..,.--' } });
    // . and .. start with dot which doesn't match [a-z0-9] at start
    // .-- starts with dot
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });
});

describe('extractRequestedNamespaces malformed input (Issue #1533)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Invalid characters ---

  it('should filter out names with unicode characters', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'valid,café,naïve,ns✓' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should filter out names with @#$% special characters', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'ns@bad,ns#bad,ns$bad,ns%bad,valid' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should filter out names with backslashes and quotes', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'ns\\bad,ns"bad,ns\'bad,valid' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should filter out names with angle brackets and ampersands', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'ns<script>,ns&bad,valid' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  // --- SQL injection attempts ---

  it('should filter out SQL injection attempts with single quotes', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: "'; DROP TABLE--,valid" } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should filter out SQL injection attempts with OR 1=1', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: "' OR 1=1--,valid" } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should filter out SQL injection with UNION SELECT', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: "ns UNION SELECT * FROM users--,valid" } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should filter out SQL injection with semicolons', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'ns;DELETE FROM users,valid' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  // --- More than 20 namespaces ---

  it('should truncate to exactly 20 when given 30 valid namespaces', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const names = Array.from({ length: 30 }, (_, i) => `ns${i}`).join(',');
    const req = mockReq({ query: { namespaces: names } });
    const result = extractRequestedNamespaces(req);
    expect(result).toHaveLength(20);
    expect(result).toEqual(Array.from({ length: 20 }, (_, i) => `ns${i}`));
  });

  it('should truncate to 20 after filtering invalid entries', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    // 5 invalid + 25 valid = 25 valid after filter, truncated to 20
    const invalid = Array.from({ length: 5 }, (_, i) => `INVALID${i}`);
    const valid = Array.from({ length: 25 }, (_, i) => `ns${i}`);
    const names = [...invalid, ...valid].join(',');
    const req = mockReq({ query: { namespaces: names } });
    const result = extractRequestedNamespaces(req);
    expect(result).toHaveLength(20);
    expect(result[0]).toBe('ns0');
  });

  // --- Names exceeding 63 characters ---

  it('should filter out a name that is exactly 64 characters', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const name64 = 'a'.repeat(64);
    const req = mockReq({ query: { namespaces: `${name64},valid` } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should accept a name that is exactly 63 characters', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const name63 = 'a'.repeat(63);
    const req = mockReq({ query: { namespaces: `${name63},valid` } });
    expect(extractRequestedNamespaces(req)).toEqual([name63, 'valid']);
  });

  it('should filter out extremely long names (200+ chars)', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const longName = 'x'.repeat(200);
    const req = mockReq({ query: { namespaces: `${longName},valid` } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  // --- Empty string namespaces ---

  it('should filter out empty strings from body.namespaces array', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ body: { namespaces: ['', '', 'valid', ''] } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  it('should return empty array when all entries are empty strings', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: ',,,' } });
    expect(extractRequestedNamespaces(req)).toEqual([]);
  });

  it('should filter out whitespace-only entries', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: '  ,\t,valid' } });
    expect(extractRequestedNamespaces(req)).toEqual(['valid']);
  });

  // --- Mixed valid/invalid entries ---

  it('should keep only valid names from a mixed array via body', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({
      body: {
        namespaces: [
          'good-name',
          'UPPER_CASE',
          '',
          '-starts-with-dash',
          'also.valid',
          'a'.repeat(100),
          'valid_123',
          "'; DROP TABLE--",
        ],
      },
    });
    expect(extractRequestedNamespaces(req)).toEqual(['good-name', 'also.valid', 'valid_123']);
  });

  it('should keep only valid names from a mixed comma-separated header', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({
      headers: { 'x-namespaces': 'ok,BAD,fine.too,-nope,y3s' },
    });
    expect(extractRequestedNamespaces(req)).toEqual(['ok', 'fine.too', 'y3s']);
  });

  // --- Valid edge cases ---

  it('should accept single-character namespace names', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'a,b,1' } });
    expect(extractRequestedNamespaces(req)).toEqual(['a', 'b', '1']);
  });

  it('should accept names with dots in various positions', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'my.namespace,a.b.c.d,ns.v2' } });
    expect(extractRequestedNamespaces(req)).toEqual(['my.namespace', 'a.b.c.d', 'ns.v2']);
  });

  it('should accept names mixing hyphens, dots, and underscores', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: 'my-ns_v2.prod,a_b-c.d' } });
    expect(extractRequestedNamespaces(req)).toEqual(['my-ns_v2.prod', 'a_b-c.d']);
  });

  it('should accept names starting with digits', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespaces: '123abc,0test,9ns' } });
    expect(extractRequestedNamespaces(req)).toEqual(['123abc', '0test', '9ns']);
  });

  it('should accept the name "default"', async () => {
    const { extractRequestedNamespaces } = await import('./middleware.ts');
    const req = mockReq({ query: { namespace: 'default' } });
    expect(extractRequestedNamespaces(req)).toEqual(['default']);
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
