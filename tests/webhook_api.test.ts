import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { clearConfigCache } from '../src/api/webhooks/config.ts';

describe('Webhook API', () => {
  const app = buildServer();
  let pool: Pool;
  const originalEnv = process.env;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    clearConfigCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    clearConfigCache();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('GET /api/webhooks/outbox', () => {
    it('returns empty list when no webhooks', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/webhooks/outbox',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns webhook entries', async () => {
      // Create webhook entries directly
      await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body)
         VALUES ('sms_received', '/hooks/agent', '{"message": "Test 1"}'::jsonb),
                ('email_received', '/hooks/agent', '{"message": "Test 2"}'::jsonb)`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/webhooks/outbox',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries.length).toBe(2);
      expect(body.total).toBe(2);
    });

    it('filters by status', async () => {
      // Create pending and dispatched webhooks
      await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body)
         VALUES ('pending', '/hooks/agent', '{}'::jsonb)`,
      );
      await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body, dispatched_at)
         VALUES ('dispatched', '/hooks/agent', '{}'::jsonb, NOW())`,
      );

      const pendingRes = await app.inject({
        method: 'GET',
        url: '/api/webhooks/outbox?status=pending',
      });

      expect(pendingRes.statusCode).toBe(200);
      const pendingBody = pendingRes.json();
      expect(pendingBody.entries.length).toBe(1);
      expect(pendingBody.entries[0].kind).toBe('pending');

      const dispatchedRes = await app.inject({
        method: 'GET',
        url: '/api/webhooks/outbox?status=dispatched',
      });

      expect(dispatchedRes.statusCode).toBe(200);
      const dispatchedBody = dispatchedRes.json();
      expect(dispatchedBody.entries.length).toBe(1);
      expect(dispatchedBody.entries[0].kind).toBe('dispatched');
    });

    it('filters by kind', async () => {
      await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body)
         VALUES ('sms_received', '/hooks/agent', '{}'::jsonb),
                ('email_received', '/hooks/agent', '{}'::jsonb)`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/webhooks/outbox?kind=sms_received',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries.length).toBe(1);
      expect(body.entries[0].kind).toBe('sms_received');
    });

    it('respects limit and offset', async () => {
      // Create 5 webhooks
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `INSERT INTO webhook_outbox (kind, destination, body)
           VALUES ($1, '/hooks/agent', '{}'::jsonb)`,
          [`test${i}`],
        );
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/webhooks/outbox?limit=2&offset=1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries.length).toBe(2);
      expect(body.total).toBe(5);
      expect(body.limit).toBe(2);
      expect(body.offset).toBe(1);
    });
  });

  describe('POST /api/webhooks/:id/retry', () => {
    it('retries a failed webhook', async () => {
      // Create a failed webhook
      const result = await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body, attempts, last_error, run_at)
         VALUES ('test', '/hooks/agent', '{}'::jsonb, 5, 'Previous error', NOW() + INTERVAL '1 hour')
         RETURNING id::text as id`,
      );
      const id = (result.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${id}/retry`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('queued');
      expect(body.id).toBe(id);

      // Verify it was reset
      const check = await pool.query('SELECT attempts, last_error FROM webhook_outbox WHERE id = $1', [id]);
      expect(check.rows[0].attempts).toBe(0);
      expect(check.rows[0].last_error).toBeNull();
    });

    it('returns 404 for non-existent webhook', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/00000000-0000-0000-0000-000000000000/retry',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for already dispatched webhook', async () => {
      const result = await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body, dispatched_at)
         VALUES ('test', '/hooks/agent', '{}'::jsonb, NOW())
         RETURNING id::text as id`,
      );
      const id = (result.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/webhooks/${id}/retry`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/webhooks/status', () => {
    it('returns configuration status when not configured', async () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_API_TOKEN;
      clearConfigCache();

      const res = await app.inject({
        method: 'GET',
        url: '/api/webhooks/status',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(false);
      expect(body.gateway_url).toBeNull();
      expect(body.has_token).toBe(false);
    });

    it('returns configuration status when configured', async () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_API_TOKEN = 'test-token';
      clearConfigCache();

      const res = await app.inject({
        method: 'GET',
        url: '/api/webhooks/status',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(true);
      expect(body.gateway_url).toBe('http://localhost:18789');
      expect(body.has_token).toBe(true);
    });

    it('returns webhook stats', async () => {
      // Create webhooks in different states
      await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body)
         VALUES ('pending1', '/hooks/agent', '{}'::jsonb),
                ('pending2', '/hooks/agent', '{}'::jsonb)`,
      );
      await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body, attempts)
         VALUES ('failed', '/hooks/agent', '{}'::jsonb, 5)`,
      );
      await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body, dispatched_at)
         VALUES ('dispatched', '/hooks/agent', '{}'::jsonb, NOW())`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/webhooks/status',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.stats.pending).toBe(2);
      expect(body.stats.failed).toBe(1);
      expect(body.stats.dispatched).toBe(1);
    });
  });

  describe('POST /api/webhooks/process', () => {
    it('returns stats when no webhooks to process', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/process',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('completed');
      expect(body.processed).toBe(0);
      expect(body.succeeded).toBe(0);
      expect(body.failed).toBe(0);
    });

    it('skips processing when OpenClaw not configured', async () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_API_TOKEN;
      clearConfigCache();

      // Create a webhook
      await pool.query(
        `INSERT INTO webhook_outbox (kind, destination, body)
         VALUES ('test', '/hooks/agent', '{}'::jsonb)`,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/process',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.processed).toBe(0);
    });

    it('respects limit parameter', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks/process',
        payload: { limit: 50 },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /api/health', () => {
    it('includes webhook health check', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.components.webhooks).toBeDefined();
      expect(body.components.webhooks.status).toBeDefined();
    });

    it('reports degraded when not configured', async () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_API_TOKEN;
      clearConfigCache();

      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.components.webhooks.status).toBe('degraded');
    });

    it('reports healthy when configured', async () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_API_TOKEN = 'test-token';
      clearConfigCache();

      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.components.webhooks.status).toBe('healthy');
    });
  });
});
