/**
 * Tests that shared note/notebook endpoints skip JWT auth.
 * Issue #1549: /shared/notes/:token and /shared/notebooks/:token
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

  it('GET /shared/notes/:token does NOT return 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/shared/notes/some-test-token',
      // No Authorization header
    });

    // Should NOT be 401 (auth middleware should skip this path).
    // The actual response may be 404 (invalid token) or another code,
    // but it must not be 401 from the auth middleware.
    expect(res.statusCode).not.toBe(401);
  });

  it('GET /shared/notebooks/:token does NOT return 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/shared/notebooks/some-test-token',
      // No Authorization header
    });

    expect(res.statusCode).not.toBe(401);
  });

  it('GET /files/shared/:token does NOT return 401 (existing skip)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/files/shared/some-test-token',
      // No Authorization header
    });

    expect(res.statusCode).not.toBe(401);
  });

  it('GET /notes (authenticated endpoint) returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/notes',
      // No Authorization header
    });

    expect(res.statusCode).toBe(401);
  });
});
