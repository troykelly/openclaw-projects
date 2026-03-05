/**
 * Integration tests for chat dispatch via gateway WebSocket.
 * Issues #2155 (chat dispatch) and #2163 (chat abort).
 *
 * These tests spin up a real WebSocket server and verify the full
 * dispatch/abort flow through the GatewayConnectionService.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { GatewayConnectionService } from '../gateway/connection.ts';
import type { Pool } from 'pg';
import { dispatchChatMessage, abortChatRun, type ChatSession, type ChatMessageRecord } from '../gateway/chat-dispatch.ts';

// Mock the singleton to use our test instance
let testGateway: GatewayConnectionService;
vi.mock('../gateway/index.ts', () => ({
  getGatewayConnection: () => testGateway,
}));

// Mock enqueueWebhook
const mockEnqueueWebhook = vi.fn().mockResolvedValue('webhook-id');
vi.mock('../webhooks/dispatcher.ts', () => ({
  enqueueWebhook: (...args: unknown[]) => mockEnqueueWebhook(...args),
}));

// ── Test Helpers ────────────────────────────────────────────────────

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

function makeSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: 'session-1',
    agent_id: 'my-agent',
    thread_id: 'thread-1',
    stream_secret: 'secret-abc',
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: 'msg-1',
    body: 'Hello agent',
    content_type: 'text/plain',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Chat WS dispatch integration', () => {
  let wss: WebSocketServer;
  let port: number;
  let serverClients: WsWebSocket[];
  let receivedRequests: Array<Record<string, unknown>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    port = await getRandomPort();
    serverClients = [];
    receivedRequests = [];

    wss = new WebSocketServer({ port });

    // Standard gateway handshake + request handling
    wss.on('connection', (ws) => {
      serverClients.push(ws);

      // Send challenge immediately
      ws.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'test-nonce' },
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
        } else if (msg.type === 'req') {
          // Record non-connect requests for assertion
          receivedRequests.push(msg);
          // Respond with success
          ws.send(JSON.stringify({
            type: 'res',
            id: msg.id,
            ok: true,
            payload: { accepted: true },
          }));
        }
      });
    });

    // Create and initialize gateway connection
    testGateway = new GatewayConnectionService({
      OPENCLAW_GATEWAY_URL: `http://127.0.0.1:${port}`,
      OPENCLAW_GATEWAY_TOKEN: 'test-token',
      OPENCLAW_GATEWAY_ALLOW_PRIVATE: 'true',
    });

    process.env.OPENCLAW_GATEWAY_URL = `http://127.0.0.1:${port}`;
    process.env.OPENCLAW_TIMEOUT_SECONDS = '60';

    await testGateway.initialize();
  });

  afterEach(async () => {
    await testGateway.shutdown();
    for (const client of serverClients) {
      if (client.readyState === WsWebSocket.OPEN) {
        client.close();
      }
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    delete process.env.OPENCLAW_GATEWAY_URL;
    delete process.env.OPENCLAW_TIMEOUT_SECONDS;
  });

  it('dispatches chat message via WS when gateway is connected', async () => {
    const session = makeSession();
    const message = makeMessage();

    const result = await dispatchChatMessage({ query: vi.fn() } as unknown as Pool, session, message, 'user@example.com');

    expect(result.dispatched).toBe(true);
    expect(result.method).toBe('ws');
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();

    // Verify the WS server received the request
    expect(receivedRequests.length).toBe(1);
    const req = receivedRequests[0];
    expect(req.method).toBe('chat.send');
    expect(req.params).toEqual({
      sessionKey: 'agent:my-agent:agent_chat:thread-1',
      message: 'Hello agent',
      idempotencyKey: 'msg-1',
      deliver: true,
      timeoutMs: 60_000,
    });
  }, 10000);

  it('same message sent twice produces identical idempotencyKey', async () => {
    const session = makeSession();
    const message = makeMessage({ id: 'retry-msg' });

    await dispatchChatMessage({} as unknown, session, message, 'user@example.com');
    await dispatchChatMessage({} as unknown, session, message, 'user@example.com');

    expect(receivedRequests.length).toBe(2);
    const key1 = (receivedRequests[0].params as Record<string, unknown>).idempotencyKey;
    const key2 = (receivedRequests[1].params as Record<string, unknown>).idempotencyKey;
    expect(key1).toBe(key2);
    expect(key1).toBe('retry-msg');
  }, 10000);

  it('abort sends chat.abort via WS to mock gateway', async () => {
    const session = makeSession();

    await abortChatRun(session, 'run-42');

    expect(receivedRequests.length).toBe(1);
    const req = receivedRequests[0];
    expect(req.method).toBe('chat.abort');
    expect(req.params).toEqual({
      sessionKey: 'agent:my-agent:agent_chat:thread-1',
      runId: 'run-42',
    });
  }, 10000);
});

describe('Chat WS dispatch fallback integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Create a disconnected gateway (no URL = won't connect)
    testGateway = new GatewayConnectionService({});
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com';
  });

  afterEach(() => {
    delete process.env.OPENCLAW_GATEWAY_URL;
    delete process.env.WEBHOOK_DESTINATION_URL;
  });

  it('falls back to HTTP webhook when gateway is not connected', async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    const result = await dispatchChatMessage(pool, makeSession(), makeMessage(), 'user@example.com');

    expect(result.dispatched).toBe(true);
    expect(result.method).toBe('http');
    expect(mockEnqueueWebhook).toHaveBeenCalledOnce();
  });

  it('returns 503-compatible result when no gateway configured at all', async () => {
    delete process.env.OPENCLAW_GATEWAY_URL;
    delete process.env.WEBHOOK_DESTINATION_URL;

    const pool = { query: vi.fn() } as unknown as Pool;
    const result = await dispatchChatMessage(pool, makeSession(), makeMessage(), 'user@example.com');

    expect(result.dispatched).toBe(false);
    expect(result.error).toContain('no gateway configured');
  });

  it('abort is no-op when WS not connected', async () => {
    await abortChatRun(makeSession());
    // No error, no requests sent
  });
});
