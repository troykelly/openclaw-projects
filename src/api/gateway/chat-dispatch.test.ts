/**
 * Unit tests for chat dispatch via gateway WebSocket.
 * Issues #2155 (chat dispatch) and #2163 (chat abort).
 *
 * TDD: These tests are written FIRST, before the implementation.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { Pool } from 'pg';

// ── Mocks ──────────────────────────────────────────────────────────

const mockRequest = vi.fn();
const mockGetStatus = vi.fn();

vi.mock('./index.ts', () => ({
  getGatewayConnection: () => ({
    request: mockRequest,
    getStatus: mockGetStatus,
  }),
}));

const mockEnqueueWebhook = vi.fn().mockResolvedValue('webhook-id');
vi.mock('../webhooks/dispatcher.ts', () => ({
  enqueueWebhook: (...args: unknown[]) => mockEnqueueWebhook(...args),
}));

// Import after mocks
import {
  dispatchChatMessage,
  abortChatRun,
  type ChatSession,
  type ChatMessageRecord,
} from './chat-dispatch.ts';
import { gwChatDispatchWs, gwChatDispatchHttp } from './metrics.ts';

// ── Fixtures ───────────────────────────────────────────────────────

function makeSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: 'session-uuid-1',
    agent_id: 'my-agent',
    thread_id: 'thread-uuid-1',
    stream_secret: 'secret-abc',
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: 'msg-uuid-1',
    body: 'Hello agent',
    content_type: 'text/plain',
    ...overrides,
  };
}

function makeMockPool(): Pool {
  return { query: vi.fn() } as unknown as Pool;
}

// ── dispatchChatMessage ────────────────────────────────────────────

describe('dispatchChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: gateway connected
    mockGetStatus.mockReturnValue({ connected: true, gateway_url: 'gateway.example.com' });
    mockRequest.mockResolvedValue({ ok: true });
    // Set env vars
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com';
    process.env.OPENCLAW_TIMEOUT_SECONDS = '60';
  });

  // ── WS primary path ──────────────────────────────────────────

  it('dispatches via WS when connection is active', async () => {
    const session = makeSession();
    const message = makeMessage();
    const pool = makeMockPool();

    const result = await dispatchChatMessage(pool, session, message, 'user@example.com');

    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockRequest).toHaveBeenCalledWith('chat.send', expect.any(Object));
    // Should NOT fall back to HTTP webhook
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(true);
    expect(result.method).toBe('ws');
  });

  it('uses sessionKey format: agent:{agentId}:agent_chat:{threadId}', async () => {
    const session = makeSession({ agent_id: 'test-agent', thread_id: 'thread-42' });
    const message = makeMessage();

    await dispatchChatMessage(makeMockPool(), session, message, 'user@example.com');

    const params = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(params.sessionKey).toBe('agent:test-agent:agent_chat:thread-42');
  });

  it('uses message UUID as idempotencyKey', async () => {
    const message = makeMessage({ id: 'unique-msg-id' });

    await dispatchChatMessage(makeMockPool(), makeSession(), message, 'user@example.com');

    const params = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(params.idempotencyKey).toBe('unique-msg-id');
  });

  it('sets deliver: true and correct timeoutMs', async () => {
    process.env.OPENCLAW_TIMEOUT_SECONDS = '90';

    await dispatchChatMessage(makeMockPool(), makeSession(), makeMessage(), 'user@example.com');

    const params = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(params.deliver).toBe(true);
    expect(params.timeoutMs).toBe(90_000);
  });

  it('uses default timeoutMs of 120000 when env var is not set', async () => {
    delete process.env.OPENCLAW_TIMEOUT_SECONDS;

    await dispatchChatMessage(makeMockPool(), makeSession(), makeMessage(), 'user@example.com');

    const params = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(params.timeoutMs).toBe(120_000);
  });

  // ── Fallback path ────────────────────────────────────────────

  it('falls back to enqueueWebhook when WS not connected', async () => {
    mockGetStatus.mockReturnValue({ connected: false, gateway_url: 'gateway.example.com' });

    const pool = makeMockPool();
    const session = makeSession();
    const message = makeMessage();

    const result = await dispatchChatMessage(pool, session, message, 'user@example.com');

    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockEnqueueWebhook).toHaveBeenCalledOnce();
    expect(result.dispatched).toBe(true);
    expect(result.method).toBe('http');
  });

  it('falls back to enqueueWebhook when WS request throws', async () => {
    mockRequest.mockRejectedValue(new Error('WS timeout'));

    const pool = makeMockPool();
    const session = makeSession();
    const message = makeMessage();

    const result = await dispatchChatMessage(pool, session, message, 'user@example.com');

    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockEnqueueWebhook).toHaveBeenCalledOnce();
    expect(result.dispatched).toBe(true);
    expect(result.method).toBe('http');
  });

  it('fallback payload includes stream_secret and absolute streaming_callback_url', async () => {
    mockGetStatus.mockReturnValue({ connected: false, gateway_url: 'gateway.example.com' });
    process.env.PUBLIC_BASE_URL = 'https://example.com';

    const session = makeSession({ id: 'sess-1', stream_secret: 'my-secret' });
    const message = makeMessage({ id: 'msg-1', body: 'Hello' });
    const pool = makeMockPool();

    await dispatchChatMessage(pool, session, message, 'user@example.com');

    expect(mockEnqueueWebhook).toHaveBeenCalledOnce();
    const webhookBody = mockEnqueueWebhook.mock.calls[0][3] as Record<string, unknown>;
    const payload = webhookBody.payload as Record<string, unknown>;
    expect(payload.stream_secret).toBe('my-secret');
    // Must be absolute so the gateway can call back (#2493)
    expect(payload.streaming_callback_url).toBe('https://api.example.com/chat/sessions/sess-1/stream');
  });

  it('streaming_callback_url uses api.{hostname} subdomain for production domains', async () => {
    mockGetStatus.mockReturnValue({ connected: false });
    process.env.PUBLIC_BASE_URL = 'https://myapp.io';

    await dispatchChatMessage(makeMockPool(), makeSession({ id: 'sess-2' }), makeMessage(), 'u@example.com');

    const payload = (mockEnqueueWebhook.mock.calls[0][3] as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload.streaming_callback_url).toBe('https://api.myapp.io/chat/sessions/sess-2/stream');
  });

  it('streaming_callback_url uses localhost base directly (no api. prefix)', async () => {
    mockGetStatus.mockReturnValue({ connected: false });
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';

    await dispatchChatMessage(makeMockPool(), makeSession({ id: 'sess-3' }), makeMessage(), 'u@example.com');

    const payload = (mockEnqueueWebhook.mock.calls[0][3] as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload.streaming_callback_url).toBe('http://localhost:3000/chat/sessions/sess-3/stream');
  });

  // ── Error handling ───────────────────────────────────────────

  it('succeeds without dispatch when no gateway URL is configured', async () => {
    // When no gateway is configured, the message is stored in the DB but not
    // dispatched to any agent. This is not an error — it matches the pre-WS
    // behavior where the webhook was silently skipped.
    mockGetStatus.mockReturnValue({ connected: false, gateway_url: null });
    delete process.env.OPENCLAW_GATEWAY_URL;
    delete process.env.WEBHOOK_DESTINATION_URL;

    const pool = makeMockPool();
    const result = await dispatchChatMessage(pool, makeSession(), makeMessage(), 'user@example.com');

    expect(result.dispatched).toBe(true);
    expect(result.method).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockEnqueueWebhook).not.toHaveBeenCalled();
  });

  it('does not throw -- catches all dispatch errors', async () => {
    mockGetStatus.mockReturnValue({ connected: true, gateway_url: 'gateway.example.com' });
    mockRequest.mockRejectedValue(new Error('WS exploded'));
    mockEnqueueWebhook.mockRejectedValue(new Error('HTTP also exploded'));

    const result = await dispatchChatMessage(makeMockPool(), makeSession(), makeMessage(), 'user@example.com');

    // Should return gracefully, not throw
    expect(result.dispatched).toBe(false);
  });

  // ── Idempotency / no double-processing ───────────────────────

  it('same message UUID produces identical idempotencyKey across retries', async () => {
    const message = makeMessage({ id: 'stable-uuid' });

    // First call
    await dispatchChatMessage(makeMockPool(), makeSession(), message, 'user@example.com');
    const key1 = (mockRequest.mock.calls[0][1] as Record<string, unknown>).idempotencyKey;

    mockRequest.mockClear();

    // Second call (retry)
    await dispatchChatMessage(makeMockPool(), makeSession(), message, 'user@example.com');
    const key2 = (mockRequest.mock.calls[0][1] as Record<string, unknown>).idempotencyKey;

    expect(key1).toBe(key2);
    expect(key1).toBe('stable-uuid');
  });

  it('sessionKey is deterministically derived from session fields', async () => {
    const session = makeSession({ agent_id: 'agent-A', thread_id: 'thread-B' });

    await dispatchChatMessage(makeMockPool(), session, makeMessage(), 'user@example.com');
    const key1 = (mockRequest.mock.calls[0][1] as Record<string, unknown>).sessionKey;

    mockRequest.mockClear();

    await dispatchChatMessage(makeMockPool(), session, makeMessage(), 'different@example.com');
    const key2 = (mockRequest.mock.calls[0][1] as Record<string, unknown>).sessionKey;

    expect(key1).toBe(key2);
    expect(key1).toBe('agent:agent-A:agent_chat:thread-B');
  });
});

// ── abortChatRun ───────────────────────────────────────────────────

describe('abortChatRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStatus.mockReturnValue({ connected: true, gateway_url: 'gateway.example.com' });
    mockRequest.mockResolvedValue({ ok: true });
  });

  it('sends chat.abort via WS when connected', async () => {
    const session = makeSession();

    await abortChatRun(session);

    expect(mockRequest).toHaveBeenCalledOnce();
    expect(mockRequest).toHaveBeenCalledWith('chat.abort', expect.any(Object));
  });

  it('includes sessionKey in correct format', async () => {
    const session = makeSession({ agent_id: 'agent-X', thread_id: 'thread-Y' });

    await abortChatRun(session);

    const params = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(params.sessionKey).toBe('agent:agent-X:agent_chat:thread-Y');
  });

  it('includes runId if provided', async () => {
    const session = makeSession();

    await abortChatRun(session, 'run-123');

    const params = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(params.runId).toBe('run-123');
  });

  it('omits runId from params when not provided', async () => {
    const session = makeSession();

    await abortChatRun(session);

    const params = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(params).not.toHaveProperty('runId');
  });

  it('is no-op when WS not connected', async () => {
    mockGetStatus.mockReturnValue({ connected: false, gateway_url: null });

    await abortChatRun(makeSession());

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does not throw on WS error (fire-and-forget)', async () => {
    mockRequest.mockRejectedValue(new Error('WS error'));

    // Should not throw
    await expect(abortChatRun(makeSession())).resolves.toBeUndefined();
  });
});

// ── Metrics integration (#2164) ───────────────────────────────────────

describe('dispatch metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENCLAW_GATEWAY_URL = 'https://gateway.example.com';
  });

  it('gwChatDispatchWs increments on successful WS dispatch', async () => {
    mockGetStatus.mockReturnValue({ connected: true, gateway_url: 'gateway.example.com' });
    mockRequest.mockResolvedValue({ ok: true });

    const before = gwChatDispatchWs.get();
    await dispatchChatMessage(makeMockPool(), makeSession(), makeMessage(), 'user@example.com');
    expect(gwChatDispatchWs.get()).toBe(before + 1);
  });

  it('gwChatDispatchHttp increments on HTTP fallback dispatch', async () => {
    mockGetStatus.mockReturnValue({ connected: false, gateway_url: null });
    mockEnqueueWebhook.mockResolvedValue('webhook-id');

    const before = gwChatDispatchHttp.get();
    await dispatchChatMessage(makeMockPool(), makeSession(), makeMessage(), 'user@example.com');
    expect(gwChatDispatchHttp.get()).toBe(before + 1);
  });

  it('gwChatDispatchHttp increments when WS fails and falls back to HTTP', async () => {
    mockGetStatus.mockReturnValue({ connected: true, gateway_url: 'gateway.example.com' });
    mockRequest.mockRejectedValue(new Error('WS unavailable'));
    mockEnqueueWebhook.mockResolvedValue('webhook-id');

    const beforeWs = gwChatDispatchWs.get();
    const beforeHttp = gwChatDispatchHttp.get();
    await dispatchChatMessage(makeMockPool(), makeSession(), makeMessage(), 'user@example.com');

    // WS counter should NOT increment (dispatch failed)
    expect(gwChatDispatchWs.get()).toBe(beforeWs);
    // HTTP counter SHOULD increment (fallback succeeded)
    expect(gwChatDispatchHttp.get()).toBe(beforeHttp + 1);
  });
});
