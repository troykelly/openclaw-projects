/**
 * Unit tests for symphony worker health server.
 * Issue #2195 — Symphony Worker Process Skeleton.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { startSymphonyHealthServer } from './health.ts';
import type { SymphonyHealthStatus } from './health.ts';

// Use a random port range to avoid conflicts
let testPort = 19001;
function nextPort(): number {
  return testPort++;
}

const baseStatus: SymphonyHealthStatus = {
  dbConnected: true,
  listenClientConnected: true,
  activeRuns: 2,
  lastTickAt: Date.now(),
  ticksTotal: 42,
  orchestratorId: 'test-orch-1',
  uptimeSeconds: 120,
};

describe('startSymphonyHealthServer', () => {
  let server: Server | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it('responds 200 on /health when all checks pass', async () => {
    const port = nextPort();
    server = await startSymphonyHealthServer(port, async () => baseStatus);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.orchestratorId).toBe('test-orch-1');
    expect(body.checks.activeRuns).toBe(2);
    expect(body.checks.ticksTotal).toBe(42);
  });

  it('responds 503 on /health when DB is disconnected', async () => {
    const port = nextPort();
    server = await startSymphonyHealthServer(port, async () => ({
      ...baseStatus,
      dbConnected: false,
    }));

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('responds 503 on /health when listener is disconnected', async () => {
    const port = nextPort();
    server = await startSymphonyHealthServer(port, async () => ({
      ...baseStatus,
      listenClientConnected: false,
    }));

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(503);
  });

  it('responds with Prometheus metrics on /metrics', async () => {
    const port = nextPort();
    server = await startSymphonyHealthServer(port, async () => baseStatus);

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const body = await res.text();
    expect(body).toContain('symphony_');
  });

  it('responds 404 for unknown paths', async () => {
    const port = nextPort();
    server = await startSymphonyHealthServer(port, async () => baseStatus);

    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  it('fails fast when port is already in use', async () => {
    const port = nextPort();
    server = await startSymphonyHealthServer(port, async () => baseStatus);

    await expect(
      startSymphonyHealthServer(port, async () => baseStatus),
    ).rejects.toThrow(/Port.*already in use/);
  });

  it('handles check function errors gracefully', async () => {
    const port = nextPort();
    server = await startSymphonyHealthServer(port, async () => {
      throw new Error('DB exploded');
    });

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('DB exploded');
  });
});
