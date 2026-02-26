/**
 * SSH tunnel management handlers for gRPC RPCs.
 * Issue #1852 — SSH tunnel RPCs.
 *
 * Implements: CreateTunnel, CloseTunnel, ListTunnels.
 *
 * Tunnels use the ssh2 library's forwarding capabilities:
 * - Local: forwardOut (binds locally, forwards to remote target)
 * - Remote: forwardIn (binds on remote, forwards to local target)
 * - Dynamic: SOCKS proxy via a local TCP server + ssh2 forwardOut per connection
 *
 * Each handler is a pure async function. The gRPC server layer calls these
 * and converts results to gRPC responses.
 */

import { randomUUID } from 'node:crypto';
import * as net from 'node:net';
import type pg from 'pg';
import type { ClientChannel, TcpConnectionDetails, AcceptConnection, RejectConnection } from 'ssh2';
import type { SSHConnectionManager } from './ssh/client.ts';
import type {
  CreateTunnelRequest,
  CloseTunnelRequest,
  ListTunnelsRequest,
  ListTunnelsResponse,
  TunnelInfo,
} from './types.ts';

/** Active tunnel state tracked in-memory for clean shutdown. */
interface ActiveTunnel {
  id: string;
  connectionId: string;
  /** For local tunnels: the local TCP server. For dynamic: the SOCKS server. */
  server?: net.Server;
  /** Cleanup function to tear down the tunnel. */
  cleanup: () => void;
}

/** In-memory registry of active tunnels on this worker. */
const activeTunnels = new Map<string, ActiveTunnel>();

/**
 * Create a new SSH tunnel.
 *
 * Flow:
 * 1. Get SSH connection via SSHConnectionManager
 * 2. Set up tunnel based on direction (local, remote, dynamic)
 * 3. Insert tunnel record in DB
 * 4. Track tunnel in-memory for cleanup
 * 5. Return TunnelInfo
 */
