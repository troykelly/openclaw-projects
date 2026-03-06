/**
 * Tests for terminal infrastructure fixes.
 * Issue #2191 — Terminal Infrastructure Fixes (7 sub-items).
 *
 * Sub-item 1: Cross-namespace credential attachment validation
 * Sub-item 2: gRPC mTLS enforcement in production
 * Sub-item 3: terminal_session_entry index (migration-only, tested via integration)
 * Sub-item 4: Enrollment rate limiting
 * Sub-item 5: Session affinity fail-closed
 * Sub-item 6: Query-token deprecation
 * Sub-item 7: max_sessions enforcement
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ── Sub-item 1: Cross-namespace credential attachment validation ──

describe('validateNamespaceConsistency', () => {
  it('allows credential from same namespace', async () => {
    const { validateNamespaceConsistency } = await import('./namespace-validation.ts');
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ namespace: 'ns-a' }],
      }),
    };
    const result = await validateNamespaceConsistency(
      pool as never,
      'terminal_credential',
      'cred-uuid-1',
      'ns-a',
    );
    expect(result).toEqual({ valid: true });
  });

  it('blocks credential from different namespace', async () => {
    const { validateNamespaceConsistency } = await import('./namespace-validation.ts');
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ namespace: 'ns-b' }],
      }),
    };
    const result = await validateNamespaceConsistency(
      pool as never,
      'terminal_credential',
      'cred-uuid-1',
      'ns-a',
    );
    expect(result).toEqual({
      valid: false,
      error: 'Cross-namespace credential attachment is not allowed',
    });
  });

  it('returns invalid when entity not found', async () => {
    const { validateNamespaceConsistency } = await import('./namespace-validation.ts');
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const result = await validateNamespaceConsistency(
      pool as never,
      'terminal_credential',
      'missing-uuid',
      'ns-a',
    );
    expect(result).toEqual({
      valid: false,
      error: 'Referenced entity not found',
    });
  });

  it('validates proxy_jump_id namespace consistency', async () => {
    const { validateNamespaceConsistency } = await import('./namespace-validation.ts');
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ namespace: 'ns-other' }],
      }),
    };
    const result = await validateNamespaceConsistency(
      pool as never,
      'terminal_connection',
      'conn-uuid-1',
      'ns-a',
    );
    expect(result).toEqual({
      valid: false,
      error: 'Cross-namespace proxy attachment is not allowed',
    });
  });
});

// ── Sub-item 2: gRPC mTLS enforcement in production ──

describe('gRPC bind address and mTLS enforcement', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('defaults bind address to 127.0.0.1 when GRPC_BIND_ADDRESS is not set', async () => {
    delete process.env.GRPC_BIND_ADDRESS;
    const { getGrpcBindAddress } = await import('./grpc-bind.ts');
    expect(getGrpcBindAddress()).toBe('127.0.0.1');
  });

  it('uses GRPC_BIND_ADDRESS when set', async () => {
    process.env.GRPC_BIND_ADDRESS = '10.0.0.5';
    const { getGrpcBindAddress } = await import('./grpc-bind.ts');
    expect(getGrpcBindAddress()).toBe('10.0.0.5');
  });

  it('throws if NODE_ENV=production and mTLS is not configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GRPC_TLS_CERT;
    delete process.env.GRPC_TLS_KEY;
    delete process.env.GRPC_TLS_CA;
    const { requireMtlsInProduction } = await import('./grpc-bind.ts');
    expect(() => requireMtlsInProduction({
      grpcTlsCert: '',
      grpcTlsKey: '',
      grpcTlsCa: '',
    })).toThrow(/mTLS is required in production/);
  });

  it('does not throw if NODE_ENV=production and mTLS is configured', async () => {
    process.env.NODE_ENV = 'production';
    const { requireMtlsInProduction } = await import('./grpc-bind.ts');
    expect(() => requireMtlsInProduction({
      grpcTlsCert: '/certs/server.pem',
      grpcTlsKey: '/certs/server-key.pem',
      grpcTlsCa: '/certs/ca.pem',
    })).not.toThrow();
  });

  it('does not throw if NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    const { requireMtlsInProduction } = await import('./grpc-bind.ts');
    expect(() => requireMtlsInProduction({
      grpcTlsCert: '',
      grpcTlsKey: '',
      grpcTlsCa: '',
    })).not.toThrow();
  });
});

// ── Sub-item 4: Enrollment rate limiting ──

describe('enrollment rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under rate limit', async () => {
    const { createRateLimiter } = await import('./rate-limiter.ts');
    const limiter = createRateLimiter({ maxRequests: 5, windowMs: 60_000 });

    const result = limiter.check('192.168.1.1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('blocks requests exceeding rate limit', async () => {
    const { createRateLimiter } = await import('./rate-limiter.ts');
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000 });

    limiter.check('192.168.1.1');
    limiter.check('192.168.1.1');
    const result = limiter.check('192.168.1.1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets after window expires', async () => {
    const { createRateLimiter } = await import('./rate-limiter.ts');
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });

    limiter.check('192.168.1.1');
    const blocked = limiter.check('192.168.1.1');
    expect(blocked.allowed).toBe(false);

    vi.advanceTimersByTime(61_000);

    const afterReset = limiter.check('192.168.1.1');
    expect(afterReset.allowed).toBe(true);
  });

  it('tracks different keys independently', async () => {
    const { createRateLimiter } = await import('./rate-limiter.ts');
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });

    const r1 = limiter.check('192.168.1.1');
    const r2 = limiter.check('192.168.1.2');
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    const r3 = limiter.check('192.168.1.1');
    expect(r3.allowed).toBe(false);
  });

  it('provides retryAfterMs when blocked', async () => {
    const { createRateLimiter } = await import('./rate-limiter.ts');
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });

    limiter.check('10.0.0.1');
    const blocked = limiter.check('10.0.0.1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000);
  });
});

// ── Sub-item 5: Session affinity fail-closed ──

describe('session affinity fail-closed', () => {
  afterEach(() => {
    delete process.env.TMUX_WORKER_REGISTRY;
    delete process.env.TMUX_WORKER_GRPC_URL;
  });

  it('returns error when worker not found in multi-worker mode', async () => {
    const { resolveWorkerGrpcUrlStrict } = await import('./session-affinity.ts');
    process.env.TMUX_WORKER_REGISTRY = 'worker-1=host1:50051,worker-2=host2:50052';
    const registry = new Map([
      ['worker-1', 'host1:50051'],
      ['worker-2', 'host2:50052'],
    ]);
    const result = resolveWorkerGrpcUrlStrict('unknown-worker', registry);
    expect(result).toEqual({
      ok: false,
      error: 'Worker unknown-worker not found in registry',
    });
  });

  it('returns URL when worker is found in registry', async () => {
    const { resolveWorkerGrpcUrlStrict } = await import('./session-affinity.ts');
    const registry = new Map([
      ['worker-1', 'host1:50051'],
    ]);
    const result = resolveWorkerGrpcUrlStrict('worker-1', registry);
    expect(result).toEqual({
      ok: true,
      url: 'host1:50051',
    });
  });

  it('falls back to default gRPC URL in single-worker mode (empty registry)', async () => {
    const { resolveWorkerGrpcUrlStrict } = await import('./session-affinity.ts');
    process.env.TMUX_WORKER_GRPC_URL = 'single-host:50051';
    const registry = new Map<string, string>();
    const result = resolveWorkerGrpcUrlStrict('any-worker', registry);
    expect(result).toEqual({
      ok: true,
      url: 'single-host:50051',
    });
  });

  it('fails closed when no registry and no default URL', async () => {
    const { resolveWorkerGrpcUrlStrict } = await import('./session-affinity.ts');
    delete process.env.TMUX_WORKER_GRPC_URL;
    const registry = new Map<string, string>();
    const result = resolveWorkerGrpcUrlStrict('any-worker', registry);
    expect(result).toEqual({
      ok: false,
      error: 'No gRPC URL configured (TMUX_WORKER_GRPC_URL not set and worker registry is empty)',
    });
  });
});

// ── Sub-item 6: Query-token deprecation ──

describe('query-token deprecation', () => {
  it('marks query token as deprecated and provides deprecation info', async () => {
    const { isQueryTokenDeprecated, QUERY_TOKEN_DEPRECATION_HEADER } = await import('./query-token-deprecation.ts');
    expect(isQueryTokenDeprecated()).toBe(true);
    expect(QUERY_TOKEN_DEPRECATION_HEADER).toBeDefined();
    expect(typeof QUERY_TOKEN_DEPRECATION_HEADER).toBe('string');
  });

  it('returns deprecation headers', async () => {
    const { getDeprecationHeaders } = await import('./query-token-deprecation.ts');
    const headers = getDeprecationHeaders();
    expect(headers).toHaveProperty('Deprecation');
    expect(headers).toHaveProperty('Sunset');
    expect(headers).toHaveProperty('Link');
  });
});

// ── Sub-item 7: max_sessions enforcement ──

describe('max_sessions enforcement', () => {
  it('allows session creation when under limit', async () => {
    const { checkMaxSessions } = await import('./max-sessions.ts');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ max_sessions: 5 }] })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] }),
    };
    const result = await checkMaxSessions(client as never, 'conn-1');
    expect(result).toEqual({ allowed: true, current: 2, max: 5 });
  });

  it('blocks session creation when at limit', async () => {
    const { checkMaxSessions } = await import('./max-sessions.ts');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ max_sessions: 3 }] })
        .mockResolvedValueOnce({ rows: [{ count: '3' }] }),
    };
    const result = await checkMaxSessions(client as never, 'conn-1');
    expect(result).toEqual({ allowed: false, current: 3, max: 3 });
  });

  it('allows session creation when max_sessions is null (unlimited)', async () => {
    const { checkMaxSessions } = await import('./max-sessions.ts');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ max_sessions: null }] })
        .mockResolvedValueOnce({ rows: [{ count: '100' }] }),
    };
    const result = await checkMaxSessions(client as never, 'conn-1');
    expect(result).toEqual({ allowed: true, current: 100, max: null });
  });

  it('returns not_found when connection does not exist', async () => {
    const { checkMaxSessions } = await import('./max-sessions.ts');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }),
    };
    const result = await checkMaxSessions(client as never, 'missing-conn');
    expect(result).toEqual({ allowed: false, current: 0, max: 0, error: 'Connection not found' });
  });

  it('uses FOR UPDATE to prevent race conditions', async () => {
    const { checkMaxSessions } = await import('./max-sessions.ts');
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ max_sessions: 5 }] })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] }),
    };
    await checkMaxSessions(client as never, 'conn-1');
    // Verify the first query uses FOR UPDATE (or advisory lock)
    const firstCall = client.query.mock.calls[0][0] as string;
    expect(firstCall).toContain('FOR UPDATE');
  });
});
