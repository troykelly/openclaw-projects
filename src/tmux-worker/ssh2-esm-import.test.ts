/**
 * Smoke test: verify ssh2 CJS package imports resolve at runtime,
 * and SSH host key generation works for all supported key types.
 *
 * Issue #1916 — ESM named import crash
 * Issue #1974 — Support all valid SSH key types
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('ssh2 ESM import smoke test', () => {
  it('enrollment-ssh-server: SSHServer constructor is available', async () => {
    const mod = await import('./enrollment-ssh-server.ts');
    expect(typeof mod.createEnrollmentSSHServer).toBe('function');
  });

  it('ssh/client: SSH2Client constructor is available', async () => {
    const mod = await import('./ssh/client.ts');
    expect(typeof mod.SSHConnectionManager).toBe('function');
    expect(typeof mod.buildSSHConfig).toBe('function');
  });

  it('ssh2 default import exposes Server, Client, and utils', async () => {
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;
    expect(typeof mod.Server).toBe('function');
    expect(typeof mod.Client).toBe('function');
    expect(mod.utils).toBeDefined();
  });
});

describe('SSH host key generation (#1974)', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
      try { fs.unlinkSync(`${f}.pub`); } catch { /* ignore */ }
    }
    tmpFiles.length = 0;
  });

  function tmpKeyPath(suffix: string): string {
    const p = path.join(os.tmpdir(), `test-ssh-key-${process.pid}-${Date.now()}-${suffix}`);
    tmpFiles.push(p);
    return p;
  }

  it('generates Ed25519 key via ssh-keygen in OpenSSH format', async () => {
    const { generateHostKeyWithSshKeygen } = await import('./enrollment-ssh-server.ts');
    const keyPath = tmpKeyPath('ed25519');
    const key = generateHostKeyWithSshKeygen('ed25519', keyPath);

    expect(key).toBeInstanceOf(Buffer);
    expect(key.toString('utf8')).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
  });

  it('generates ECDSA key via ssh-keygen in OpenSSH format', async () => {
    const { generateHostKeyWithSshKeygen } = await import('./enrollment-ssh-server.ts');
    const keyPath = tmpKeyPath('ecdsa');
    const key = generateHostKeyWithSshKeygen('ecdsa', keyPath);

    expect(key).toBeInstanceOf(Buffer);
    expect(key.toString('utf8')).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
  });

  it('generates RSA key via ssh-keygen in OpenSSH format', async () => {
    const { generateHostKeyWithSshKeygen } = await import('./enrollment-ssh-server.ts');
    const keyPath = tmpKeyPath('rsa');
    const key = generateHostKeyWithSshKeygen('rsa', keyPath);

    expect(key).toBeInstanceOf(Buffer);
    expect(key.toString('utf8')).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
  });

  it('fallback generates RSA key in PKCS#1 PEM format', async () => {
    const { generateHostKeyFallback } = await import('./enrollment-ssh-server.ts');
    const key = generateHostKeyFallback();

    expect(key).toBeInstanceOf(Buffer);
    expect(key.toString('utf8')).toContain('-----BEGIN RSA PRIVATE KEY-----');
  });

  it('ssh2 can parse generated Ed25519 key', async () => {
    const { generateHostKeyWithSshKeygen } = await import('./enrollment-ssh-server.ts');
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const keyPath = tmpKeyPath('ed25519-parse');
    const key = generateHostKeyWithSshKeygen('ed25519', keyPath);

    const parsed = mod.utils.parseKey(key);
    expect(parsed).not.toBeInstanceOf(Error);
  });

  it('ssh2 can parse generated ECDSA key', async () => {
    const { generateHostKeyWithSshKeygen } = await import('./enrollment-ssh-server.ts');
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const keyPath = tmpKeyPath('ecdsa-parse');
    const key = generateHostKeyWithSshKeygen('ecdsa', keyPath);

    const parsed = mod.utils.parseKey(key);
    expect(parsed).not.toBeInstanceOf(Error);
  });

  it('ssh2 can parse generated RSA key', async () => {
    const { generateHostKeyWithSshKeygen } = await import('./enrollment-ssh-server.ts');
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const keyPath = tmpKeyPath('rsa-parse');
    const key = generateHostKeyWithSshKeygen('rsa', keyPath);

    const parsed = mod.utils.parseKey(key);
    expect(parsed).not.toBeInstanceOf(Error);
  });

  it('ssh2 can parse fallback RSA key', async () => {
    const { generateHostKeyFallback } = await import('./enrollment-ssh-server.ts');
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const key = generateHostKeyFallback();

    const parsed = mod.utils.parseKey(key);
    expect(parsed).not.toBeInstanceOf(Error);
  });

  it('loadOrGenerateHostKey generates Ed25519 by default', async () => {
    const { loadOrGenerateHostKey } = await import('./enrollment-ssh-server.ts');
    const keyPath = tmpKeyPath('load-or-gen');
    const key = loadOrGenerateHostKey(keyPath);

    expect(key).toBeInstanceOf(Buffer);
    expect(key.toString('utf8')).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it('loadOrGenerateHostKey loads existing key without regenerating', async () => {
    const { loadOrGenerateHostKey } = await import('./enrollment-ssh-server.ts');
    const keyPath = tmpKeyPath('existing');

    // Write a dummy key file
    const dummyKey = '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n';
    fs.writeFileSync(keyPath, dummyKey, { mode: 0o600 });

    const key = loadOrGenerateHostKey(keyPath);
    expect(key.toString('utf8')).toBe(dummyKey);
  });

  it('loadOrGenerateHostKey with empty path generates ephemeral key', async () => {
    const { loadOrGenerateHostKey } = await import('./enrollment-ssh-server.ts');
    const key = loadOrGenerateHostKey('');

    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBeGreaterThan(0);
  });

  it('VALID_KEY_TYPES contains expected types', async () => {
    const { VALID_KEY_TYPES } = await import('./enrollment-ssh-server.ts');
    expect(VALID_KEY_TYPES).toContain('ed25519');
    expect(VALID_KEY_TYPES).toContain('ecdsa');
    expect(VALID_KEY_TYPES).toContain('rsa');
  });
});
