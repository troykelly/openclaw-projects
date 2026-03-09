/**
 * Tests for shared SSH key generation module.
 * Issue #2320 — Generated SSH keys use PKCS#8 format incompatible with ssh2
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('SSH key pair generation (#2320)', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
      try { fs.unlinkSync(`${f}.pub`); } catch { /* ignore */ }
    }
    tmpFiles.length = 0;
  });

  function tmpKeyPath(suffix: string): string {
    const p = path.join(os.tmpdir(), `test-keygen-${process.pid}-${Date.now()}-${suffix}`);
    tmpFiles.push(p);
    return p;
  }

  it('generateSSHKeyPair generates Ed25519 key pair in OpenSSH format', async () => {
    const { generateSSHKeyPair } = await import('./keygen.ts');
    const result = generateSSHKeyPair('ed25519');

    expect(result.privateKey).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(result.publicKey).toMatch(/^ssh-ed25519 /);
  });

  it('generateSSHKeyPair generates RSA key pair in OpenSSH format', async () => {
    const { generateSSHKeyPair } = await import('./keygen.ts');
    const result = generateSSHKeyPair('rsa');

    expect(result.privateKey).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(result.publicKey).toMatch(/^ssh-rsa /);
  });

  it('ssh2 can parse generated Ed25519 private key', async () => {
    const { generateSSHKeyPair } = await import('./keygen.ts');
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const result = generateSSHKeyPair('ed25519');
    const parsed = mod.utils.parseKey(result.privateKey);
    expect(parsed).not.toBeInstanceOf(Error);
  });

  it('ssh2 can parse generated RSA private key', async () => {
    const { generateSSHKeyPair } = await import('./keygen.ts');
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const result = generateSSHKeyPair('rsa');
    const parsed = mod.utils.parseKey(result.privateKey);
    expect(parsed).not.toBeInstanceOf(Error);
  });

  it('generateSSHKeyPairFallback generates RSA in PKCS#1 format', async () => {
    const { generateSSHKeyPairFallback } = await import('./keygen.ts');
    const result = generateSSHKeyPairFallback();

    expect(result.privateKey).toContain('-----BEGIN RSA PRIVATE KEY-----');
    expect(result.publicKey).toMatch(/^ssh-rsa /);
  });

  it('ssh2 can parse fallback RSA private key', async () => {
    const { generateSSHKeyPairFallback } = await import('./keygen.ts');
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const result = generateSSHKeyPairFallback();
    const parsed = mod.utils.parseKey(result.privateKey);
    expect(parsed).not.toBeInstanceOf(Error);
  });

  it('generateHostKeyBuffer generates Ed25519 host key as Buffer', async () => {
    const { generateHostKeyBuffer } = await import('./keygen.ts');
    const keyPath = tmpKeyPath('host-ed25519');
    const key = generateHostKeyBuffer('ed25519', keyPath);

    expect(key).toBeInstanceOf(Buffer);
    expect(key.toString('utf8')).toContain('-----BEGIN OPENSSH PRIVATE KEY-----');
  });

  it('generateHostKeyBufferFallback generates RSA PKCS#1 Buffer', async () => {
    const { generateHostKeyBufferFallback } = await import('./keygen.ts');
    const key = generateHostKeyBufferFallback();

    expect(key).toBeInstanceOf(Buffer);
    expect(key.toString('utf8')).toContain('-----BEGIN RSA PRIVATE KEY-----');
  });

  it('VALID_SSH_KEY_TYPES includes ed25519, ecdsa, rsa', async () => {
    const { VALID_SSH_KEY_TYPES } = await import('./keygen.ts');
    expect(VALID_SSH_KEY_TYPES).toContain('ed25519');
    expect(VALID_SSH_KEY_TYPES).toContain('ecdsa');
    expect(VALID_SSH_KEY_TYPES).toContain('rsa');
  });
});
