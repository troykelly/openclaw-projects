/**
 * Integration test: credential generation produces ssh2-compatible keys.
 *
 * Verifies the full cycle: generate key pair → encrypt → decrypt → ssh2 parseKey.
 * Issue #2320 — SSH key generation uses PKCS#8 format incompatible with ssh2
 */

import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

describe('Credential generate → encrypt → decrypt → ssh2 parse (#2320)', () => {
  it('Ed25519: generated key survives encrypt/decrypt and ssh2 can parse it', async () => {
    const { generateSSHKeyPair } = await import('../../tmux-worker/ssh/keygen.ts');
    const { encryptCredential, decryptCredential } = await import(
      '../../tmux-worker/credentials/envelope.ts'
    );
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const pair = generateSSHKeyPair('ed25519');

    // Encrypt then decrypt
    const masterKey = randomBytes(32);
    const rowId = randomUUID();
    const encrypted = encryptCredential(pair.privateKey, masterKey, rowId);
    const decrypted = decryptCredential(encrypted, masterKey, rowId);

    // Decrypted matches original
    expect(decrypted).toBe(pair.privateKey);

    // ssh2 can parse the decrypted key
    const parsed = mod.utils.parseKey(decrypted);
    expect(parsed).not.toBeInstanceOf(Error);

    // Public key is in SSH format
    expect(pair.publicKey).toMatch(/^ssh-ed25519 /);
  });

  it('RSA: generated key survives encrypt/decrypt and ssh2 can parse it', async () => {
    const { generateSSHKeyPair } = await import('../../tmux-worker/ssh/keygen.ts');
    const { encryptCredential, decryptCredential } = await import(
      '../../tmux-worker/credentials/envelope.ts'
    );
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const pair = generateSSHKeyPair('rsa');

    // Encrypt then decrypt
    const masterKey = randomBytes(32);
    const rowId = randomUUID();
    const encrypted = encryptCredential(pair.privateKey, masterKey, rowId);
    const decrypted = decryptCredential(encrypted, masterKey, rowId);

    // Decrypted matches original
    expect(decrypted).toBe(pair.privateKey);

    // ssh2 can parse the decrypted key
    const parsed = mod.utils.parseKey(decrypted);
    expect(parsed).not.toBeInstanceOf(Error);

    // Public key is in SSH format
    expect(pair.publicKey).toMatch(/^ssh-rsa /);
  });

  it('RSA fallback: generated key survives encrypt/decrypt and ssh2 can parse it', async () => {
    const { generateSSHKeyPairFallback } = await import('../../tmux-worker/ssh/keygen.ts');
    const { encryptCredential, decryptCredential } = await import(
      '../../tmux-worker/credentials/envelope.ts'
    );
    const ssh2 = await import('ssh2');
    const mod = ssh2.default ?? ssh2;

    const pair = generateSSHKeyPairFallback();

    // Encrypt then decrypt
    const masterKey = randomBytes(32);
    const rowId = randomUUID();
    const encrypted = encryptCredential(pair.privateKey, masterKey, rowId);
    const decrypted = decryptCredential(encrypted, masterKey, rowId);

    // Decrypted matches original
    expect(decrypted).toBe(pair.privateKey);

    // ssh2 can parse the decrypted key
    const parsed = mod.utils.parseKey(decrypted);
    expect(parsed).not.toBeInstanceOf(Error);

    // Public key is in SSH format
    expect(pair.publicKey).toMatch(/^ssh-rsa /);
  });
});
