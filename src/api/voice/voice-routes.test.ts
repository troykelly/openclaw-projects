/**
 * Tests for voice conversation routes and service call validation.
 * Issues #1432, #1433, #1434, #1437.
 * Epic #1431 — Voice agent backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

import { voiceRoutesPlugin } from './routes.ts';
import { validateServiceCalls, isValidServiceCall } from './service-calls.ts';
import { resolveAgent } from './routing.ts';
import { isSessionExpired, findActiveSession, cleanupExpiredSessions } from './sessions.ts';
import { DEFAULT_SAFE_DOMAINS, BLOCKED_SERVICES } from './types.ts';
import type { VoiceConversationRow } from './types.ts';

// ---------- helpers ----------

function mockPool(queryFn: ReturnType<typeof vi.fn>): Pool {
  return { query: queryFn } as unknown as Pool;
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440001';
const OTHER_UUID = '660e8400-e29b-41d4-a716-446655440002';

function makeConversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    namespace: 'default',
    agent_id: 'test-agent',
    device_id: null,
    user_email: 'user@test.com',
    created_at: new Date('2026-02-20T10:00:00Z'),
    last_active_at: new Date('2026-02-20T10:05:00Z'),
    metadata: {},
    ...overrides,
  };
}

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OTHER_UUID,
    conversation_id: VALID_UUID,
    role: 'user',
    text: 'Hello, turn on the lights',
    service_calls: null,
    timestamp: new Date('2026-02-20T10:00:00Z'),
    ...overrides,
  };
}

function makeConfigRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    namespace: 'default',
    default_agent_id: 'main-agent',
    timeout_ms: 15000,
    idle_timeout_s: 300,
    retention_days: 30,
    device_mapping: {},
    user_mapping: {},
    service_allowlist: [...DEFAULT_SAFE_DOMAINS],
    metadata: {},
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

async function buildApp(queryFn: ReturnType<typeof vi.fn>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Decorate request with namespaceContext (simulates middleware)
  app.decorateRequest('namespaceContext', null);
  app.addHook('preHandler', async (req) => {
    req.namespaceContext = {
      storeNamespace: 'default',
      queryNamespaces: ['default'],
      isM2M: false,
      roles: { default: 'admin' },
    };
  });

  await app.register(voiceRoutesPlugin, { pool: mockPool(queryFn) });
  await app.ready();
  return app;
}

async function buildAppNoContext(queryFn: ReturnType<typeof vi.fn>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('namespaceContext', null);
  await app.register(voiceRoutesPlugin, { pool: mockPool(queryFn) });
  await app.ready();
  return app;
}

async function buildAppObserver(queryFn: ReturnType<typeof vi.fn>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('namespaceContext', null);
  app.addHook('preHandler', async (req) => {
    req.namespaceContext = {
      storeNamespace: 'default',
      queryNamespaces: ['default'],
      isM2M: false,
      roles: { default: 'observer' },
    };
  });
  await app.register(voiceRoutesPlugin, { pool: mockPool(queryFn) });
  await app.ready();
  return app;
}

async function buildAppMember(queryFn: ReturnType<typeof vi.fn>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('namespaceContext', null);
  app.addHook('preHandler', async (req) => {
    req.namespaceContext = {
      storeNamespace: 'default',
      queryNamespaces: ['default'],
      isM2M: false,
      roles: { default: 'member' },
    };
  });
  await app.register(voiceRoutesPlugin, { pool: mockPool(queryFn) });
  await app.ready();
  return app;
}

// ---------- tests ----------

describe('voiceRoutesPlugin', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let app: FastifyInstance;

  beforeEach(async () => {
    queryFn = vi.fn();
    app = await buildApp(queryFn);
  });

  // ── Voice Config ──────────────────────────────────────────

  describe('GET /api/voice/config', () => {
    it('returns config when exists', async () => {
      const row = makeConfigRow();
      queryFn.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await app.inject({ method: 'GET', url: '/api/voice/config' });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.default_agent_id).toBe('main-agent');
    });

    it('returns null data when no config', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await app.inject({ method: 'GET', url: '/api/voice/config' });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data).toBeNull();
    });

    it('returns 403 without namespace context', async () => {
      const noCtxApp = await buildAppNoContext(queryFn);
      const res = await noCtxApp.inject({ method: 'GET', url: '/api/voice/config' });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('PUT /api/voice/config', () => {
    it('creates/updates config', async () => {
      const row = makeConfigRow({ timeout_ms: 20000 });
      queryFn.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await app.inject({
        method: 'PUT',
        url: '/api/voice/config',
        payload: { timeout_ms: 20000 },
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data.timeout_ms).toBe(20000);
    });

    it('rejects invalid timeout_ms', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/voice/config',
        payload: { timeout_ms: -1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid idle_timeout_s', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/voice/config',
        payload: { idle_timeout_s: 100000 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid retention_days', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/voice/config',
        payload: { retention_days: 0 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid service_allowlist', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/voice/config',
        payload: { service_allowlist: 'not-an-array' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects empty body', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/voice/config',
        payload: null,
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 without namespace context', async () => {
      const noCtxApp = await buildAppNoContext(queryFn);
      const res = await noCtxApp.inject({
        method: 'PUT',
        url: '/api/voice/config',
        payload: { timeout_ms: 5000 },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for observer role', async () => {
      const obsApp = await buildAppObserver(queryFn);
      const res = await obsApp.inject({
        method: 'PUT',
        url: '/api/voice/config',
        payload: { timeout_ms: 5000 },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for member role (requires admin)', async () => {
      const memApp = await buildAppMember(queryFn);
      const res = await memApp.inject({
        method: 'PUT',
        url: '/api/voice/config',
        payload: { timeout_ms: 5000 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Conversation History ──────────────────────────────────

  describe('GET /api/voice/conversations', () => {
    it('returns paginated conversations', async () => {
      const row = makeConversationRow();
      queryFn
        .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 });

      const res = await app.inject({ method: 'GET', url: '/api/voice/conversations' });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it('applies pagination params', async () => {
      queryFn
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ total: '0' }], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/voice/conversations?limit=10&offset=20',
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(20);
    });

    it('returns 403 without namespace context', async () => {
      const noCtxApp = await buildAppNoContext(queryFn);
      const res = await noCtxApp.inject({ method: 'GET', url: '/api/voice/conversations' });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/voice/conversations/:id', () => {
    it('returns conversation with messages', async () => {
      const conv = makeConversationRow();
      const msg = makeMessageRow();
      queryFn
        .mockResolvedValueOnce({ rows: [conv], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [msg], rowCount: 1 });

      const res = await app.inject({
        method: 'GET',
        url: `/api/voice/conversations/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.data.id).toBe(VALID_UUID);
      expect(body.data.messages).toHaveLength(1);
    });

    it('returns 404 for missing conversation', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await app.inject({
        method: 'GET',
        url: `/api/voice/conversations/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects invalid UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/voice/conversations/not-a-uuid',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/voice/conversations/:id', () => {
    it('deletes conversation', async () => {
      queryFn.mockResolvedValueOnce({ rows: [{ id: VALID_UUID }], rowCount: 1 });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/voice/conversations/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(204);
    });

    it('returns 404 for missing conversation', async () => {
      queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/voice/conversations/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects invalid UUID', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/voice/conversations/not-a-uuid',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 without namespace context', async () => {
      const noCtxApp = await buildAppNoContext(queryFn);
      const res = await noCtxApp.inject({
        method: 'DELETE',
        url: `/api/voice/conversations/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for observer role', async () => {
      const obsApp = await buildAppObserver(queryFn);
      const res = await obsApp.inject({
        method: 'DELETE',
        url: `/api/voice/conversations/${VALID_UUID}`,
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ── Service Call Validation ───────────────────────────────

describe('validateServiceCalls', () => {
  it('allows calls in the allowlist', () => {
    const calls = [
      { domain: 'light', service: 'turn_on', target: { entity_id: 'light.living_room' }, data: { brightness_pct: 80 } },
      { domain: 'switch', service: 'toggle', target: { entity_id: 'switch.fan' } },
    ];
    const result = validateServiceCalls(calls, [...DEFAULT_SAFE_DOMAINS]);
    expect(result).toHaveLength(2);
  });

  it('filters out calls not in the allowlist', () => {
    const calls = [
      { domain: 'light', service: 'turn_on' },
      { domain: 'automation', service: 'trigger' },
    ];
    const result = validateServiceCalls(calls, ['light']);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe('light');
  });

  it('blocks explicitly blocked services even if domain is allowed', () => {
    const calls = [
      { domain: 'homeassistant', service: 'restart' },
    ];
    // Even if we somehow allowed homeassistant domain
    const result = validateServiceCalls(calls, ['homeassistant']);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for all-blocked calls', () => {
    const calls = [
      { domain: 'dangerous', service: 'destroy' },
    ];
    const result = validateServiceCalls(calls, ['light']);
    expect(result).toHaveLength(0);
  });

  it('handles empty calls array', () => {
    const result = validateServiceCalls([], ['light']);
    expect(result).toHaveLength(0);
  });
});

describe('isValidServiceCall', () => {
  it('validates valid service call', () => {
    expect(isValidServiceCall({
      domain: 'light',
      service: 'turn_on',
      target: { entity_id: 'light.living_room' },
      data: { brightness_pct: 80 },
    })).toBe(true);
  });

  it('validates minimal service call', () => {
    expect(isValidServiceCall({ domain: 'light', service: 'turn_on' })).toBe(true);
  });

  it('rejects missing domain', () => {
    expect(isValidServiceCall({ service: 'turn_on' })).toBe(false);
  });

  it('rejects missing service', () => {
    expect(isValidServiceCall({ domain: 'light' })).toBe(false);
  });

  it('rejects empty domain', () => {
    expect(isValidServiceCall({ domain: '', service: 'turn_on' })).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidServiceCall('string')).toBe(false);
    expect(isValidServiceCall(null)).toBe(false);
    expect(isValidServiceCall(42)).toBe(false);
  });

  it('rejects invalid target type', () => {
    expect(isValidServiceCall({ domain: 'light', service: 'turn_on', target: 'invalid' })).toBe(false);
  });
});

// ── Agent Routing ─────────────────────────────────────────

describe('resolveAgent', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let pool: Pool;

  beforeEach(() => {
    queryFn = vi.fn();
    pool = mockPool(queryFn);
  });

  it('uses runtime override if provided', async () => {
    queryFn.mockResolvedValueOnce({ rows: [makeConfigRow()], rowCount: 1 });

    const result = await resolveAgent(pool, 'default', 'custom-agent');
    expect(result.agent_id).toBe('custom-agent');
    expect(result.timeout_ms).toBe(15000);
  });

  it('uses user mapping when user matches', async () => {
    const config = makeConfigRow({
      user_mapping: { 'alice@test.com': 'alice-agent' },
    });
    queryFn.mockResolvedValueOnce({ rows: [config], rowCount: 1 });

    const result = await resolveAgent(pool, 'default', undefined, undefined, 'alice@test.com');
    expect(result.agent_id).toBe('alice-agent');
  });

  it('uses device mapping when device matches', async () => {
    const config = makeConfigRow({
      device_mapping: { 'device-123': 'device-agent' },
    });
    queryFn.mockResolvedValueOnce({ rows: [config], rowCount: 1 });

    const result = await resolveAgent(pool, 'default', undefined, 'device-123');
    expect(result.agent_id).toBe('device-agent');
  });

  it('uses namespace default when no mapping matches', async () => {
    const config = makeConfigRow({ default_agent_id: 'main-agent' });
    queryFn.mockResolvedValueOnce({ rows: [config], rowCount: 1 });

    const result = await resolveAgent(pool, 'default');
    expect(result.agent_id).toBe('main-agent');
  });

  it('falls back to "default" agent when no config exists', async () => {
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await resolveAgent(pool, 'default');
    expect(result.agent_id).toBe('default');
    expect(result.timeout_ms).toBe(15000);
  });

  it('user mapping takes priority over device mapping', async () => {
    const config = makeConfigRow({
      user_mapping: { 'user@test.com': 'user-agent' },
      device_mapping: { 'device-1': 'device-agent' },
    });
    queryFn.mockResolvedValueOnce({ rows: [config], rowCount: 1 });

    const result = await resolveAgent(pool, 'default', undefined, 'device-1', 'user@test.com');
    expect(result.agent_id).toBe('user-agent');
  });

  it('respects custom timeout from config', async () => {
    const config = makeConfigRow({ timeout_ms: 5000 });
    queryFn.mockResolvedValueOnce({ rows: [config], rowCount: 1 });

    const result = await resolveAgent(pool, 'default');
    expect(result.timeout_ms).toBe(5000);
  });
});

// ── Constants ─────────────────────────────────────────────

describe('constants', () => {
  it('DEFAULT_SAFE_DOMAINS includes expected domains', () => {
    expect(DEFAULT_SAFE_DOMAINS).toContain('light');
    expect(DEFAULT_SAFE_DOMAINS).toContain('switch');
    expect(DEFAULT_SAFE_DOMAINS).toContain('climate');
    expect(DEFAULT_SAFE_DOMAINS).toContain('scene');
    expect(DEFAULT_SAFE_DOMAINS).toContain('script');
    expect(DEFAULT_SAFE_DOMAINS).toContain('media_player');
  });

  it('BLOCKED_SERVICES includes destructive operations', () => {
    expect(BLOCKED_SERVICES).toContain('homeassistant.restart');
    expect(BLOCKED_SERVICES).toContain('homeassistant.stop');
    expect(BLOCKED_SERVICES).toContain('automation.delete');
  });
});

// ── Session Management ──────────────────────────────────────

describe('isSessionExpired', () => {
  it('returns false for active session', () => {
    const conv: VoiceConversationRow = {
      ...makeConversationRow(),
      last_active_at: new Date(), // just now
    };
    expect(isSessionExpired(conv, 300)).toBe(false);
  });

  it('returns true for expired session', () => {
    const conv: VoiceConversationRow = {
      ...makeConversationRow(),
      last_active_at: new Date(Date.now() - 600 * 1000), // 10 min ago
    };
    expect(isSessionExpired(conv, 300)).toBe(true);
  });

  it('uses custom timeout', () => {
    const conv: VoiceConversationRow = {
      ...makeConversationRow(),
      last_active_at: new Date(Date.now() - 120 * 1000), // 2 min ago
    };
    // 60s timeout -> expired
    expect(isSessionExpired(conv, 60)).toBe(true);
    // 300s timeout -> not expired
    expect(isSessionExpired(conv, 300)).toBe(false);
  });
});

describe('findActiveSession', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let pool: Pool;

  beforeEach(() => {
    queryFn = vi.fn();
    pool = mockPool(queryFn);
  });

  it('returns active session when found', async () => {
    const conv = makeConversationRow();
    queryFn.mockResolvedValueOnce({ rows: [conv], rowCount: 1 });

    const result = await findActiveSession(pool, 'default', 'agent-1', 'user@test.com');
    expect(result).not.toBeNull();
    expect(result?.id).toBe(VALID_UUID);
  });

  it('returns null when no active session', async () => {
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await findActiveSession(pool, 'default', null, null);
    expect(result).toBeNull();
  });
});

describe('cleanupExpiredSessions', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let pool: Pool;

  beforeEach(() => {
    queryFn = vi.fn();
    pool = mockPool(queryFn);
  });

  it('deletes expired conversations for a namespace', async () => {
    // First query: get retention config
    queryFn.mockResolvedValueOnce({ rows: [{ retention_days: 7 }], rowCount: 1 });
    // Second query: delete expired
    queryFn.mockResolvedValueOnce({ rows: [{ id: VALID_UUID }], rowCount: 1 });

    const count = await cleanupExpiredSessions(pool, 'test-ns');
    expect(count).toBe(1);
  });

  it('uses default retention when no config', async () => {
    // First query: no config
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Second query: delete expired
    queryFn.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const count = await cleanupExpiredSessions(pool, 'test-ns');
    expect(count).toBe(0);
  });

  it('handles global cleanup without namespace', async () => {
    // Global cleanup query
    queryFn.mockResolvedValueOnce({ rows: [{ id: VALID_UUID }, { id: OTHER_UUID }], rowCount: 2 });

    const count = await cleanupExpiredSessions(pool);
    expect(count).toBe(2);
  });
});
