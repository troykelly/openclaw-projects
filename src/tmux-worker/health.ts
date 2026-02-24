/**
 * HTTP health check server for the tmux worker.
 *
 * Provides a simple /health endpoint for Docker healthcheck and
 * orchestrator readiness probes.
 */

import http from 'node:http';

let server: http.Server | undefined;
let isHealthy = true;

/**
 * Start the health check HTTP server.
 */
export function startHealthServer(port: number): http.Server {
  server = http.createServer((_req, res) => {
    if (isHealthy) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy' }));
    }
  });

  server.listen(port, '::', () => {
    console.log(`Health check server listening on port ${port}`);
  });

  return server;
}

/**
 * Stop the health check server. Call during graceful shutdown.
 */
export async function stopHealthServer(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (server) {
      server.close(() => {
        server = undefined;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Set the health status. When false, /health returns 503.
 */
export function setHealthy(healthy: boolean): void {
  isHealthy = healthy;
}
