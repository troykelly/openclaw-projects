/**
 * Unit tests for resolveCredential end-to-end flow.
 *
 * Issue #1872 — resolveCredential coverage
 *
 * Mocks the database pool to verify the full path from DB row
 * through decryption/command execution to returned credential.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptCredential, parseEncryptionKey } from './envelope.ts';
import { resolveCredential } from './index.ts';

const TEST_KEY_HEX = 'a'.repeat(64);
const masterKey = parseEncryptionKey(TEST_KEY_HEX);

// Create a mock pool that returns controlled query results
function createMockPool(rows: Record<string, unknown>[]) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as import('pg').Pool;
}

describe('resolveCredential', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('decrypts ssh_key credential from DB row', async () => {
    const credId = '550e8400-e29b-41d4-a716-446655440001';
    const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\ntest-key-data\n-----END OPENSSH PRIVATE KEY-----';

    const encrypted = encryptCredential(privateKey, masterKey, credId);

    const pool = createMockPool([{
      id: credId,
      kind: 'ssh_key',
      encrypted_value: encrypted,
      command: null,
      command_timeout_s: 10,
      cache_ttl_s: 0,
      fingerprint: 'SHA256:abc123',
      public_key: 'ssh-ed25519 AAAA...',
    }]);

    const result = await resolveCredential(pool, credId, TEST_KEY_HEX);

    expect(result.kind).toBe('ssh_key');
    expect(result.value).toBe(privateKey);
    expect(result.fingerprint).toBe('SHA256:abc123');
    expect(result.publicKey).toBe('ssh-ed25519 AAAA...');
  });

  it('decrypts password credential from DB row', async () => {
    const credId = '550e8400-e29b-41d4-a716-446655440002';
    const password = 'super-secret-p@ssw0rd!';

    const encrypted = encryptCredential(password, masterKey, credId);

    const pool = createMockPool([{
      id: credId,
      kind: 'password',
      encrypted_value: encrypted,
      command: null,
      command_timeout_s: 10,
      cache_ttl_s: 0,
      fingerprint: null,
      public_key: null,
    }]);

    const result = await resolveCredential(pool, credId, TEST_KEY_HEX);

    expect(result.kind).toBe('password');
    expect(result.value).toBe(password);
    expect(result.fingerprint).toBeNull();
    expect(result.publicKey).toBeNull();
  });

  it('throws when credential not found', async () => {
    const pool = createMockPool([]);

    await expect(
      resolveCredential(pool, '550e8400-e29b-41d4-a716-446655440099', TEST_KEY_HEX),
    ).rejects.toThrow('Credential not found');
  });

  it('throws for unknown credential kind', async () => {
    const credId = '550e8400-e29b-41d4-a716-446655440003';

    const pool = createMockPool([{
      id: credId,
      kind: 'unknown_kind',
      encrypted_value: null,
      command: null,
      command_timeout_s: 10,
      cache_ttl_s: 0,
      fingerprint: null,
      public_key: null,
    }]);

    await expect(
      resolveCredential(pool, credId, TEST_KEY_HEX),
    ).rejects.toThrow('Unknown credential kind');
  });

  it('throws when ssh_key has no encrypted_value', async () => {
    const credId = '550e8400-e29b-41d4-a716-446655440004';

    const pool = createMockPool([{
      id: credId,
      kind: 'ssh_key',
      encrypted_value: null,
      command: null,
      command_timeout_s: 10,
      cache_ttl_s: 0,
      fingerprint: null,
      public_key: null,
    }]);

    await expect(
      resolveCredential(pool, credId, TEST_KEY_HEX),
    ).rejects.toThrow('has no encrypted_value');
  });

  it('throws when command credential has no command', async () => {
    const credId = '550e8400-e29b-41d4-a716-446655440005';

    const pool = createMockPool([{
      id: credId,
      kind: 'command',
      encrypted_value: null,
      command: null,
      command_timeout_s: 10,
      cache_ttl_s: 0,
      fingerprint: null,
      public_key: null,
    }]);

    await expect(
      resolveCredential(pool, credId, TEST_KEY_HEX),
    ).rejects.toThrow('has no command configured');
  });
});
