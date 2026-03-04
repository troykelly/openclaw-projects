/**
 * Unit tests for gRPC client partial mTLS configuration detection.
 *
 * Issue #2139 — gRPC mTLS partial config silently degrades to insecure.
 * If ANY TLS env var is set, ALL three must be set; otherwise throw.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';

describe('buildClientCredentials — partial TLS detection (#2139)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TMUX_WORKER_MTLS_CERT;
    delete process.env.TMUX_WORKER_MTLS_KEY;
    delete process.env.TMUX_WORKER_MTLS_CA;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when only CERT is set (1 of 3)', async () => {
    process.env.TMUX_WORKER_MTLS_CERT = '/some/cert.pem';

    const mod = await import('../../src/api/terminal/grpc-client.ts');
    expect(() => mod.buildClientCredentials()).toThrow(
      /partial.*TLS|all three.*must be set/i,
    );
  });

  it('throws when only KEY is set (1 of 3)', async () => {
    process.env.TMUX_WORKER_MTLS_KEY = '/some/key.pem';

    const mod = await import('../../src/api/terminal/grpc-client.ts');
    expect(() => mod.buildClientCredentials()).toThrow(
      /partial.*TLS|all three.*must be set/i,
    );
  });

  it('throws when only CA is set (1 of 3)', async () => {
    process.env.TMUX_WORKER_MTLS_CA = '/some/ca.pem';

    const mod = await import('../../src/api/terminal/grpc-client.ts');
    expect(() => mod.buildClientCredentials()).toThrow(
      /partial.*TLS|all three.*must be set/i,
    );
  });

  it('throws when CERT and KEY are set but CA is missing (2 of 3)', async () => {
    process.env.TMUX_WORKER_MTLS_CERT = '/some/cert.pem';
    process.env.TMUX_WORKER_MTLS_KEY = '/some/key.pem';

    const mod = await import('../../src/api/terminal/grpc-client.ts');
    expect(() => mod.buildClientCredentials()).toThrow(
      /partial.*TLS|all three.*must be set/i,
    );
  });

  it('throws when CERT and CA are set but KEY is missing (2 of 3)', async () => {
    process.env.TMUX_WORKER_MTLS_CERT = '/some/cert.pem';
    process.env.TMUX_WORKER_MTLS_CA = '/some/ca.pem';

    const mod = await import('../../src/api/terminal/grpc-client.ts');
    expect(() => mod.buildClientCredentials()).toThrow(
      /partial.*TLS|all three.*must be set/i,
    );
  });

  it('throws when KEY and CA are set but CERT is missing (2 of 3)', async () => {
    process.env.TMUX_WORKER_MTLS_KEY = '/some/key.pem';
    process.env.TMUX_WORKER_MTLS_CA = '/some/ca.pem';

    const mod = await import('../../src/api/terminal/grpc-client.ts');
    expect(() => mod.buildClientCredentials()).toThrow(
      /partial.*TLS|all three.*must be set/i,
    );
  });
});
