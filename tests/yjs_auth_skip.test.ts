/**
 * Tests that the /yjs/:noteId WebSocket endpoint skips the global JWT auth hook.
 * Issue #2341: The onRequest hook was rejecting Yjs WebSocket connections with 401
 * before the WS handler could check the ?token=JWT query param.
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

  it('GET /yjs/:noteId with query params does NOT return 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/yjs/00000000-0000-0000-0000-000000000002?token=some-jwt-token',
      // No Authorization header
    });

    expect(res.statusCode).not.toBe(401);
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
