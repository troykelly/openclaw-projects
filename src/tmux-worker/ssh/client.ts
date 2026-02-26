/**
 * SSH client module for the tmux worker.
 * Issue #1845 — SSH client module.
 *
 * Manages SSH connections for terminal sessions:
 * - Auth methods: key (encrypted), password (encrypted), agent forwarding, command-based
 * - Proxy jump chains via proxy_jump_id (recursive)
 * - Host key verification callbacks: strict, TOFU, skip
 * - Connection pooling/reuse by connection_id
 * - Keepalive and timeout from connection config
 */

import { Client as SSH2Client } from 'ssh2';
import type { ConnectConfig, ClientChannel } from 'ssh2';
import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { resolveCredential, type ResolvedCredential } from '../credentials/index.ts';

/** Maximum proxy jump chain depth to prevent infinite loops. */
const MAX_PROXY_CHAIN_DEPTH = 10;

/** Database row shape for terminal_connection. */
export interface ConnectionRow {
  id: string;
  namespace: string;
  name: string;
  host: string | null;
  port: number;
  username: string | null;
  auth_method: string | null;
  credential_id: string | null;
  proxy_jump_id: string | null;
  is_local: boolean;
  env: Record<string, string> | null;
  connect_timeout_s: number;
  keepalive_interval: number;
  idle_timeout_s: number | null;
  max_sessions: number | null;
  host_key_policy: string;
  tags: string[];
  notes: string | null;
}

/** Database row shape for terminal_known_host. */
interface KnownHostRow {
  id: string;
  namespace: string;
  connection_id: string;
  host: string;
  port: number;
  key_type: string;
  key_fingerprint: string;
  public_key: string;
}

/** Options for creating an SSH connection. */
export interface SSHConnectionOptions {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  agent?: string;
  readyTimeout: number;
  keepaliveInterval: number;
}

/** Result of an SSH connect operation. */
export interface SSHConnectResult {
  /** Whether this is a local connection (no SSH needed). */
  isLocal: boolean;
  /** The SSH client, if connected (null for local). */
  client: SSH2Client | null;
  /** Connection info for tracking. */
  connectionId: string;
}

/** Host key verification result. */
type HostKeyVerifyResult = 'accept' | 'reject' | 'pending';

/**
 * Build an ssh2 ConnectConfig from a connection row and resolved credential.
 *
 * @returns null for local connections, ConnectConfig for SSH connections
 * @throws if host is missing for non-local connections
 */
export function buildSSHConfig(
  conn: ConnectionRow,
  credential: ResolvedCredential | null,
): ConnectConfig | null {
  if (conn.is_local) {
    return null;
  }

  if (!conn.host) {
    throw new Error(`Connection ${conn.id} is not local but has no host configured`);
  }

  const config: ConnectConfig = {
    host: conn.host,
    port: conn.port || 22,
    username: conn.username || undefined,
    readyTimeout: (conn.connect_timeout_s || 30) * 1000,
    keepaliveInterval: (conn.keepalive_interval || 60) * 1000,
    keepaliveCountMax: 3,
  };

  switch (conn.auth_method) {
    case 'key':
      if (credential?.kind === 'ssh_key') {
        config.privateKey = credential.value;
      }
      break;
    case 'password':
      if (credential?.kind === 'password') {
        config.password = credential.value;
      }
      break;
    case 'agent':
      config.agent = process.env.SSH_AUTH_SOCK || undefined;
      break;
    case 'command':
      // Command-based credentials are resolved to a key or password value
      if (credential) {
        // Detect if the value looks like a private key
        if (credential.value.includes('PRIVATE KEY')) {
          config.privateKey = credential.value;
        } else {
          config.password = credential.value;
        }
      }
      break;
    default:
      // No auth configured, try agent as fallback
      config.agent = process.env.SSH_AUTH_SOCK || undefined;
      break;
  }

  return config;
}

/**
 * Resolve the proxy jump chain for a connection.
 *
 * Walks the proxy_jump_id chain backwards from the target to the outermost bastion.
 * The returned array is ordered from outermost to innermost (the order connections
 * must be established).
 *
 * @returns Array of connection rows forming the proxy chain (empty if no proxy)
 * @throws if the chain is circular or exceeds MAX_PROXY_CHAIN_DEPTH
 */
