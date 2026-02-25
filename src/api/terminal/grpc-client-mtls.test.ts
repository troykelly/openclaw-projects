/**
 * Unit tests for gRPC client mTLS credential building.
 *
 * Issue #1685 — mTLS between API server and tmux worker
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';

describe('buildClientCredentials', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear mTLS env vars
    delete process.env.TMUX_WORKER_MTLS_CERT;
    delete process.env.TMUX_WORKER_MTLS_KEY;
    delete process.env.TMUX_WORKER_MTLS_CA;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns insecure credentials when no env vars are set', async () => {
    // Dynamic import to pick up env changes
    const mod = await import('./grpc-client.ts');
    const creds = mod.buildClientCredentials();
    expect(creds).toBeDefined();
  });

  it('falls back to insecure when cert files do not exist', async () => {
    process.env.TMUX_WORKER_MTLS_CERT = '/nonexistent/api-client.pem';
    process.env.TMUX_WORKER_MTLS_KEY = '/nonexistent/api-client-key.pem';
    process.env.TMUX_WORKER_MTLS_CA = '/nonexistent/ca.pem';

    const mod = await import('./grpc-client.ts');
    const creds = mod.buildClientCredentials();
    expect(creds).toBeDefined();
  });
});
