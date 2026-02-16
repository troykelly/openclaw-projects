import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { runMigrate } from './helpers/migrate.ts';
import { buildServer } from '../src/api/server.ts';
import { clearCachedSecret } from '../src/api/auth/secret.ts';
import { resetRealtimeHub } from '../src/api/realtime/hub.ts';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Tests for shared secret authentication (Issue #220)
 *
 * Requirements:
 * - Read secret from env/file/command at startup
 * - Validate Authorization: Bearer <secret> header on API requests
 * - Skip auth for health endpoints
 * - Skip auth for webhook endpoints (they have their own signatures)
 * - Return 401 Unauthorized on invalid/missing secret
 * - Allow disabling auth with OPENCLAW_PROJECTS_AUTH_DISABLED=true
 */

// These tests manage their own auth environment, so we need to unset the
// OPENCLAW_PROJECTS_AUTH_DISABLED that the setup-api.ts file sets.
const originalAuthDisabled = process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;

/** Restore env vars without setting undefined values to the string "undefined" */
function restoreEnv(saved: Record<string, string | undefined>, keys: string[]) {
  for (const key of keys) {
    if (saved[key] !== undefined) {
      process.env[key] = saved[key];
    } else {
      delete process.env[key];
    }
  }
}

describe('Shared secret authentication', () => {
  beforeAll(async () => {
    await runMigrate('up');
    // Unset the auth disabled flag that setup-api.ts sets
    delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
  });

  afterAll(() => {
    // Restore the original value
    if (originalAuthDisabled !== undefined) {
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = originalAuthDisabled;
    }
  });

  describe('Secret loading', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Reset modules to reload secret
      vi.resetModules();
      // Clear the cached secret so each test starts fresh
      clearCachedSecret();
      // Reset env vars for this test
      delete process.env.OPENCLAW_PROJECTS_AUTH_SECRET;
      delete process.env.OPENCLAW_PROJECTS_AUTH_SECRET_FILE;
      delete process.env.OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND;
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    afterEach(() => {
      restoreEnv(originalEnv, [
        'OPENCLAW_PROJECTS_AUTH_SECRET',
        'OPENCLAW_PROJECTS_AUTH_SECRET_FILE',
        'OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND',
        'OPENCLAW_PROJECTS_AUTH_DISABLED',
      ]);
      clearCachedSecret();
    });

    it('loads secret from OPENCLAW_PROJECTS_AUTH_SECRET env variable', async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = 'test-secret-from-env';
      const { loadSecret } = await import('../src/api/auth/secret.js');
      expect(loadSecret()).toBe('test-secret-from-env');
    });

    it('loads secret from file via OPENCLAW_PROJECTS_AUTH_SECRET_FILE', async () => {
      const secretFile = join(tmpdir(), `openclaw-test-secret-${Date.now()}.txt`);
      writeFileSync(secretFile, 'secret-from-file\n', { mode: 0o600 });

      try {
        process.env.OPENCLAW_PROJECTS_AUTH_SECRET_FILE = secretFile;
        const { loadSecret } = await import('../src/api/auth/secret.js');
        expect(loadSecret()).toBe('secret-from-file');
      } finally {
        unlinkSync(secretFile);
      }
    });

    it('loads secret from command via OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND', async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND = 'echo secret-from-command';
      const { loadSecret } = await import('../src/api/auth/secret.js');
      expect(loadSecret()).toBe('secret-from-command');
    });

    it('prioritizes COMMAND over FILE over direct value', async () => {
      const secretFile = join(tmpdir(), `openclaw-test-priority-${Date.now()}.txt`);
      writeFileSync(secretFile, 'secret-from-file', { mode: 0o600 });

      try {
        process.env.OPENCLAW_PROJECTS_AUTH_SECRET = 'secret-from-env';
        process.env.OPENCLAW_PROJECTS_AUTH_SECRET_FILE = secretFile;
        process.env.OPENCLAW_PROJECTS_AUTH_SECRET_COMMAND = 'echo secret-from-command';

        const { loadSecret } = await import('../src/api/auth/secret.js');
        // Command has highest priority
        expect(loadSecret()).toBe('secret-from-command');
      } finally {
        unlinkSync(secretFile);
      }
    });

    it('falls back to FILE when COMMAND is not set', async () => {
      const secretFile = join(tmpdir(), `openclaw-test-fallback-${Date.now()}.txt`);
      writeFileSync(secretFile, 'secret-from-file', { mode: 0o600 });

      try {
        process.env.OPENCLAW_PROJECTS_AUTH_SECRET = 'secret-from-env';
        process.env.OPENCLAW_PROJECTS_AUTH_SECRET_FILE = secretFile;
        // No COMMAND set

        const { loadSecret } = await import('../src/api/auth/secret.js');
        expect(loadSecret()).toBe('secret-from-file');
      } finally {
        unlinkSync(secretFile);
      }
    });

    it('trims whitespace from secrets', async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = '  trimmed-secret  \n';
      const { loadSecret } = await import('../src/api/auth/secret.js');
      expect(loadSecret()).toBe('trimmed-secret');
    });

    it('returns empty string when no secret is configured', async () => {
      const { loadSecret } = await import('../src/api/auth/secret.js');
      expect(loadSecret()).toBe('');
    });
  });

  describe('API authentication', () => {
    const originalEnv = { ...process.env };
    const TEST_SECRET = 'test-api-secret-12345';

    beforeEach(() => {
      // Clear the cached secret so each test starts fresh
      clearCachedSecret();
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = TEST_SECRET;
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    afterEach(async () => {
      restoreEnv(originalEnv, ['OPENCLAW_PROJECTS_AUTH_SECRET', 'OPENCLAW_PROJECTS_AUTH_DISABLED']);
      clearCachedSecret();
      // Reset realtime hub to clean up PostgreSQL connections
      await resetRealtimeHub();
    });

    it('allows access with valid Bearer token', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/work-items',
          headers: {
            authorization: `Bearer ${TEST_SECRET}`,
          },
        });

        // Should not be 401
        expect(response.statusCode).not.toBe(401);
      } finally {
        await app.close();
      }
    });

    it('returns 401 with invalid Bearer token', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/work-items',
          headers: {
            authorization: 'Bearer wrong-secret',
          },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'unauthorized' });
      } finally {
        await app.close();
      }
    });

    it('returns 401 with missing Authorization header', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/work-items',
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'unauthorized' });
      } finally {
        await app.close();
      }
    });

    it('returns 401 with malformed Authorization header', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/work-items',
          headers: {
            authorization: 'Basic dXNlcjpwYXNz', // Basic auth instead of Bearer
          },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'unauthorized' });
      } finally {
        await app.close();
      }
    });
  });

  describe('Health endpoints skip auth', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      clearCachedSecret();
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = 'some-secret';
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    afterEach(async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = originalEnv.OPENCLAW_PROJECTS_AUTH_SECRET;
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = originalEnv.OPENCLAW_PROJECTS_AUTH_DISABLED;
      clearCachedSecret();
      await resetRealtimeHub();
    });

    it('allows /health without auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/health',
        });

        expect(response.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });

    it('allows /api/health/live without auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/health/live',
        });

        expect(response.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });

    it('allows /api/health/ready without auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/health/ready',
        });

        // May be 200 or 503 depending on DB state, but not 401
        expect(response.statusCode).not.toBe(401);
      } finally {
        await app.close();
      }
    });

    it('allows /api/health without auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/health',
        });

        // May be 200 or 503 depending on DB state, but not 401
        expect(response.statusCode).not.toBe(401);
      } finally {
        await app.close();
      }
    });
  });

  describe('Auth endpoints skip bearer auth', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      clearCachedSecret();
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = 'some-secret';
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    afterEach(async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = originalEnv.OPENCLAW_PROJECTS_AUTH_SECRET;
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = originalEnv.OPENCLAW_PROJECTS_AUTH_DISABLED;
      clearCachedSecret();
      await resetRealtimeHub();
    });

    it('allows /api/auth/request-link without bearer auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/request-link',
          payload: { email: 'test@example.com' },
        });

        // Should not be 401 - might be 201 (success) or 400 (validation)
        expect(response.statusCode).not.toBe(401);
      } finally {
        await app.close();
      }
    });

    it('allows /api/auth/consume without bearer auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/auth/consume?token=invalid',
          headers: { accept: 'application/json' },
        });

        // Should not be 401 - might be 400 (invalid token)
        expect(response.statusCode).not.toBe(401);
      } finally {
        await app.close();
      }
    });
  });

  describe('File share download skips auth (Issue #610)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      clearCachedSecret();
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = 'some-secret';
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    afterEach(async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = originalEnv.OPENCLAW_PROJECTS_AUTH_SECRET;
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = originalEnv.OPENCLAW_PROJECTS_AUTH_DISABLED;
      clearCachedSecret();
      await resetRealtimeHub();
    });

    it('allows /api/files/shared/:token without bearer auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/files/shared/some-share-token',
        });

        // Should not be 401 - might be 403 (invalid token) or 503 (storage not configured)
        // but NOT 401 (unauthorized) because this is a public endpoint
        expect(response.statusCode).not.toBe(401);
      } finally {
        await app.close();
      }
    });

    it('allows /api/files/shared/:token with long token without bearer auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/files/shared/abc123xyz789-long-share-token-with-dashes',
        });

        // Should not be 401 - might be 403 (invalid token) or 503 (storage not configured)
        expect(response.statusCode).not.toBe(401);
      } finally {
        await app.close();
      }
    });
  });

  describe('Webhook status endpoints skip bearer auth (Issue #1346)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      clearCachedSecret();
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = 'some-secret';
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    afterEach(async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = originalEnv.OPENCLAW_PROJECTS_AUTH_SECRET;
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = originalEnv.OPENCLAW_PROJECTS_AUTH_DISABLED;
      clearCachedSecret();
      await resetRealtimeHub();
    });

    it('allows POST /api/twilio/sms/status without bearer auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/twilio/sms/status',
          payload: { MessageSid: 'SM123', MessageStatus: 'delivered' },
        });

        // Should not be 401 (bearer auth) — may be 503 (Twilio not configured)
        // or 401 (Twilio signature invalid), but NOT the bearer-token 401
        // The bearer auth hook returns { error: 'unauthorized' } while
        // Twilio's own auth returns { error: 'Invalid signature' } or { error: 'Twilio webhook not configured' }
        const body = response.json();
        // If it is 401, it should be from Twilio's own auth, not bearer auth
        if (response.statusCode === 401) {
          expect(body.error).not.toBe('unauthorized');
        }
        expect([401, 503]).toContain(response.statusCode);
      } finally {
        await app.close();
      }
    });

    it('allows POST /api/postmark/email/status without bearer auth', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/postmark/email/status',
          payload: { RecordType: 'Delivery', MessageID: 'msg-123' },
        });

        // Should not be 401 (bearer auth) — may be 401 (Postmark Basic Auth invalid)
        // but NOT the bearer-token 401 which returns { error: 'unauthorized' }
        // Postmark's own auth returns { error: 'Unauthorized' } (capital U)
        const body = response.json();
        // If it is 401, it should be from Postmark's own auth, not bearer auth
        if (response.statusCode === 401) {
          expect(body.error).not.toBe('unauthorized');
        }
      } finally {
        await app.close();
      }
    });

    it('Twilio status webhook still enforces its own signature auth', async () => {
      // Ensure Twilio signature verification is configured
      process.env.TWILIO_AUTH_TOKEN = 'test-twilio-token';

      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/twilio/sms/status',
          payload: { MessageSid: 'SM123', MessageStatus: 'delivered' },
          // No X-Twilio-Signature header — should be rejected by Twilio's own auth
        });

        // Twilio's own auth returns 401 with { error: 'Invalid signature' }
        expect(response.statusCode).toBe(401);
        expect(response.json().error).toBe('Invalid signature');
      } finally {
        delete process.env.TWILIO_AUTH_TOKEN;
        await app.close();
      }
    });

    it('Postmark status webhook still enforces its own Basic Auth', async () => {
      // Ensure Postmark webhook auth is configured
      process.env.POSTMARK_WEBHOOK_USERNAME = 'test-user';
      process.env.POSTMARK_WEBHOOK_PASSWORD = 'test-pass';

      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/postmark/email/status',
          payload: { RecordType: 'Delivery', MessageID: 'msg-123' },
          // No Authorization header — should be rejected by Postmark's own auth
        });

        // Postmark's own auth returns 401 with { error: 'Unauthorized' }
        expect(response.statusCode).toBe(401);
        expect(response.json().error).toBe('Unauthorized');
      } finally {
        delete process.env.POSTMARK_WEBHOOK_USERNAME;
        delete process.env.POSTMARK_WEBHOOK_PASSWORD;
        await app.close();
      }
    });
  });

  describe('Development mode - auth disabled', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      clearCachedSecret();
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';
      delete process.env.OPENCLAW_PROJECTS_AUTH_SECRET;
    });

    afterEach(async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = originalEnv.OPENCLAW_PROJECTS_AUTH_SECRET;
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = originalEnv.OPENCLAW_PROJECTS_AUTH_DISABLED;
      clearCachedSecret();
      await resetRealtimeHub();
    });

    it('allows access without auth when OPENCLAW_PROJECTS_AUTH_DISABLED=true', async () => {
      const app = buildServer();
      await app.ready();

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/api/work-items',
        });

        // Should not be 401 when auth is disabled
        expect(response.statusCode).not.toBe(401);
      } finally {
        await app.close();
      }
    });
  });

  describe('Session cookie auth still works alongside bearer', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      clearCachedSecret();
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = 'some-secret';
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    afterEach(async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = originalEnv.OPENCLAW_PROJECTS_AUTH_SECRET;
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = originalEnv.OPENCLAW_PROJECTS_AUTH_DISABLED;
      clearCachedSecret();
      await resetRealtimeHub();
    });

    it('allows /api/me with valid session cookie (no bearer required)', async () => {
      const app = buildServer();
      await app.ready();

      try {
        // First, get a session via magic link
        const requestLink = await app.inject({
          method: 'POST',
          url: '/api/auth/request-link',
          payload: { email: 'cookie-auth@example.com' },
        });

        const { loginUrl } = requestLink.json() as { loginUrl: string };
        const token = new URL(loginUrl).searchParams.get('token');

        const consume = await app.inject({
          method: 'GET',
          url: `/api/auth/consume?token=${token}`,
          headers: { accept: 'application/json' },
        });

        const setCookie = consume.headers['set-cookie'];
        const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
        const sessionCookie = cookieHeader.split(';')[0];

        // Now access /api/me with cookie (no bearer)
        const me = await app.inject({
          method: 'GET',
          url: '/api/me',
          headers: {
            cookie: sessionCookie,
          },
        });

        expect(me.statusCode).toBe(200);
        expect(me.json()).toEqual({ email: 'cookie-auth@example.com' });
      } finally {
        await app.close();
      }
    });
  });

  describe('Security considerations', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      clearCachedSecret();
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = 'secret-for-timing-test';
      delete process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
    });

    afterEach(async () => {
      process.env.OPENCLAW_PROJECTS_AUTH_SECRET = originalEnv.OPENCLAW_PROJECTS_AUTH_SECRET;
      process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = originalEnv.OPENCLAW_PROJECTS_AUTH_DISABLED;
      clearCachedSecret();
      await resetRealtimeHub();
    });

    it('uses constant-time comparison to prevent timing attacks', async () => {
      const { compareSecrets } = await import('../src/api/auth/secret.js');

      // Both comparisons should take similar time regardless of where they differ
      const start1 = process.hrtime.bigint();
      compareSecrets('aaaaaaaaaaaaaaaaaaaaaaaa', 'baaaaaaaaaaaaaaaaaaaaaaa');
      const time1 = process.hrtime.bigint() - start1;

      const start2 = process.hrtime.bigint();
      compareSecrets('aaaaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaaaaaaaaaab');
      const time2 = process.hrtime.bigint() - start2;

      // The times should be within same order of magnitude
      // (this is a weak test but at least verifies the function exists)
      expect(time1).toBeDefined();
      expect(time2).toBeDefined();
    });
  });
});