export async function resolveProxyChain(
  pool: pg.Pool,
  target: ConnectionRow,
): Promise<ConnectionRow[]> {
  if (!target.proxy_jump_id) {
    return [];
  }

  const chain: ConnectionRow[] = [];
  const seen = new Set<string>([target.id]);
  let currentJumpId: string | null = target.proxy_jump_id;

  while (currentJumpId) {
    if (chain.length >= MAX_PROXY_CHAIN_DEPTH) {
      throw new Error(
        `Proxy jump chain too deep (>${MAX_PROXY_CHAIN_DEPTH} hops) for connection ${target.id}`,
      );
    }

    if (seen.has(currentJumpId)) {
      throw new Error(
        `Circular proxy jump chain detected: ${currentJumpId} already visited for connection ${target.id}`,
      );
    }

    const queryResult: pg.QueryResult<ConnectionRow> = await pool.query<ConnectionRow>(
      `SELECT id, namespace, name, host, port, username, auth_method,
              credential_id, proxy_jump_id, is_local, env,
              connect_timeout_s, keepalive_interval, idle_timeout_s,
              max_sessions, host_key_policy, tags, notes
       FROM terminal_connection
       WHERE id = $1 AND deleted_at IS NULL`,
      [currentJumpId],
    );

    if (queryResult.rows.length === 0) {
      throw new Error(`Proxy jump connection not found: ${currentJumpId}`);
    }

    const hop: ConnectionRow = queryResult.rows[0];
    seen.add(hop.id);
    chain.unshift(hop); // Add at beginning — outermost first
    currentJumpId = hop.proxy_jump_id;
  }

  return chain;
}

/**
 * Compute the SHA-256 fingerprint of an SSH host key.
 */
function computeFingerprint(key: Buffer): string {
  const hash = createHash('sha256').update(key).digest('base64');
  return `SHA256:${hash}`;
}

/**
 * Verify a host key against the known_hosts table.
 */
async function verifyHostKey(
  pool: pg.Pool,
  conn: ConnectionRow,
  keyType: string,
  keyData: Buffer,
): Promise<HostKeyVerifyResult> {
  const fingerprint = computeFingerprint(keyData);
  const publicKey = keyData.toString('base64');

  switch (conn.host_key_policy) {
    case 'skip':
      console.warn(
        `Host key verification skipped for ${conn.host}:${conn.port} (policy: skip)`,
      );
      return 'accept';

    case 'tofu': {
      // Trust On First Use: accept and store if new, reject if changed
      const existing = await pool.query<KnownHostRow>(
        `SELECT id, key_fingerprint, public_key
         FROM terminal_known_host
         WHERE namespace = $1 AND host = $2 AND port = $3 AND key_type = $4`,
        [conn.namespace, conn.host, conn.port, keyType],
      );

      if (existing.rows.length === 0) {
        // First connection — trust and store
        await pool.query(
          `INSERT INTO terminal_known_host
           (id, namespace, connection_id, host, port, key_type, key_fingerprint, public_key, trusted_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'tofu')`,
          [conn.namespace, conn.id, conn.host, conn.port, keyType, fingerprint, publicKey],
        );
        return 'accept';
      }

      // Key exists — compare fingerprints
      if (existing.rows[0].key_fingerprint === fingerprint) {
        return 'accept';
      }

      // Key mismatch — possible MITM
      console.error(
        `HOST KEY MISMATCH for ${conn.host}:${conn.port}! ` +
        `Expected ${existing.rows[0].key_fingerprint}, got ${fingerprint}`,
      );
      return 'reject';
    }

    case 'strict':
    default: {
      // Strict: only accept if the key is in known_hosts
      const existing = await pool.query<KnownHostRow>(
        `SELECT id, key_fingerprint
         FROM terminal_known_host
         WHERE namespace = $1 AND host = $2 AND port = $3 AND key_type = $4`,
        [conn.namespace, conn.host, conn.port, keyType],
      );

      if (existing.rows.length === 0) {
        // Unknown host — needs manual approval
        return 'pending';
      }

      if (existing.rows[0].key_fingerprint === fingerprint) {
        return 'accept';
      }

      // Key mismatch
      console.error(
        `HOST KEY MISMATCH for ${conn.host}:${conn.port}! ` +
        `Expected ${existing.rows[0].key_fingerprint}, got ${fingerprint}`,
      );
      return 'reject';
    }
  }
}

