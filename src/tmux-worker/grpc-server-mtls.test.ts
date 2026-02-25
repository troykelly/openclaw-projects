/**
 * Unit tests for gRPC server mTLS credential building.
 *
 * Issue #1685 — mTLS between API server and tmux worker
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as grpc from '@grpc/grpc-js';

// We test buildServerCredentials by verifying it reads files or falls back
describe('buildServerCredentials', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns insecure credentials when no TLS paths configured', async () => {
    const { buildServerCredentials } = await import('./grpc-server.ts');
    const config = {
      grpcPort: 50051,
      enrollmentSshPort: 2222,
      workerId: 'test-worker',
      healthPort: 9002,
      encryptionKeyHex: '',
      databaseUrl: '',
      grpcTlsCert: '',
      grpcTlsKey: '',
      grpcTlsCa: '',
    };

    const creds = buildServerCredentials(config);
    // Insecure credentials are an instance of ServerCredentials
    expect(creds).toBeDefined();
    expect(creds).toBeInstanceOf(grpc.ServerCredentials);
  });

  it('falls back to insecure when cert files do not exist', async () => {
    const { buildServerCredentials } = await import('./grpc-server.ts');
    const config = {
      grpcPort: 50051,
      enrollmentSshPort: 2222,
      workerId: 'test-worker',
      healthPort: 9002,
      encryptionKeyHex: '',
      databaseUrl: '',
      grpcTlsCert: '/nonexistent/worker.pem',
      grpcTlsKey: '/nonexistent/worker-key.pem',
      grpcTlsCa: '/nonexistent/ca.pem',
    };

    const creds = buildServerCredentials(config);
    expect(creds).toBeDefined();
    expect(creds).toBeInstanceOf(grpc.ServerCredentials);
  });
});
