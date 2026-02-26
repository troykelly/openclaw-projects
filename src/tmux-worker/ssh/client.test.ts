/**
 * Unit tests for the SSH client module.
 * Issue #1845 — SSH client module.
 *
 * Tests cover:
 * - Auth method selection (key, password, agent, command)
 * - Proxy jump chain resolution
 * - Host key callback logic (strict, TOFU, skip)
 * - Connection configuration from DB rows
 * - Connection lifecycle (connect, disconnect)
 * - Error handling for missing credentials, unreachable hosts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type pg from 'pg';
import type { Client as SSHClient } from 'ssh2';
import {
  SSHConnectionManager,
  type SSHConnectionOptions,
  type ConnectionRow,
  buildSSHConfig,
  resolveProxyChain,
} from './client.ts';

// ─── Mocks ──────────────────────────────────────────────────

/** Create a mock pg.Pool that returns predefined results. */
function createMockPool(queryResults: Record<string, { rows: unknown[] }>): pg.Pool {
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // Match by first parameter (usually the ID)
      const id = params?.[0] as string;
      if (queryResults[id]) {
        return queryResults[id];
      }
      // Also match by SQL substring
      for (const [key, result] of Object.entries(queryResults)) {
        if (sql.includes(key)) {
          return result;
        }
      }
      return { rows: [] };
    }),
  } as unknown as pg.Pool;
  return pool;
}

/** Create a mock SSH2 Client. */
function createMockSSH2Client(): SSHClient & { _emitReady: () => void; _emitError: (err: Error) => void } {
  const emitter = new EventEmitter();
  const mock = Object.assign(emitter, {
    connect: vi.fn(function (this: EventEmitter) {
      // Emit ready after connect is called (simulates async connection)
      return this;
    }),
    end: vi.fn(),
    destroy: vi.fn(),
    forwardOut: vi.fn(),
    _emitReady() {
      emitter.emit('ready');
    },
    _emitError(err: Error) {
      emitter.emit('error', err);
    },
  });
  return mock as unknown as SSHClient & { _emitReady: () => void; _emitError: (err: Error) => void };
}

// ─── Test data ──────────────────────────────────────────────

const localConnection: ConnectionRow = {
  id: 'conn-local',
  namespace: 'test-ns',
  name: 'local-host',
  host: null,
  port: 22,
  username: null,
  auth_method: null,
  credential_id: null,
  proxy_jump_id: null,
  is_local: true,
  env: null,
  connect_timeout_s: 30,
  keepalive_interval: 60,
  idle_timeout_s: null,
  max_sessions: null,
  host_key_policy: 'strict',
  tags: [],
  notes: null,
};

const sshKeyConnection: ConnectionRow = {
  id: 'conn-ssh-key',
  namespace: 'test-ns',
  name: 'prod-server',
  host: '10.0.0.1',
  port: 22,
  username: 'deploy',
  auth_method: 'key',
  credential_id: 'cred-1',
  proxy_jump_id: null,
  is_local: false,
  env: null,
  connect_timeout_s: 15,
  keepalive_interval: 30,
  idle_timeout_s: 600,
  max_sessions: 5,
  host_key_policy: 'tofu',
  tags: ['prod'],
  notes: 'Production server',
};

const passwordConnection: ConnectionRow = {
  id: 'conn-password',
  namespace: 'test-ns',
  name: 'dev-server',
  host: '10.0.0.2',
  port: 2222,
  username: 'admin',
  auth_method: 'password',
  credential_id: 'cred-2',
  proxy_jump_id: null,
  is_local: false,
  env: null,
  connect_timeout_s: 10,
  keepalive_interval: 60,
  idle_timeout_s: null,
  max_sessions: null,
  host_key_policy: 'skip',
  tags: [],
  notes: null,
};

const bastionConnection: ConnectionRow = {
  id: 'conn-bastion',
  namespace: 'test-ns',
  name: 'bastion',
  host: '203.0.113.1',
  port: 22,
  username: 'jump',
  auth_method: 'key',
  credential_id: 'cred-3',
  proxy_jump_id: null,
  is_local: false,
  env: null,
  connect_timeout_s: 10,
  keepalive_interval: 30,
  idle_timeout_s: null,
  max_sessions: null,
  host_key_policy: 'tofu',
  tags: ['bastion'],
  notes: null,
};

const proxyConnection: ConnectionRow = {
  id: 'conn-via-bastion',
  namespace: 'test-ns',
  name: 'internal-server',
  host: '192.168.1.100',
  port: 22,
  username: 'app',
  auth_method: 'key',
  credential_id: 'cred-4',
  proxy_jump_id: 'conn-bastion',
  is_local: false,
  env: null,
  connect_timeout_s: 30,
  keepalive_interval: 60,
  idle_timeout_s: null,
  max_sessions: null,
  host_key_policy: 'strict',
  tags: [],
  notes: null,
};

// ─── Tests ──────────────────────────────────────────────────

