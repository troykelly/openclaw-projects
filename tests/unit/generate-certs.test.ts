/**
 * Tests for mTLS certificate generation script.
 * Issue #1856 — Fix mTLS cert generation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { X509Certificate, createPrivateKey } from 'node:crypto';

describe('generate-certs.js', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-test-'));
    process.env.CERT_OUTPUT_DIR = tmpDir;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates CA, API client, and worker certificates', async () => {
    // Run the script by importing it as a child process
    const { execFileSync } = await import('node:child_process');
    execFileSync('node', [
      path.resolve(__dirname, '../../scripts/generate-certs.cjs'),
    ], {
      env: { ...process.env, CERT_OUTPUT_DIR: tmpDir },
      stdio: 'pipe',
    });

    // Verify all expected files exist
    const expectedFiles = [
      'ca-key.pem',
      'ca.pem',
      'api-client-key.pem',
      'api-client.pem',
      'worker-key.pem',
      'worker.pem',
    ];

    for (const file of expectedFiles) {
      const filePath = path.join(tmpDir, file);
      expect(fs.existsSync(filePath), `${file} should exist`).toBe(true);
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('generates valid X509 certificates', async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('node', [
      path.resolve(__dirname, '../../scripts/generate-certs.cjs'),
    ], {
      env: { ...process.env, CERT_OUTPUT_DIR: tmpDir },
      stdio: 'pipe',
    });

    // Verify CA certificate is valid X509
    const caCertPem = fs.readFileSync(path.join(tmpDir, 'ca.pem'), 'utf-8');
    const caCert = new X509Certificate(caCertPem);
    expect(caCert.subject).toContain('CN=OpenClaw Terminal CA');
    expect(caCert.issuer).toContain('CN=OpenClaw Terminal CA'); // Self-signed

    // Verify API client certificate is signed by CA
    const apiCertPem = fs.readFileSync(path.join(tmpDir, 'api-client.pem'), 'utf-8');
    const apiCert = new X509Certificate(apiCertPem);
    expect(apiCert.subject).toContain('CN=openclaw-api-client');
    expect(apiCert.checkIssued(caCert)).toBe(true);

    // Verify worker certificate is signed by CA
    const workerCertPem = fs.readFileSync(path.join(tmpDir, 'worker.pem'), 'utf-8');
    const workerCert = new X509Certificate(workerCertPem);
    expect(workerCert.subject).toContain('CN=openclaw-tmux-worker');
    expect(workerCert.checkIssued(caCert)).toBe(true);
  });

  it('generates valid private keys', async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync('node', [
      path.resolve(__dirname, '../../scripts/generate-certs.cjs'),
    ], {
      env: { ...process.env, CERT_OUTPUT_DIR: tmpDir },
      stdio: 'pipe',
    });

    // Verify keys are parseable
    for (const keyFile of ['ca-key.pem', 'api-client-key.pem', 'worker-key.pem']) {
      const keyPem = fs.readFileSync(path.join(tmpDir, keyFile), 'utf-8');
      const key = createPrivateKey(keyPem);
      expect(key.type).toBe('private');
    }
  });

  it('skips generation if certs already exist', async () => {
    const { execFileSync } = await import('node:child_process');

    // First run: generate certs
    execFileSync('node', [
      path.resolve(__dirname, '../../scripts/generate-certs.cjs'),
    ], {
      env: { ...process.env, CERT_OUTPUT_DIR: tmpDir },
      stdio: 'pipe',
    });

    // Record modification times
    const caCertPath = path.join(tmpDir, 'ca.pem');
    const mtime1 = fs.statSync(caCertPath).mtimeMs;

    // Wait a small amount to ensure time difference
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second run: should skip
    const output = execFileSync('node', [
      path.resolve(__dirname, '../../scripts/generate-certs.cjs'),
    ], {
      env: { ...process.env, CERT_OUTPUT_DIR: tmpDir },
      stdio: 'pipe',
    }).toString();

    expect(output).toContain('already exist');

    // File should not be modified
    const mtime2 = fs.statSync(caCertPath).mtimeMs;
    expect(mtime2).toBe(mtime1);
  });

  it('does not use openssl CLI (pure Node.js crypto)', async () => {
    const scriptContent = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/generate-certs.cjs'),
      'utf-8',
    );
    // Script should not call execFileSync with 'openssl'
    expect(scriptContent).not.toContain("execFileSync('openssl'");
    expect(scriptContent).not.toContain('execFileSync("openssl"');
    // Should use Node.js crypto
    expect(scriptContent).toContain('node:crypto');
  });
});