export async function handleCreateTunnel(
  req: CreateTunnelRequest,
  pool: pg.Pool,
  sshManager: SSHConnectionManager,
): Promise<TunnelInfo> {
  // Validate direction
  if (!['local', 'remote', 'dynamic'].includes(req.direction)) {
    throw new Error(`Invalid tunnel direction: ${req.direction}. Must be 'local', 'remote', or 'dynamic'`);
  }

  // Get SSH connection
  const sshResult = await sshManager.getConnection(req.connection_id);
  if (!sshResult) {
    throw new Error(`Connection not found: ${req.connection_id}`);
  }
  if (sshResult.isLocal) {
    throw new Error('Cannot create SSH tunnel on a local connection');
  }
  if (!sshResult.client) {
    throw new Error(`No SSH client available for connection ${req.connection_id}`);
  }

  const tunnelId = randomUUID();
  const bindHost = req.bind_host || '127.0.0.1';
  const now = new Date().toISOString();

  try {
    let cleanupFn: () => void;
    let server: net.Server | undefined;

    switch (req.direction) {
      case 'local': {
        // Local tunnel: listen on local port, forward to remote target via SSH
        if (!req.target_host || !req.target_port) {
          throw new Error('target_host and target_port are required for local tunnels');
        }

        const localServer = net.createServer((socket) => {
          sshResult.client!.forwardOut(
            bindHost,
            req.bind_port,
            req.target_host,
            req.target_port,
            (err, stream) => {
              if (err) {
                socket.destroy();
                return;
              }
              socket.pipe(stream).pipe(socket);
              stream.on('close', () => socket.destroy());
              socket.on('close', () => stream.destroy());
            },
          );
        });

        await new Promise<void>((resolve, reject) => {
          localServer.listen(req.bind_port, bindHost, () => resolve());
          localServer.once('error', reject);
        });

        server = localServer;
        cleanupFn = () => {
          localServer.close();
        };
        break;
      }

      case 'remote': {
        // Remote tunnel: bind on remote host, forward connections back through SSH
        if (!req.target_host || !req.target_port) {
          throw new Error('target_host and target_port are required for remote tunnels');
        }

        await new Promise<void>((resolve, reject) => {
          sshResult.client!.forwardIn(bindHost, req.bind_port, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Handle incoming forwarded connections
        const connHandler = (
          _details: TcpConnectionDetails,
          accept: AcceptConnection<ClientChannel>,
          _reject: RejectConnection,
        ) => {
          const stream = accept();
          const local = net.createConnection(req.target_port, req.target_host);
          stream.pipe(local).pipe(stream);
          local.on('error', () => stream.destroy());
          stream.on('error', () => local.destroy());
        };
        sshResult.client!.on('tcp connection', connHandler);

        cleanupFn = () => {
          sshResult.client!.removeListener('tcp connection', connHandler);
          sshResult.client!.unforwardIn(bindHost, req.bind_port, () => {});
        };
        break;
      }

      case 'dynamic': {
        // Dynamic SOCKS proxy: listen locally, route through SSH
        const socksServer = net.createServer((socket) => {
          // Simple SOCKS5 proxy implementation
          socket.once('data', (greetingRaw) => {
            const greeting = Buffer.isBuffer(greetingRaw) ? greetingRaw : Buffer.from(greetingRaw);
            if (greeting[0] !== 0x05) {
              socket.destroy();
              return;
            }

            // Respond: no auth required
            socket.write(Buffer.from([0x05, 0x00]));

            socket.once('data', (requestRaw) => {
              const request = Buffer.isBuffer(requestRaw) ? requestRaw : Buffer.from(requestRaw);
              if (request[0] !== 0x05 || request[1] !== 0x01) {
                socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                socket.destroy();
                return;
              }

              let targetHost: string;
              let targetPort: number;
              let offset: number;

              switch (request[3]) {
                case 0x01: // IPv4
                  targetHost = `${request[4]}.${request[5]}.${request[6]}.${request[7]}`;
                  offset = 8;
                  break;
                case 0x03: { // Domain name
                  const domainLen = request[4];
                  targetHost = request.subarray(5, 5 + domainLen).toString();
                  offset = 5 + domainLen;
                  break;
                }
                case 0x04: // IPv6
                  targetHost = Array.from({ length: 8 }, (_, i) =>
                    request.readUInt16BE(4 + i * 2).toString(16),
                  ).join(':');
                  offset = 20;
                  break;
                default:
                  socket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                  socket.destroy();
                  return;
              }

              targetPort = request.readUInt16BE(offset);

              sshResult.client!.forwardOut(
                bindHost,
                0,
                targetHost,
                targetPort,
                (err, stream) => {
                  if (err) {
                    socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                    socket.destroy();
                    return;
                  }

                  // Success response
                  socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                  socket.pipe(stream).pipe(socket);
                  stream.on('close', () => socket.destroy());
                  socket.on('close', () => stream.destroy());
                },
              );
            });
          });
        });

        await new Promise<void>((resolve, reject) => {
          socksServer.listen(req.bind_port, bindHost, () => resolve());
          socksServer.once('error', reject);
        });

        server = socksServer;
        cleanupFn = () => {
          socksServer.close();
        };
        break;
      }

      default:
        throw new Error(`Unknown tunnel direction: ${req.direction}`);
    }

    // Insert tunnel record in DB
    await pool.query(
      `INSERT INTO terminal_tunnel
         (id, namespace, connection_id, session_id, direction, bind_host, bind_port,
          target_host, target_port, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $10)`,
      [
        tunnelId,
        req.namespace,
        req.connection_id,
        req.session_id || null,
        req.direction,
        bindHost,
        req.bind_port,
        req.target_host || null,
        req.target_port || null,
        now,
      ],
    );

    // Track tunnel in-memory
    activeTunnels.set(tunnelId, {
      id: tunnelId,
      connectionId: req.connection_id,
      server,
      cleanup: cleanupFn,
    });

    // Monitor SSH connection for tunnel health
    sshResult.client!.once('close', () => {
      markTunnelFailed(pool, tunnelId, 'SSH connection closed').catch(() => {});
      const tracked = activeTunnels.get(tunnelId);
      if (tracked) {
        tracked.cleanup();
        activeTunnels.delete(tunnelId);
      }
    });

    return {
      id: tunnelId,
      connection_id: req.connection_id,
      session_id: req.session_id || '',
      direction: req.direction,
      bind_host: bindHost,
      bind_port: req.bind_port,
      target_host: req.target_host || '',
      target_port: req.target_port || 0,
      status: 'active',
      error_message: '',
    };
  } catch (err) {
    // Record failed tunnel in DB for visibility
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `INSERT INTO terminal_tunnel
         (id, namespace, connection_id, session_id, direction, bind_host, bind_port,
          target_host, target_port, status, error_message, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'failed', $10, $11, $11)`,
      [
        tunnelId,
        req.namespace,
        req.connection_id,
        req.session_id || null,
        req.direction,
        bindHost,
        req.bind_port,
        req.target_host || null,
        req.target_port || null,
        message,
        now,
      ],
    );
    throw err;
  }
}

/**
 * Close an active tunnel.
 *
 * Flow:
 * 1. Look up tunnel in active registry
 * 2. Call cleanup (close server/unforward)
 * 3. Update DB status to 'closed'
 */
export async function handleCloseTunnel(
  req: CloseTunnelRequest,
  pool: pg.Pool,
): Promise<void> {
  // Clean up in-memory tunnel
  const tracked = activeTunnels.get(req.tunnel_id);
  if (tracked) {
    tracked.cleanup();
    activeTunnels.delete(req.tunnel_id);
  }

  // Update DB status
  const result = await pool.query(
    `UPDATE terminal_tunnel SET status = 'closed', updated_at = NOW()
     WHERE id = $1 AND status = 'active'
     RETURNING id`,
    [req.tunnel_id],
  );

  if (result.rowCount === 0) {
    throw new Error(`Tunnel not found or already closed: ${req.tunnel_id}`);
  }
}

/**
 * List tunnels, optionally filtered by namespace and connection_id.
 */
export async function handleListTunnels(
  req: ListTunnelsRequest,
  pool: pg.Pool,
): Promise<ListTunnelsResponse> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (req.namespace) {
    conditions.push(`namespace = $${idx++}`);
    params.push(req.namespace);
  }

  if (req.connection_id) {
    conditions.push(`connection_id = $${idx++}`);
    params.push(req.connection_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query<{
    id: string;
    connection_id: string;
    session_id: string | null;
    direction: string;
    bind_host: string;
    bind_port: number;
    target_host: string | null;
    target_port: number | null;
    status: string;
    error_message: string | null;
  }>(
    `SELECT id, connection_id, session_id, direction, bind_host, bind_port,
            target_host, target_port, status, error_message
     FROM terminal_tunnel
     ${where}
     ORDER BY created_at DESC
     LIMIT 100`,
    params,
  );

  const tunnels: TunnelInfo[] = result.rows.map((row) => ({
    id: row.id,
    connection_id: row.connection_id,
    session_id: row.session_id ?? '',
    direction: row.direction,
    bind_host: row.bind_host,
    bind_port: row.bind_port,
    target_host: row.target_host ?? '',
    target_port: row.target_port ?? 0,
    status: row.status,
    error_message: row.error_message ?? '',
  }));

  return { tunnels };
}

/**
 * Mark a tunnel as failed in the database.
 */
async function markTunnelFailed(
  pool: pg.Pool,
  tunnelId: string,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `UPDATE terminal_tunnel SET status = 'failed', error_message = $1, updated_at = NOW()
     WHERE id = $2 AND status = 'active'`,
    [errorMessage, tunnelId],
  );
}

/**
 * Clean up all active tunnels. Called during graceful shutdown.
 */
export function cleanupAllTunnels(): void {
  for (const [id, tunnel] of activeTunnels) {
    tunnel.cleanup();
    activeTunnels.delete(id);
  }
}

/**
 * Get the count of active tunnels (for health/status reporting).
 */
export function getActiveTunnelCount(): number {
  return activeTunnels.size;
}
