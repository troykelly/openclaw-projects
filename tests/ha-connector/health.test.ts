/**
 * Tests for the HA Connector health server.
 * Issue #1636, parent #1603.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { startConnectorHealthServer } from '../../src/ha-connector/health.ts';
import type { ConnectorHealthStatus } from '../../src/ha-connector/health.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchHealth(port: number, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, body };
}

function getAvailablePort(): number {
  // Use a high ephemeral port to avoid conflicts
  return 19000 + Math.floor(Math.random() * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HA Connector Health Server', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('returns 200 on /healthz when running', async () => {
    const port = getAvailablePort();
    const checks = vi.fn().mockResolvedValue({
      running: true,
      dbConnected: true,
      providers: [],
    } satisfies ConnectorHealthStatus);

    server = startConnectorHealthServer(port, checks);
    await new Promise((r) => setTimeout(r, 100)); // wait for listen

    const { status, body } = await fetchHealth(port, '/healthz');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 503 on /healthz when not running', async () => {
    const port = getAvailablePort();
    const checks = vi.fn().mockResolvedValue({
      running: false,
      dbConnected: false,
      providers: [],
    } satisfies ConnectorHealthStatus);

    server = startConnectorHealthServer(port, checks);
    await new Promise((r) => setTimeout(r, 100));

    const { status, body } = await fetchHealth(port, '/healthz');
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it('returns detailed JSON on /health', async () => {
    const port = getAvailablePort();
    const checks = vi.fn().mockResolvedValue({
      running: true,
      dbConnected: true,
      providers: [
        { id: 'prov-1', label: 'Home HA', type: 'home_assistant', connected: true },
      ],
    } satisfies ConnectorHealthStatus);

    server = startConnectorHealthServer(port, checks);
    await new Promise((r) => setTimeout(r, 100));

    const { status, body } = await fetchHealth(port, '/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.uptime).toBeDefined();
    const checks_result = body.checks as ConnectorHealthStatus;
    expect(checks_result.providers).toHaveLength(1);
    expect((checks_result.providers as Array<Record<string, unknown>>)[0].connected).toBe(true);
  });

  it('returns 404 for unknown paths', async () => {
    const port = getAvailablePort();
    const checks = vi.fn().mockResolvedValue({
      running: true,
      dbConnected: true,
      providers: [],
    } satisfies ConnectorHealthStatus);

    server = startConnectorHealthServer(port, checks);
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});
