import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';
import { clearConfigCache } from '../src/api/webhooks/config.ts';

describe('Health API endpoints', () => {
  const app = buildServer();
  let pool: Pool;
  const originalEnv = process.env;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(() => {
    // Configure webhooks to avoid degraded status
    process.env = { ...originalEnv };
    process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
    process.env.OPENCLAW_HOOK_TOKEN = 'test-token';
    clearConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearConfigCache();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('GET /api/health/live', () => {
    it('returns 200 with status ok (liveness probe)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health/live' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('does not perform any database checks', async () => {
      // Liveness should be instant - just verify it works without DB
      const res = await app.inject({ method: 'GET', url: '/api/health/live' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /api/health/ready', () => {
    it('returns 200 with status ok when database is available', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });
  });

  describe('GET /api/health', () => {
    it('returns comprehensive health status', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body.status).toBe('healthy');
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();
      expect(body.components).toBeDefined();
    });

    it('includes database component with status and latency', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      const body = res.json();

      expect(body.components.database).toBeDefined();
      expect(body.components.database.status).toBe('healthy');
      expect(typeof body.components.database.latencyMs).toBe('number');
      expect(body.components.database.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('includes database pool details', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      const body = res.json();

      const details = body.components.database.details;
      expect(details).toBeDefined();
      expect(typeof details.poolTotal).toBe('number');
      expect(typeof details.poolIdle).toBe('number');
      expect(typeof details.poolWaiting).toBe('number');
    });
  });

  describe('backward compatibility', () => {
    it('GET /health still works (legacy endpoint)', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      // Legacy format for backward compatibility
      expect(res.json()).toEqual({ ok: true });
    });
  });
});