/**
 * Connect an SSH2 client with host key verification.
 */
function connectSSH(
  client: SSH2Client,
  config: ConnectConfig,
  conn: ConnectionRow,
  pool: pg.Pool,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error(`SSH connection timeout after ${conn.connect_timeout_s}s to ${conn.host}:${conn.port}`));
    }, (conn.connect_timeout_s || 30) * 1000);

    client.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });

    client.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Build config with host key verification
    const fullConfig: ConnectConfig = {
      ...config,
      hostVerifier: (key: Buffer) => {
        // ssh2 expects synchronous return or a promise
        // We use the async verifyHostKey but need to handle it carefully
        // For skip policy, accept immediately
        if (conn.host_key_policy === 'skip') {
          return true;
        }
        // For strict/tofu, we need async verification
        // ssh2 v1.x supports returning a promise from hostVerifier
        return verifyHostKey(pool, conn, 'ssh-unknown', key).then((result) => {
          if (result === 'accept') return true;
          if (result === 'reject') return false;
          // pending — reject for now, session will be set to pending_host_verification
          return false;
        });
      },
    };

    client.connect(fullConfig);
  });
}

/**
 * Establish an SSH connection through a proxy chain.
 *
 * Opens connections from outermost bastion inward, using forwardOut
 * to tunnel through each hop.
 */
async function connectThroughProxyChain(
  chain: ConnectionRow[],
  target: ConnectionRow,
  pool: pg.Pool,
  masterKeyHex: string,
): Promise<{ client: SSH2Client; intermediaries: SSH2Client[] }> {
  const intermediaries: SSH2Client[] = [];

  let currentStream: ClientChannel | undefined;

  // Connect through each hop in the chain
  for (const hop of chain) {
    const hopClient = new SSH2Client();
    const credential = hop.credential_id
      ? await resolveCredential(pool, hop.credential_id, masterKeyHex)
      : null;
    const hopConfig = buildSSHConfig(hop, credential);

    if (!hopConfig) {
      throw new Error(`Proxy hop ${hop.id} (${hop.name}) is configured as local — cannot proxy through it`);
    }

    if (currentStream) {
      // Connect through the previous hop's forwarded stream
      hopConfig.sock = currentStream as unknown as Readable;
    }

    await connectSSH(hopClient, hopConfig, hop, pool);
    intermediaries.push(hopClient);

    // Forward to the next hop (or the final target)
    const nextHop = chain[chain.indexOf(hop) + 1] || target;
    if (!nextHop.host) {
      throw new Error(`Cannot forward to ${nextHop.id} — no host configured`);
    }
    currentStream = await new Promise<ClientChannel>((resolve, reject) => {
      hopClient.forwardOut(
        '127.0.0.1',
        0,
        nextHop.host!,
        nextHop.port || 22,
        (err, stream) => {
          if (err) reject(err);
          else resolve(stream);
        },
      );
    });
  }

  // Connect the final target through the last stream
  const targetClient = new SSH2Client();
  const targetCredential = target.credential_id
    ? await resolveCredential(pool, target.credential_id, masterKeyHex)
    : null;
  const targetConfig = buildSSHConfig(target, targetCredential);

  if (!targetConfig) {
    throw new Error(`Target connection ${target.id} is local — cannot SSH to it`);
  }

  if (currentStream) {
    targetConfig.sock = currentStream as unknown as Readable;
  }

  await connectSSH(targetClient, targetConfig, target, pool);

  return { client: targetClient, intermediaries };
}

/**
 * Manages SSH connections for the tmux worker.
 *
 * Provides connection pooling by connection_id, credential resolution,
 * proxy jump chain handling, and host key verification.
 */
export class SSHConnectionManager {
  private readonly pool: pg.Pool;
  private readonly masterKeyHex: string;
  /** Active SSH connections keyed by connection_id. */
  private readonly connections = new Map<string, {
    client: SSH2Client;
    intermediaries: SSH2Client[];
    connectionRow: ConnectionRow;
  }>();

  constructor(pool: pg.Pool, masterKeyHex: string) {
    this.pool = pool;
    this.masterKeyHex = masterKeyHex;
  }

