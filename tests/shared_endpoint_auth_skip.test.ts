/**
 * Tests that shared note/notebook endpoints skip JWT auth.
 * Issue #1549: /api/shared/notes/:token and /api/shared/notebooks/:token
 * must be accessible without authentication (public share links).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.ts';

// Enable auth so we can verify the skip paths work
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes-long!!';
delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;

import { runMigrate } from './helpers/migrate.ts';

describe('Shared endpoint auth skip (Issue #1549)', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runMigrate('up');
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/shared/notes/:token does NOT return 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/shared/notes/some-test-token',
      // No Authorization header
    });

    // Should NOT be 401 (auth middleware should skip this path).
    // The actual response may be 404 (invalid token) or another code,
    // but it must not be 401 from the auth middleware.
    expect(res.statusCode).not.toBe(401);
  });

  it('GET /api/shared/notebooks/:token does NOT return 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/shared/notebooks/some-test-token',
      // No Authorization header
    });

    expect(res.statusCode).not.toBe(401);
  });

  it('GET /api/files/shared/:token does NOT return 401 (existing skip)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/files/shared/some-test-token',
      // No Authorization header
    });

    expect(res.statusCode).not.toBe(401);
  });

  it('GET /api/notes (authenticated endpoint) returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/notes',
      // No Authorization header
    });

    expect(res.statusCode).toBe(401);
  });
});
