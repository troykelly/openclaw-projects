/**
 * Integration tests: HA routes plugin registration in server.ts.
 *
 * Verifies that haRoutesPlugin is registered and the /api/ha/* endpoints
 * are reachable through the full server. Auth is enabled so unauthenticated
 * requests must receive 401 (not 404, which would mean the route is missing).
 *
 * These tests do NOT require database migrations because auth rejection
 * happens before any DB queries.
 *
 * Issue #1606, Epic #1440.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Enable auth so we can verify HA routes require authentication.
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';
delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;

import { buildServer } from '../src/api/server.ts';

describe('HA routes registration (Issue #1606)', () => {
  const app = buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Route accessibility (returns 401, not 404) ──────────────────
  // If the plugin is not registered, Fastify returns 404. Auth middleware
  // intercepts first and returns 401 for unauthenticated requests.

  it('GET /api/ha/routines returns 401 without auth (not 404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ha/routines',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/ha/anomalies returns 401 without auth (not 404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ha/anomalies',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/ha/observations returns 401 without auth (not 404)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ha/observations',
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Write endpoints also require auth ───────────────────────────

  it('PATCH /api/ha/routines/:id returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/ha/routines/550e8400-e29b-41d4-a716-446655440001',
      payload: { title: 'Test' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('PATCH /api/ha/anomalies/:id returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/ha/anomalies/550e8400-e29b-41d4-a716-446655440001',
      payload: { resolved: true },
    });
    expect(res.statusCode).toBe(401);
  });
});
