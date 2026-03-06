/**
 * Health + metrics HTTP server for the symphony worker.
 * Issue #2195 — Symphony Worker Process Skeleton.
 *
 * P2-1: Uses a separate configurable port (SYMPHONY_HEALTH_PORT, default 9001).
 * Fails fast with a clear error if the port is already in use.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { serialize } from './metrics.ts';

export interface SymphonyHealthStatus {
  dbConnected: boolean;
  listenClientConnected: boolean;
  activeRuns: number;
  lastTickAt: number | null;
  ticksTotal: number;
  orchestratorId: string;
  uptimeSeconds: number;
}

/**
 * Start a minimal HTTP server exposing /health and /metrics for the symphony worker.
 *
 * @param port   Port to listen on (default 9001).
 * @param checks Callback that returns the current health status.
 * @returns Promise that resolves to the http.Server instance once listening.
 * @throws If the port is already in use (EADDRINUSE).
 */
export function startSymphonyHealthServer(
  port: number,
  checks: () => Promise<SymphonyHealthStatus>,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        try {
          const status = await checks();
          const ok = status.dbConnected && status.listenClientConnected;
          const body = JSON.stringify({
            ok,
            uptime: status.uptimeSeconds,
            orchestratorId: status.orchestratorId,
            checks: {
              dbConnected: status.dbConnected,
              listenClientConnected: status.listenClientConnected,
              activeRuns: status.activeRuns,
              lastTickAt: status.lastTickAt,
              ticksTotal: status.ticksTotal,
            },
          });
          res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
          res.end(body);
        } catch (err) {
          const body = JSON.stringify({ ok: false, error: (err as Error).message });
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(body);
        }
        return;
      }

      if (req.method === 'GET' && req.url === '/metrics') {
        const body = serialize();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(body);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    // P2-1: Fail fast if port is in use
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(
          `[SymphonyHealth] Port ${port} is already in use. ` +
          `Set SYMPHONY_HEALTH_PORT to a different port.`,
        ));
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      console.log(`[SymphonyHealth] Server listening on :${port}`);
      resolve(server);
    });
  });
}
