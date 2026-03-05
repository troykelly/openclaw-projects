/**
 * Integration tests for GatewayConnectionService.
 * Issue #2154 — Gateway connection service.
 *
 * These tests spin up a real WebSocket server and test the full
 * connect/authenticate/event flow.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { GatewayConnectionService } from './connection.ts';

/** Find a random available port by listening on 0. */
async function getRandomPort(): Promise<number> {
  const { createServer } = await import('node:http');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        reject(new Error('Could not get port'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

describe('GatewayConnectionService integration', () => {
  let wss: WebSocketServer;
  let port: number;
  let serverClients: WsWebSocket[];

  beforeEach(async () => {
    port = await getRandomPort();
    serverClients = [];
    wss = new WebSocketServer({ port });

    wss.on('connection', (ws) => {
      serverClients.push(ws);
    });
  });

  afterEach(async () => {
    // Close all server-side clients
    for (const client of serverClients) {
      if (client.readyState === WsWebSocket.OPEN) {
        client.close();
      }
    }
    // Close the WSS
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  /** Standard gateway handshake from the server side. */
  function setupServerHandshake(token: string, tickInterval = 30000) {
    wss.on('connection', (ws) => {
      // Send challenge
      ws.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'test-nonce-123' },
      }));

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'req' && msg.method === 'connect') {
          if (msg.params?.token === token) {
            ws.send(JSON.stringify({
              type: 'res',
              id: msg.id,
              ok: true,
              payload: { tick_interval_ms: tickInterval },
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'res',
              id: msg.id,
              ok: false,
              error: { message: 'Invalid token' },
            }));
          }
        }
      });
    });
  }

  it('connects to mock WS server, completes challenge-response, receives events', async () => {
    const eventReceived = new Promise<unknown>((resolve) => {
      setupServerHandshake('my-token');
      // After handshake, server sends an event
      wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'req' && msg.method === 'connect' && msg.params?.token === 'my-token') {
            // Send an event after successful connect
            setTimeout(() => {
              ws.send(JSON.stringify({
                type: 'event',
                event: 'agent.online',
                payload: { agent_id: 'test-agent' },
                seq: 1,
              }));
            }, 50);
          }
        });
      });

      const svc = new GatewayConnectionService({
        OPENCLAW_GATEWAY_URL: `http://127.0.0.1:${port}`,
        OPENCLAW_GATEWAY_TOKEN: 'my-token',
        OPENCLAW_GATEWAY_ALLOW_PRIVATE: 'true',
      });

      svc.onEvent((frame) => {
        if (frame.event === 'agent.online') {
          resolve(frame.payload);
        }
      });

      svc.initialize().then(() => {
        // Connected
      });
    });

    const result = await eventReceived;
    expect(result).toEqual({ agent_id: 'test-agent' });
  }, 10000);

  it('reconnects after mock server drops connection', async () => {
    setupServerHandshake('my-token');

    const svc = new GatewayConnectionService({
      OPENCLAW_GATEWAY_URL: `http://127.0.0.1:${port}`,
      OPENCLAW_GATEWAY_TOKEN: 'my-token',
      OPENCLAW_GATEWAY_ALLOW_PRIVATE: 'true',
    });

    await svc.initialize();
    expect(svc.getStatus().connected).toBe(true);

    // Drop the connection from server side
    const firstClient = serverClients[0];
    firstClient.close(1001);

    // Wait for reconnect (backoff ~1-1.5s)
    await new Promise((r) => setTimeout(r, 3000));

    // Should have reconnected
    expect(svc.getStatus().connected).toBe(true);

    await svc.shutdown();
  }, 15000);

  it('request/response round-trip works', async () => {
    // Set up server to handle agents.list requests
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce' },
      }));

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'req' && msg.method === 'connect') {
          ws.send(JSON.stringify({
            type: 'res',
            id: msg.id,
            ok: true,
            payload: { tick_interval_ms: 30000 },
          }));
        } else if (msg.type === 'req' && msg.method === 'agents.list') {
          ws.send(JSON.stringify({
            type: 'res',
            id: msg.id,
            ok: true,
            payload: { agents: [{ id: 'a1', name: 'Agent One' }] },
          }));
        }
      });
    });

    const svc = new GatewayConnectionService({
      OPENCLAW_GATEWAY_URL: `http://127.0.0.1:${port}`,
      OPENCLAW_GATEWAY_TOKEN: 'my-token',
      OPENCLAW_GATEWAY_ALLOW_PRIVATE: 'true',
    });

    await svc.initialize();

    const result = await svc.request<{ agents: Array<{ id: string; name: string }> }>('agents.list', {});
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].id).toBe('a1');

    await svc.shutdown();
  }, 10000);

  it('clean shutdown closes WS and does not reconnect', async () => {
    setupServerHandshake('my-token');

    const svc = new GatewayConnectionService({
      OPENCLAW_GATEWAY_URL: `http://127.0.0.1:${port}`,
      OPENCLAW_GATEWAY_TOKEN: 'my-token',
      OPENCLAW_GATEWAY_ALLOW_PRIVATE: 'true',
    });

    await svc.initialize();
    expect(svc.getStatus().connected).toBe(true);

    await svc.shutdown();
    expect(svc.getStatus().connected).toBe(false);

    // Wait to confirm no reconnect
    await new Promise((r) => setTimeout(r, 2000));
    expect(svc.getStatus().connected).toBe(false);
  }, 10000);
});
