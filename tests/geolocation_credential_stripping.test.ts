/**
 * Integration tests for geolocation provider credential stripping (#1992, #2057).
 *
 * Uses fastify.inject to verify that POST, PATCH, and GET route handlers
 * never leak encrypted credentials in their HTTP responses.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

const TEST_EMAIL = 'geo-test@example.com';

describe('Geolocation provider credential stripping (#2057)', () => {
  const app = buildServer();
  let pool: Pool;
  let savedEmail: string | undefined;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();

    // Auth bypass for integration tests
    savedEmail = process.env.OPENCLAW_E2E_SESSION_EMAIL;
    process.env.OPENCLAW_E2E_SESSION_EMAIL = TEST_EMAIL;
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, TEST_EMAIL);
  });

  afterAll(async () => {
    if (savedEmail === undefined) {
      delete process.env.OPENCLAW_E2E_SESSION_EMAIL;
    } else {
      process.env.OPENCLAW_E2E_SESSION_EMAIL = savedEmail;
    }
    await app.close();
    await pool.end();
  });

  /** Creates a webhook provider (no OAuth needed) and returns the response. */
  async function createProvider(overrides: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/geolocation/providers',
      payload: {
        provider_type: 'webhook',
        auth_type: 'webhook_token',
        label: 'Test Webhook',
        config: { label: 'test-webhook', entities: ['person.test'] },
        ...overrides,
      },
    });
  }

  describe('POST /geolocation/providers', () => {
    it('returns has_credentials: false and no credentials field for new provider', async () => {
      const res = await createProvider();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.credentials).toBeUndefined();
      expect(body.has_credentials).toBe(false);
      expect(body.id).toBeDefined();
      expect(body.label).toBe('Test Webhook');
    });

    it('returns has_credentials: true when credentials are provided', async () => {
      const res = await createProvider({ credentials: 'my-secret-token' });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.credentials).toBeUndefined();
      expect(body.has_credentials).toBe(true);
    });

    it('never exposes the encrypted blob even when credentials are set', async () => {
      const res = await createProvider({ credentials: 'super-secret' });
      const raw = res.body;

      // The raw response body must not contain the plaintext or any encrypted blob
      expect(raw).not.toContain('super-secret');
      expect(res.json().credentials).toBeUndefined();
    });
  });

  describe('GET /geolocation/providers', () => {
    it('lists providers with has_credentials instead of credentials', async () => {
      // Create a provider with credentials
      const createRes = await createProvider({ credentials: 'secret-for-list' });
      expect(createRes.statusCode).toBe(201);

      const listRes = await app.inject({
        method: 'GET',
        url: '/geolocation/providers',
      });

      expect(listRes.statusCode).toBe(200);
      const providers = listRes.json() as Array<Record<string, unknown>>;
      expect(providers).toHaveLength(1);
      expect(providers[0].credentials).toBeUndefined();
      expect(providers[0].has_credentials).toBe(true);
    });

    it('returns has_credentials: false for providers without credentials', async () => {
      await createProvider(); // no credentials

      const listRes = await app.inject({
        method: 'GET',
        url: '/geolocation/providers',
      });

      expect(listRes.statusCode).toBe(200);
      const providers = listRes.json() as Array<Record<string, unknown>>;
      expect(providers).toHaveLength(1);
      expect(providers[0].credentials).toBeUndefined();
      expect(providers[0].has_credentials).toBe(false);
    });
  });

  describe('GET /geolocation/providers/:id', () => {
    it('returns single provider with has_credentials, not credentials', async () => {
      const createRes = await createProvider({ credentials: 'secret-for-get' });
      const id = createRes.json().id as string;

      const getRes = await app.inject({
        method: 'GET',
        url: `/geolocation/providers/${id}`,
      });

      expect(getRes.statusCode).toBe(200);
      const body = getRes.json();
      expect(body.credentials).toBeUndefined();
      expect(body.has_credentials).toBe(true);
      expect(body.id).toBe(id);
    });
  });

  describe('PATCH /geolocation/providers/:id', () => {
    it('returns updated provider with has_credentials, not credentials', async () => {
      const createRes = await createProvider({ credentials: 'original-secret' });
      const id = createRes.json().id as string;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/geolocation/providers/${id}`,
        payload: { label: 'Updated Label' },
      });

      expect(patchRes.statusCode).toBe(200);
      const body = patchRes.json();
      expect(body.credentials).toBeUndefined();
      expect(body.has_credentials).toBe(true);
      expect(body.label).toBe('Updated Label');
    });

    it('returns has_credentials: true after updating credentials', async () => {
      const createRes = await createProvider(); // no credentials initially
      const id = createRes.json().id as string;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/geolocation/providers/${id}`,
        payload: { credentials: 'new-secret' },
      });

      expect(patchRes.statusCode).toBe(200);
      const body = patchRes.json();
      expect(body.credentials).toBeUndefined();
      expect(body.has_credentials).toBe(true);
      // Must not leak the plaintext or encrypted value
      expect(patchRes.body).not.toContain('new-secret');
    });
  });
});
