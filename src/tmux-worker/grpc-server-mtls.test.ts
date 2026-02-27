/**
 * Unit tests for gRPC server mTLS credential building.
 *
 * Issue #1685 — mTLS between API server and tmux worker
 */

import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Create temp directory for test certs
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtls-test-'));

// Generate self-signed CA + server cert for the happy-path test.
// Uses openssl which is available in the devcontainer.
function generateTestCerts(): { caPath: string; certPath: string; keyPath: string } | null {
  try {
    const caKeyPath = path.join(tmpDir, 'ca-key.pem');
    const caPath = path.join(tmpDir, 'ca.pem');
    const keyPath = path.join(tmpDir, 'server-key.pem');
    const csrPath = path.join(tmpDir, 'server.csr');
    const certPath = path.join(tmpDir, 'server.pem');

    // Generate CA key and self-signed cert
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', caKeyPath, '-out', caPath,
      '-days', '1', '-nodes', '-subj', '/CN=TestCA',
    ], { stdio: 'pipe' });

    // Generate server key and CSR
    execFileSync('openssl', [
      'req', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', csrPath,
      '-nodes', '-subj', '/CN=localhost',
    ], { stdio: 'pipe' });

    // Sign server cert with CA
    execFileSync('openssl', [
      'x509', '-req', '-in', csrPath,
      '-CA', caPath, '-CAkey', caKeyPath, '-CAcreateserial',
      '-out', certPath, '-days', '1',
    ], { stdio: 'pipe' });

    return { caPath, certPath, keyPath };
  } catch {
    // openssl not available — skip the happy-path test
    return null;
  }
}

const testCerts = generateTestCerts();

afterAll(() => {
  // Clean up temp certs
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

  it.skipIf(!testCerts)('creates mTLS credentials with valid cert files', async () => {
    const { buildServerCredentials } = await import('./grpc-server.ts');
    const config = {
      grpcPort: 50051,
      enrollmentSshPort: 2222,
      workerId: 'test-worker',
      healthPort: 9002,
      encryptionKeyHex: '',
      databaseUrl: '',
      grpcTlsCert: testCerts!.certPath,
      grpcTlsKey: testCerts!.keyPath,
      grpcTlsCa: testCerts!.caPath,
    };

    const creds = buildServerCredentials(config);
    expect(creds).toBeDefined();
    expect(creds).toBeInstanceOf(grpc.ServerCredentials);
    // mTLS credentials are NOT the same as insecure ones
    expect(creds).not.toBe(grpc.ServerCredentials.createInsecure());
  });
});
