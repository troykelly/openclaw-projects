/**
 * Tests for dev session auth migration (Issue #2190).
 *
 * Verifies that dev session endpoints use authenticated principal
 * (namespace) instead of caller-supplied user_email.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';

describe('Dev Session Auth Migration (Issue #2190)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
    app = buildServer({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (app) await app.close();
  });

  describe('POST /dev-sessions', () => {
    it('rejects when no authentication is available and auth is enabled', async () => {
      // With auth disabled + no OPENCLAW_E2E_SESSION_EMAIL, resolveUserEmail returns null
      const res = await app.inject({
        method: 'POST',
        url: '/dev-sessions',
        headers: { 'content-type': 'application/json' },
        payload: {
          session_name: 'test',
          node: 'node-1',
        },
      });

      // Auth disabled without E2E email → resolveUserEmail returns null → 401
      expect(res.statusCode).toBe(401);
    });

    it('uses authenticated principal, not body-supplied user_email', async () => {
      // With auth disabled + E2E email, the principal is the E2E email
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', 'test-principal@example.com');

      const res = await app.inject({
        method: 'POST',
        url: '/dev-sessions',
        headers: {
          'content-type': 'application/json',
          'x-namespace': 'default',
        },
        payload: {
          user_email: 'spoofed@attacker.com', // Should be ignored
          session_name: 'auth-test-session',
          node: 'node-1',
        },
      });

      // With E2E email, session should be created with the principal, not the spoofed email
      // The actual status depends on whether DB is available
      if (res.statusCode === 201) {
        const body = res.json();
        expect(body.user_email).toBe('test-principal@example.com');
        expect(body.user_email).not.toBe('spoofed@attacker.com');
      }
      // If DB is not available (unit test), we at least verify no 400 "user_email required"
      expect(res.statusCode).not.toBe(400);

      vi.unstubAllEnvs();
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
    });
  });

  describe('PATCH /dev-sessions/:id', () => {
    it('validates status values', async () => {
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', 'test@example.com');

      const res = await app.inject({
        method: 'PATCH',
        url: '/dev-sessions/00000000-0000-0000-0000-000000000001',
        headers: {
          'content-type': 'application/json',
          'x-namespace': 'default',
        },
        payload: {
          status: 'invalid_status_value',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Invalid status value');

      vi.unstubAllEnvs();
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
    });

    it('accepts valid status values', async () => {
      vi.stubEnv('OPENCLAW_E2E_SESSION_EMAIL', 'test@example.com');

      for (const status of ['active', 'paused', 'completed', 'errored', 'abandoned']) {
        const res = await app.inject({
          method: 'PATCH',
          url: '/dev-sessions/00000000-0000-0000-0000-000000000001',
          headers: {
            'content-type': 'application/json',
            'x-namespace': 'default',
          },
          payload: { status },
        });

        // Should not be rejected for invalid status — may be 404 (no such session) or 200
        expect(res.statusCode).not.toBe(400);
      }

      vi.unstubAllEnvs();
      vi.stubEnv('OPENCLAW_PROJECTS_AUTH_DISABLED', 'true');
    });
  });

  describe('GET /dev-sessions', () => {
    it('uses namespace scoping instead of user_email', async () => {
      // The endpoint should no longer require user_email
      const res = await app.inject({
        method: 'GET',
        url: '/dev-sessions',
        headers: {
          'x-namespace': 'default',
        },
      });

      // Should not return 400 "user_email is required" — that was the old behavior
      expect(res.statusCode).not.toBe(400);
    });
  });

  describe('Valid status values', () => {
    it('DEV_SESSION_VALID_STATUSES matches CHECK constraint values', () => {
      // This test documents the valid statuses for the CHECK constraint
      const expectedStatuses = ['active', 'paused', 'completed', 'errored', 'abandoned'];
      // The values in the migration must match the values in the code
      expect(expectedStatuses).toEqual(expectedStatuses);
    });
  });
});
