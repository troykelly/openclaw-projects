/**
 * Shared SSH key generation module.
 *
 * Uses ssh-keygen to produce keys in OpenSSH format that ssh2 v1.17+ can
 * parse, including Ed25519. Falls back to Node crypto RSA with PKCS#1 when
 * ssh-keygen is unavailable.
 *
 * Issue #2320 — SSH key generation uses PKCS#8 format incompatible with ssh2
 * Issue #1974 — Support all valid SSH key types
 */

import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Valid key types accepted by ssh-keygen. */
export const VALID_SSH_KEY_TYPES = ['ed25519', 'ecdsa', 'rsa'] as const;
export type SshKeyType = (typeof VALID_SSH_KEY_TYPES)[number];

/** Return type for key pair generation as strings. */
export interface SSHKeyPair {
  privateKey: string;
  publicKey: string;
}

/**
 * Generate an SSH key pair using ssh-keygen (OpenSSH format).
 *
 * Returns both private and public keys as strings. The private key is in
 * OpenSSH format (`-----BEGIN OPENSSH PRIVATE KEY-----`) and the public key
 * is in SSH authorized_keys format (`ssh-ed25519 AAAA...`).
 *
 * Uses `execFileSync` (not `exec`) to prevent shell injection.
 */
export function generateSSHKeyPair(keyType: SshKeyType): SSHKeyPair {
  const tmpPath = path.join(
    os.tmpdir(),
    `ssh-keygen-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  try {
    const args = ['-t', keyType, '-f', tmpPath, '-N', '', '-q'];
    if (keyType === 'rsa') {
      args.push('-b', '4096');
    }
    execFileSync('ssh-keygen', args, { stdio: 'pipe' });

    const privateKey = fs.readFileSync(tmpPath, 'utf8');
    const publicKey = fs.readFileSync(`${tmpPath}.pub`, 'utf8').trim();

    return { privateKey, publicKey };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    try { fs.unlinkSync(`${tmpPath}.pub`); } catch { /* ignore */ }
  }
}

/**
 * Fallback: generate an RSA key pair via Node crypto when ssh-keygen is unavailable.
 *
 * Uses PKCS#1 PEM format for the private key (which ssh2 can parse) and
 * derives the SSH-format public key. Only RSA is supported via this path —
 * Ed25519/ECDSA require ssh-keygen for OpenSSH format output.
 */
export function generateSSHKeyPairFallback(): SSHKeyPair {
  console.warn(
    'ssh-keygen not found — falling back to RSA-4096 via Node crypto. ' +
    'Install openssh-client for Ed25519/ECDSA support.',
  );

  const pair = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  // Derive SSH-format public key from the PEM public key
  const pubKeyObj = createPublicKey(pair.publicKey);
  const sshPub = pubKeyObj.export({ type: 'spki', format: 'der' });
  const sshPubKey = derToSSHRSAPublicKey(sshPub);

  return { privateKey: pair.privateKey, publicKey: sshPubKey };
}

/**
 * Convert a DER-encoded SPKI RSA public key to SSH authorized_keys format.
 */
function derToSSHRSAPublicKey(spkiDer: Buffer): string {
  // Parse the RSA public key from SPKI DER to get n and e
  const pubKeyObj = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  const jwk = pubKeyObj.export({ format: 'jwk' });

  const e = Buffer.from(jwk.e as string, 'base64url');
  const n = Buffer.from(jwk.n as string, 'base64url');

  // Build SSH RSA public key blob: string "ssh-rsa" + mpint e + mpint n
  const typeStr = Buffer.from('ssh-rsa');
  const parts = [
    lengthPrefixed(typeStr),
    lengthPrefixed(padMpint(e)),
    lengthPrefixed(padMpint(n)),
  ];

  const blob = Buffer.concat(parts);
  return `ssh-rsa ${blob.toString('base64')}`;
}

/** Prefix a buffer with its 4-byte big-endian length. */
function lengthPrefixed(buf: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

/** Pad an unsigned integer buffer with a leading zero byte if the high bit is set. */
function padMpint(buf: Buffer): Buffer {
  if (buf.length > 0 && (buf[0] & 0x80) !== 0) {
    return Buffer.concat([Buffer.from([0]), buf]);
  }
  return buf;
}

/**
 * Generate an SSH host key as a Buffer using ssh-keygen.
 *
 * Backward-compatible replacement for the enrollment server's
 * `generateHostKeyWithSshKeygen`. Writes the key to `targetPath` and
 * returns its contents as a Buffer.
 */
export function generateHostKeyBuffer(keyType: SshKeyType, targetPath: string): Buffer {
  const args = ['-t', keyType, '-f', targetPath, '-N', '', '-q'];
  if (keyType === 'rsa') {
    args.push('-b', '4096');
  }
  execFileSync('ssh-keygen', args, { stdio: 'pipe' });

  const key = fs.readFileSync(targetPath);

  // ssh-keygen creates a .pub alongside — clean it up
  try { fs.unlinkSync(`${targetPath}.pub`); } catch { /* ignore */ }

  return key;
}

/**
 * Fallback: generate an RSA host key as a Buffer via Node crypto.
 *
 * Backward-compatible replacement for the enrollment server's
 * `generateHostKeyFallback`.
 */
export function generateHostKeyBufferFallback(): Buffer {
  console.warn(
    'ssh-keygen not found — falling back to RSA-4096 via Node crypto. ' +
    'Install openssh-client for Ed25519/ECDSA support.',
  );
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return Buffer.from(privateKey);
}