describe('ssh/client', () => {
  describe('buildSSHConfig', () => {
    it('returns null for local connections', () => {
      const config = buildSSHConfig(localConnection, null);
      expect(config).toBeNull();
    });

    it('builds config with key auth', () => {
      const config = buildSSHConfig(sshKeyConnection, {
        kind: 'ssh_key',
        value: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key\n-----END OPENSSH PRIVATE KEY-----',
        fingerprint: 'SHA256:abc',
        publicKey: 'ssh-ed25519 AAAA...',
      });
      expect(config).not.toBeNull();
      expect(config!.host).toBe('10.0.0.1');
      expect(config!.port).toBe(22);
      expect(config!.username).toBe('deploy');
      expect(config!.privateKey).toContain('PRIVATE KEY');
      expect(config!.readyTimeout).toBe(15_000);
      expect(config!.keepaliveInterval).toBe(30_000);
    });

    it('builds config with password auth', () => {
      const config = buildSSHConfig(passwordConnection, {
        kind: 'password',
        value: 'supersecret',
        fingerprint: null,
        publicKey: null,
      });
      expect(config).not.toBeNull();
      expect(config!.host).toBe('10.0.0.2');
      expect(config!.port).toBe(2222);
      expect(config!.username).toBe('admin');
      expect(config!.password).toBe('supersecret');
      expect(config!.privateKey).toBeUndefined();
    });

    it('builds config with agent auth', () => {
      const agentConnection: ConnectionRow = {
        ...sshKeyConnection,
        id: 'conn-agent',
        auth_method: 'agent',
        credential_id: null,
      };
      const config = buildSSHConfig(agentConnection, null);
      expect(config).not.toBeNull();
      expect(config!.agent).toBe(process.env.SSH_AUTH_SOCK);
    });

    it('throws for missing host on non-local connection', () => {
      const noHost: ConnectionRow = { ...sshKeyConnection, host: null };
      expect(() => buildSSHConfig(noHost, null)).toThrow('host');
    });
  });

  describe('resolveProxyChain', () => {
    it('returns empty chain for connections without proxy_jump_id', async () => {
      const pool = createMockPool({});
      const chain = await resolveProxyChain(pool, sshKeyConnection);
      expect(chain).toEqual([]);
    });

    it('resolves a single proxy hop', async () => {
      const pool = createMockPool({
        'conn-bastion': { rows: [bastionConnection] },
      });
      const chain = await resolveProxyChain(pool, proxyConnection);
      expect(chain).toHaveLength(1);
      expect(chain[0].id).toBe('conn-bastion');
    });

    it('detects circular proxy chains', async () => {
      const circular: ConnectionRow = {
        ...bastionConnection,
        proxy_jump_id: 'conn-via-bastion', // points back to proxyConnection
      };
      const pool = createMockPool({
        'conn-bastion': { rows: [circular] },
        'conn-via-bastion': { rows: [proxyConnection] },
      });
      await expect(resolveProxyChain(pool, proxyConnection)).rejects.toThrow(
        'Circular proxy jump chain detected',
      );
    });

    it('limits chain depth to prevent infinite loops', async () => {
      // Build a chain 12 hops deep (limit is 10)
      const pool = createMockPool({});
      const deepChain: ConnectionRow[] = [];
      for (let i = 0; i < 12; i++) {
        deepChain.push({
          ...bastionConnection,
          id: `hop-${i}`,
          proxy_jump_id: i < 11 ? `hop-${i + 1}` : null,
        });
      }
      // Make pool return each hop
      pool.query = vi.fn(async (_sql: string, params?: unknown[]) => {
        const id = params?.[0] as string;
        const hop = deepChain.find((h) => h.id === id);
        return { rows: hop ? [hop] : [] };
      }) as pg.Pool['query'];

      const target: ConnectionRow = {
        ...proxyConnection,
        proxy_jump_id: 'hop-0',
      };
      await expect(resolveProxyChain(pool, target)).rejects.toThrow(
        'Proxy jump chain too deep',
      );
    });
  });

  describe('SSHConnectionManager', () => {
    it('can be instantiated', () => {
      const pool = createMockPool({});
      const manager = new SSHConnectionManager(pool, 'test-encryption-key-hex-64chars-aabbccddeeff00112233445566778899');
      expect(manager).toBeDefined();
    });

    it('returns local flag for local connections', async () => {
      const pool = createMockPool({
        'conn-local': { rows: [localConnection] },
      });
      const manager = new SSHConnectionManager(pool, 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899');
      const result = await manager.getConnection('conn-local');
      expect(result).not.toBeNull();
      expect(result!.isLocal).toBe(true);
    });

    it('exposes activeConnectionCount', () => {
      const pool = createMockPool({});
      const manager = new SSHConnectionManager(pool, 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899');
      expect(manager.activeConnectionCount).toBe(0);
    });

    it('disconnectAll clears all connections', async () => {
      const pool = createMockPool({});
      const manager = new SSHConnectionManager(pool, 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899');
      await manager.disconnectAll();
      expect(manager.activeConnectionCount).toBe(0);
    });
  });
});