  /** Number of active SSH connections. */
  get activeConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get or create an SSH connection for a connection_id.
   *
   * @returns SSHConnectResult with client and isLocal flag
   */
  async getConnection(connectionId: string): Promise<SSHConnectResult | null> {
    // Check for existing connection
    const existing = this.connections.get(connectionId);
    if (existing) {
      return {
        isLocal: false,
        client: existing.client,
        connectionId,
      };
    }

    // Fetch connection from DB
    const result = await this.pool.query<ConnectionRow>(
      `SELECT id, namespace, name, host, port, username, auth_method,
              credential_id, proxy_jump_id, is_local, env,
              connect_timeout_s, keepalive_interval, idle_timeout_s,
              max_sessions, host_key_policy, tags, notes
       FROM terminal_connection
       WHERE id = $1 AND deleted_at IS NULL`,
      [connectionId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const conn = result.rows[0];

    // Local connection — no SSH needed
    if (conn.is_local) {
      return {
        isLocal: true,
        client: null,
        connectionId,
      };
    }

    // Resolve proxy chain
    const chain = await resolveProxyChain(this.pool, conn);

    if (chain.length > 0) {
      // Connect through proxy chain
      const { client, intermediaries } = await connectThroughProxyChain(
        chain,
        conn,
        this.pool,
        this.masterKeyHex,
      );

      this.connections.set(connectionId, { client, intermediaries, connectionRow: conn });

      // Handle disconnect
      client.once('close', () => {
        this.connections.delete(connectionId);
      });

      // Update last_connected_at
      await this.pool.query(
        `UPDATE terminal_connection SET last_connected_at = NOW(), last_error = NULL WHERE id = $1`,
        [connectionId],
      ).catch(() => {});

      return {
        isLocal: false,
        client,
        connectionId,
      };
    }

    // Direct connection (no proxy)
    const credential = conn.credential_id
      ? await resolveCredential(this.pool, conn.credential_id, this.masterKeyHex)
      : null;
    const sshConfig = buildSSHConfig(conn, credential);

    if (!sshConfig) {
      throw new Error(`Connection ${connectionId} is not local but produced no SSH config`);
    }

    const client = new SSH2Client();
    await connectSSH(client, sshConfig, conn, this.pool);

    this.connections.set(connectionId, {
      client,
      intermediaries: [],
      connectionRow: conn,
    });

    // Handle disconnect
    client.once('close', () => {
      this.connections.delete(connectionId);
    });

    // Update last_connected_at
    await this.pool.query(
      `UPDATE terminal_connection SET last_connected_at = NOW(), last_error = NULL WHERE id = $1`,
      [connectionId],
    ).catch(() => {});

    return {
      isLocal: false,
      client,
      connectionId,
    };
  }

  /**
   * Disconnect a specific connection and clean up intermediaries.
   */
  async disconnect(connectionId: string): Promise<void> {
    const entry = this.connections.get(connectionId);
    if (!entry) return;

    entry.client.end();
    for (const hop of entry.intermediaries) {
      hop.end();
    }
    this.connections.delete(connectionId);
  }

  /**
   * Disconnect all active SSH connections. Used during shutdown.
   */
  async disconnectAll(): Promise<void> {
    for (const [id] of this.connections) {
      await this.disconnect(id);
    }
  }

  /**
   * Test connectivity to a connection without creating a persistent connection.
   *
   * @returns Object with success flag, latency, and optional error message
   */
  async testConnection(
    connectionId: string,
  ): Promise<{ success: boolean; message: string; latencyMs: number; hostKeyFingerprint: string }> {
    const start = Date.now();
    try {
      const connResult = await this.getConnection(connectionId);
      const latencyMs = Date.now() - start;

      if (!connResult) {
        return { success: false, message: 'Connection not found', latencyMs, hostKeyFingerprint: '' };
      }

      if (connResult.isLocal) {
        return { success: true, message: 'Local connection OK', latencyMs, hostKeyFingerprint: '' };
      }

      // Disconnect the test connection
      await this.disconnect(connectionId);

      return {
        success: true,
        message: `Connected in ${latencyMs}ms`,
        latencyMs,
        hostKeyFingerprint: '',
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      // Record error on the connection
      await this.pool.query(
        `UPDATE terminal_connection SET last_error = $1 WHERE id = $2`,
        [message, connectionId],
      ).catch(() => {});

      return { success: false, message, latencyMs, hostKeyFingerprint: '' };
    }
  }
}
