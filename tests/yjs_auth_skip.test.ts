/**
 * Tests that the /yjs/:noteId WebSocket endpoint skips the global JWT auth hook
 * and that query-string token extraction works without crashing.
 *
 * Issue #2341: The onRequest hook was rejecting Yjs WebSocket connections with 401
 * before the WS handler could check the ?token=JWT query param.
 *
 * Issue #2404: req.query is undefined in @fastify/websocket handlers, causing
 * TypeError and HTTP 500 when extracting the JWT token.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.ts';

// Enable auth so we can verify the skip paths work
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';
delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;

import { runMigrate } from './helpers/migrate.ts';

describe('Yjs WebSocket auth skip (Issue #2341)', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /yjs/:noteId does NOT return 401 (auth handled by WS handler)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/yjs/00000000-0000-0000-0000-000000000001',
      // No Authorization header — token would be in query param for real WS
    });

    // Should NOT be 401 (auth middleware should skip this path).
    // The actual response may be a different error (no WS upgrade, missing route, etc.),
    // but it must not be 401 from the global auth hook.
    expect(res.statusCode).not.toBe(401);
  });

  it('GET /yjs/:noteId with query params does NOT return 401 or 500', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/yjs/00000000-0000-0000-0000-000000000002?token=some-jwt-token',
      // No Authorization header
    });

    expect(res.statusCode).not.toBe(401);
    // Issue #2404: previously crashed with TypeError because req.query was undefined
    expect(res.statusCode).not.toBe(500);
  });

  it('GET /ws with query token does NOT return 500 (Issue #2404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ws?token=some-jwt-token',
      // No Authorization header
    });

    // Must not crash with TypeError from undefined req.query
    expect(res.statusCode).not.toBe(500);
  });

  it('GET /notes (authenticated endpoint) still returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/notes',
      // No Authorization header
    });

    expect(res.statusCode).toBe(401);
  });
});
