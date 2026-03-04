/**
 * Unit tests for gRPC server partial TLS configuration detection.
 *
 * Issue #2139 — gRPC mTLS partial config silently degrades to insecure.
 * If ANY TLS config path is set, ALL three must be set; otherwise throw.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

describe('buildServerCredentials — partial TLS detection (#2139)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseConfig = {
    grpcPort: 50051,
    enrollmentSshPort: 2222,
    workerId: 'test-worker',
    healthPort: 9002,
    encryptionKeyHex: '',
    databaseUrl: '',
    enrollmentSshHostKeyPath: '',
    enrollmentSshHostKeyType: 'ed25519',
  };

  it('throws when only CERT is set (1 of 3)', async () => {
    const { buildServerCredentials } = await import('./grpc-server.ts');
    expect(() =>
      buildServerCredentials({
        ...baseConfig,
        grpcTlsCert: '/some/cert.pem',
        grpcTlsKey: '',
        grpcTlsCa: '',
      }),
    ).toThrow(/partial.*TLS|all three.*must be set/i);
  });

  it('throws when only KEY is set (1 of 3)', async () => {
    const { buildServerCredentials } = await import('./grpc-server.ts');
    expect(() =>
      buildServerCredentials({
        ...baseConfig,
        grpcTlsCert: '',
        grpcTlsKey: '/some/key.pem',
        grpcTlsCa: '',
      }),
    ).toThrow(/partial.*TLS|all three.*must be set/i);
  });

  it('throws when only CA is set (1 of 3)', async () => {
    const { buildServerCredentials } = await import('./grpc-server.ts');
    expect(() =>
      buildServerCredentials({
        ...baseConfig,
        grpcTlsCert: '',
        grpcTlsKey: '',
        grpcTlsCa: '/some/ca.pem',
      }),
    ).toThrow(/partial.*TLS|all three.*must be set/i);
  });

  it('throws when CERT and KEY are set but CA is missing (2 of 3)', async () => {
    const { buildServerCredentials } = await import('./grpc-server.ts');
    expect(() =>
      buildServerCredentials({
        ...baseConfig,
        grpcTlsCert: '/some/cert.pem',
        grpcTlsKey: '/some/key.pem',
        grpcTlsCa: '',
      }),
    ).toThrow(/partial.*TLS|all three.*must be set/i);
  });

  it('throws when CERT and CA are set but KEY is missing (2 of 3)', async () => {
    const { buildServerCredentials } = await import('./grpc-server.ts');
    expect(() =>
      buildServerCredentials({
        ...baseConfig,
        grpcTlsCert: '/some/cert.pem',
        grpcTlsKey: '',
        grpcTlsCa: '/some/ca.pem',
      }),
    ).toThrow(/partial.*TLS|all three.*must be set/i);
  });

  it('throws when KEY and CA are set but CERT is missing (2 of 3)', async () => {
    const { buildServerCredentials } = await import('./grpc-server.ts');
    expect(() =>
      buildServerCredentials({
        ...baseConfig,
        grpcTlsCert: '',
        grpcTlsKey: '/some/key.pem',
        grpcTlsCa: '/some/ca.pem',
      }),
    ).toThrow(/partial.*TLS|all three.*must be set/i);
  });
});
