/**
 * Lightweight health HTTP server for the HA Connector container.
 * Uses node:http — no Fastify dependency.
 * Issue #1636, parent #1603.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';

export interface ProviderHealthInfo {
  id: string;
  label: string;
  type: string;
  connected: boolean;
  error?: string;
}

export interface ConnectorHealthStatus {
  running: boolean;
  dbConnected: boolean;
  providers: ProviderHealthInfo[];
}

/**
 * Start a minimal HTTP health server for the HA Connector.
 *
 * - GET /healthz  — 200 if running, 503 otherwise (for Docker HEALTHCHECK)
 * - GET /health   — detailed JSON status including per-provider info
 */
export function startConnectorHealthServer(
  port: number,
  checks: () => Promise<ConnectorHealthStatus>,
): Server {
  const startTime = Date.now();

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      try {
        const status = await checks();
        const ok = status.running && status.dbConnected;
        res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok }));
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      try {
        const status = await checks();
        const ok = status.running && status.dbConnected;
        const body = JSON.stringify({
          ok,
          uptime: Math.floor((Date.now() - startTime) / 1000),
          checks: status,
        });
        res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(body);
      } catch (err) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(port, () => {
    console.log(`[HA-Connector] Health server listening on :${port}`);
  });

  return server;
}
