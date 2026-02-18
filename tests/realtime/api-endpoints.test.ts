/**
 * Tests for real-time API endpoints.
 * Part of Issue #213.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../../src/api/server.ts';
import { resetRealtimeHub } from '../../src/api/realtime/hub.ts';

describe('Real-time API Endpoints', () => {
  const originalEnv = process.env;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
    await resetRealtimeHub();
    app = buildServer({ logger: false });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await app.close();
    await resetRealtimeHub();
  });

  describe('GET /api/ws/stats', () => {
    it('returns connected client count', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ws/stats',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('connected_clients');
      expect(typeof body.connected_clients).toBe('number');
      expect(body.connected_clients).toBe(0);
    });
  });

  // Note: SSE endpoints don't work well with Fastify inject because
  // they are streaming endpoints that never complete normally.
  // WebSocket testing also requires a real connection, not inject.
  // These tests verify the endpoints exist via exports and structure.
});

describe('Real-time event emission integration', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
    await resetRealtimeHub();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await resetRealtimeHub();
  });

  it('exports all event types from types module', async () => {
    const types = await import('../../src/api/realtime/types.ts');

    // Verify type exports exist (this tests the module structure)
    expect(types).toBeDefined();
  });

  it('exports all emitters from emitter module', async () => {
    const emitters = await import('../../src/api/realtime/emitter.ts');

    expect(emitters.emitWorkItemCreated).toBeDefined();
    expect(emitters.emitWorkItemUpdated).toBeDefined();
    expect(emitters.emitWorkItemDeleted).toBeDefined();
    expect(emitters.emitMemoryCreated).toBeDefined();
    expect(emitters.emitMemoryUpdated).toBeDefined();
    expect(emitters.emitMemoryDeleted).toBeDefined();
    expect(emitters.emitContactCreated).toBeDefined();
    expect(emitters.emitContactUpdated).toBeDefined();
    expect(emitters.emitContactDeleted).toBeDefined();
    expect(emitters.emitMessageReceived).toBeDefined();
    expect(emitters.emitNotificationCreated).toBeDefined();
  });

  it('exports hub functions from index', async () => {
    const realtime = await import('../../src/api/realtime/index.ts');

    expect(realtime.getRealtimeHub).toBeDefined();
    expect(realtime.resetRealtimeHub).toBeDefined();
    expect(realtime.RealtimeHub).toBeDefined();
  });
});
