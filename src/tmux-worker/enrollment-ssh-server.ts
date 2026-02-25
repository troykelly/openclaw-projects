/**
 * SSH enrollment server for reverse tunnel self-registration.
 *
 * Runs a lightweight SSH server on the enrollment port (default 2222).
 * Remote servers authenticate with enrollment tokens (as password) and
 * establish reverse tunnels back to themselves.
 *
 * Issue #1684 — SSH enrollment server
 * Epic #1667 — TMux Session Management
 */

import { Server as SSHServer, utils as sshUtils } from 'ssh2';
import { generateKeyPairSync } from 'node:crypto';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { TmuxWorkerConfig } from './config.ts';

/** Rate limiting: track failed auth attempts per IP. */
const failedAuthAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_FAILED_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/** Cleanup stale rate limit entries every 5 minutes. */
let rateLimitCleanupTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Validate an enrollment token against the database.
 * Returns the token row on success, null on failure.
 */
async function validateEnrollmentToken(
  pool: pg.Pool,
  tokenPlaintext: string,
): Promise<{
  id: string;
  namespace: string;
  label: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  connection_defaults: Record<string, unknown> | null;
  allowed_tags: string[] | null;
} | null> {
  const tokenHash = createHash('sha256').update(tokenPlaintext).digest('hex');

  const result = await pool.query(
    `SELECT id, namespace, label, max_uses, uses, expires_at, connection_defaults, allowed_tags
     FROM terminal_enrollment_token
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (result.rows.length === 0) return null;

  const token = result.rows[0];

  // Check expiry
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    return null;
  }

  // Check max_uses
  if (token.max_uses !== null && token.uses >= token.max_uses) {
    return null;
  }

  return token;
}

/**
 * Check rate limiting for an IP address.
 * Returns true if the IP is rate-limited (too many failed attempts).
 */
function isRateLimited(ip: string): boolean {
  const entry = failedAuthAttempts.get(ip);
  if (!entry) return false;

  // Reset if outside window
  if (Date.now() - entry.lastAttempt > RATE_LIMIT_WINDOW_MS) {
    failedAuthAttempts.delete(ip);
    return false;
  }

  return entry.count >= MAX_FAILED_ATTEMPTS;
}

/** Record a failed auth attempt for rate limiting. */
function recordFailedAttempt(ip: string): void {
  const entry = failedAuthAttempts.get(ip);
  if (entry && Date.now() - entry.lastAttempt < RATE_LIMIT_WINDOW_MS) {
    entry.count++;
    entry.lastAttempt = Date.now();
  } else {
    failedAuthAttempts.set(ip, { count: 1, lastAttempt: Date.now() });
  }
}

/** Clear rate limit entries for an IP on successful auth. */
function clearRateLimit(ip: string): void {
  failedAuthAttempts.delete(ip);
}

/**
 * Generate a host key for the SSH server.
 * Returns the private key in OpenSSH format.
 */
function generateHostKey(): Buffer {
  const { privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return Buffer.from(privateKey);
}

/**
 * Record an activity event (fire-and-forget).
 */
function recordActivityLocal(
  pool: pg.Pool,
  event: {
    namespace: string;
    connection_id?: string;
    actor: string;
    action: string;
    detail?: Record<string, unknown>;
  },
): void {
  pool
    .query(
      `INSERT INTO terminal_activity (namespace, connection_id, actor, action, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        event.namespace,
        event.connection_id ?? null,
        event.actor,
        event.action,
        event.detail ? JSON.stringify(event.detail) : null,
      ],
    )
    .catch((err: unknown) => {
      console.error(
        `Failed to record SSH enrollment activity: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}

/**
 * Create and start the SSH enrollment server.
 */
export function createEnrollmentSSHServer(
  config: TmuxWorkerConfig,
  pool: pg.Pool,
): SSHServer {
  const hostKey = generateHostKey();

  const server = new SSHServer(
    { hostKeys: [hostKey] },
    (client) => {
      const clientAddress = (client as unknown as { _sock?: { remoteAddress?: string } })._sock?.remoteAddress ?? 'unknown';

      client.on('authentication', (ctx) => {
        // Only accept password auth (password = enrollment token)
        if (ctx.method !== 'password') {
          ctx.reject(['password']);
          return;
        }

        // Username must be 'enroll'
        if (ctx.username !== 'enroll') {
          recordFailedAttempt(clientAddress);
          ctx.reject(['password']);
          return;
        }

        // Rate limit check
        if (isRateLimited(clientAddress)) {
          console.warn(`Rate limited SSH enrollment attempt from ${clientAddress}`);
          ctx.reject(['password']);
          return;
        }

        const tokenPlaintext = ctx.password;

        validateEnrollmentToken(pool, tokenPlaintext)
          .then(async (token) => {
            if (!token) {
              recordFailedAttempt(clientAddress);
              ctx.reject(['password']);
              return;
            }

            clearRateLimit(clientAddress);

            // Increment uses
            await pool.query(
              `UPDATE terminal_enrollment_token SET uses = uses + 1 WHERE id = $1`,
              [token.id],
            );

            // Create terminal_connection for the enrolled server
            const defaults = token.connection_defaults ?? {};
            const tags = [...(token.allowed_tags ?? [])];

            const connResult = await pool.query(
              `INSERT INTO terminal_connection
                 (namespace, name, host, port, username, tags, notes, env)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id`,
              [
                token.namespace,
                `enrolled-${clientAddress}`,
                clientAddress,
                22,
                (defaults.username as string) ?? null,
                tags.length > 0 ? tags : null,
                (defaults.notes as string) ?? `Enrolled via SSH from ${clientAddress}`,
                defaults.env ? JSON.stringify(defaults.env) : null,
              ],
            );

            const connectionId = connResult.rows[0].id as string;

            recordActivityLocal(pool, {
              namespace: token.namespace,
              connection_id: connectionId,
              actor: 'system',
              action: 'enrollment.register',
              detail: {
                token_label: token.label,
                remote_host: clientAddress,
                method: 'ssh',
              },
            });

            console.log(
              `SSH enrollment: ${clientAddress} enrolled via token "${token.label}" (connection ${connectionId})`,
            );

            // Store connection ID on the client for tunnel handling
            (client as unknown as Record<string, unknown>).__connectionId = connectionId;
            (client as unknown as Record<string, unknown>).__namespace = token.namespace;

            ctx.accept();
          })
          .catch((err: unknown) => {
            console.error(
              `SSH enrollment auth error: ${err instanceof Error ? err.message : String(err)}`,
            );
            ctx.reject(['password']);
          });
      });

      client.on('ready', () => {
        console.log(`SSH enrollment client authenticated from ${clientAddress}`);
      });

      // Handle reverse tunnel requests
      client.on('request', (accept, reject, name, info) => {
        if (name === 'tcpip-forward') {
          const bindAddr = (info as { bindAddr: string }).bindAddr;
          const bindPort = (info as { bindPort: number }).bindPort;
          const connectionId = (client as unknown as Record<string, unknown>).__connectionId as string | undefined;
          const namespace = (client as unknown as Record<string, unknown>).__namespace as string | undefined;

          if (!connectionId || !namespace) {
            reject?.();
            return;
          }

          // Record tunnel in DB
          pool
            .query(
              `INSERT INTO terminal_tunnel
                 (namespace, connection_id, direction, bind_host, bind_port, status)
               VALUES ($1, $2, 'remote', $3, $4, 'active')
               RETURNING id`,
              [namespace, connectionId, bindAddr || '127.0.0.1', bindPort || 0],
            )
            .then((tunnelResult) => {
              const tunnelId = tunnelResult.rows[0]?.id;

              recordActivityLocal(pool, {
                namespace,
                connection_id: connectionId,
                actor: 'system',
                action: 'tunnel.create',
                detail: {
                  direction: 'remote',
                  bind_port: bindPort,
                  tunnel_id: tunnelId,
                  method: 'ssh_enrollment',
                },
              });

              // Accept with an assigned port (0 means server picks one)
              accept?.();
            })
            .catch((err: unknown) => {
              console.error(
                `Failed to record enrollment tunnel: ${err instanceof Error ? err.message : String(err)}`,
              );
              reject?.();
            });
        } else {
          reject?.();
        }
      });

      client.on('close', () => {
        const connectionId = (client as unknown as Record<string, unknown>).__connectionId as string | undefined;
        const namespace = (client as unknown as Record<string, unknown>).__namespace as string | undefined;

        if (connectionId && namespace) {
          // Mark tunnels as closed
          pool
            .query(
              `UPDATE terminal_tunnel SET status = 'closed', updated_at = now()
               WHERE connection_id = $1 AND status = 'active'`,
              [connectionId],
            )
            .catch((err: unknown) => {
              console.error(
                `Failed to close enrollment tunnels: ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
      });

      client.on('error', (err) => {
        console.error(`SSH enrollment client error: ${err.message}`);
      });
    },
  );

  // Start rate limit cleanup timer
  rateLimitCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of failedAuthAttempts) {
      if (now - entry.lastAttempt > RATE_LIMIT_WINDOW_MS) {
        failedAuthAttempts.delete(ip);
      }
    }
  }, 5 * 60 * 1000);

  return server;
}

/**
 * Start the SSH enrollment server listening on the configured port.
 */
export function startEnrollmentSSHServer(
  server: SSHServer,
  port: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`SSH enrollment server listening on port ${port}`);
      resolve();
    });

    server.on('error', (err: Error) => {
      reject(err);
    });
  });
}

/**
 * Stop the SSH enrollment server.
 */
export function stopEnrollmentSSHServer(server: SSHServer): Promise<void> {
  if (rateLimitCleanupTimer) {
    clearInterval(rateLimitCleanupTimer);
    rateLimitCleanupTimer = undefined;
  }

  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

// Export for testing
export { isRateLimited, recordFailedAttempt, clearRateLimit, failedAuthAttempts };
