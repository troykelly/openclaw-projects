/**
 * Lightweight health + metrics HTTP server.
 * Uses node:http -- no Fastify dependency.
 * Part of Issue #1178.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { serialize } from './metrics.ts';

export interface HealthStatus {
  dbConnected: boolean;
  listenClientConnected: boolean;
  webhookConfigValid: boolean;
  lastTickAt: number | null;
  ticksTotal: number;
}

/**
 * Start a minimal HTTP server exposing /health and /metrics.
 *
 * @param port  Port to listen on (default 9000).
 * @param checks  Callback that returns the current health status.
 * @returns The http.Server instance.
 */
export function startHealthServer(
  port: number,
  checks: () => Promise<HealthStatus>,
): Server {
  const startTime = Date.now();

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      try {
        const status = await checks();
        const ok = status.dbConnected && status.listenClientConnected;
        const body = JSON.stringify({
          ok,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          checks: status,
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

  server.listen(port, () => {
    console.log(`[Health] Server listening on :${port}`);
  });

  return server;
}
